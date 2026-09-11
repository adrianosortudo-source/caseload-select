import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  archiveSyncDigest,
  buildArchiveSyncApplyPayload,
  createArchiveSyncReviewPermit,
  verifyArchiveSyncReviewPermit,
} from '@/lib/prospect-archive-sync/persistence-contract';
import type { ArchiveSyncPreview } from '@/lib/prospect-archive-sync/types';

const NOW = new Date('2026-09-10T18:00:00.000Z');
const SECRET = 'archive-review-contract-secret';
const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260910161644_prospect_archive_sync_apply.sql'),
  'utf8',
);
const persistence = readFileSync(
  resolve(process.cwd(), 'src/lib/prospect-archive-sync/persistence.ts'),
  'utf8',
);

function preview(overrides: Partial<ArchiveSyncPreview> = {}): ArchiveSyncPreview {
  return {
    schema_version: 'prospect-archive-sync-preview.v1',
    provider: 'highlevel',
    mode: 'read_only_preview',
    safety: { highlevel_writes: 0, database_writes: 0, ks_records_proposed: 0 },
    proposed_activities: [{
      cls_record_id: 'BA-B1-01', arm: 'BA', conversation_id: '00000000-0000-4000-8000-000000000001',
      kind: 'message_sent', channel: 'email', occurred_at: '2026-09-10T17:00:00.000Z',
      subject: 'A private subject', body: 'A private body', from_endpoint: 'from@example.test',
      to_endpoints: ['to@example.test'], delivery_status: 'sent', response_kind: 'none',
      reply_disposition: 'unknown', meeting_outcome: null, provenance_system: 'highlevel',
      external_event_id: 'hl-event-1', idempotency_key: 'highlevel:hl-event-1',
      provider_observed_at: '2026-09-10T17:01:00.000Z',
    }],
    held_events: [],
    history_states: [{ cls_record_id: 'BA-B1-01', arm: 'BA', history_coverage: 'evidenced_activity', source: 'provider_event' }],
    ...overrides,
  };
}

describe('prospect archive persistence contract', () => {
  it('binds Apply to the exact reviewed bundle and rebuilt preview, and expires the permit', () => {
    const bundleDigest = archiveSyncDigest({ bundle: 'one' });
    const previewDigest = archiveSyncDigest(preview());
    const permit = createArchiveSyncReviewPermit({
      bundleDigest, previewDigest, now: NOW, ttlMs: 60_000, secret: SECRET,
    });
    expect(verifyArchiveSyncReviewPermit(permit, {
      bundleDigest, previewDigest, now: new Date('2026-09-10T18:00:30.000Z'), secret: SECRET,
    }).bundle_digest).toBe(bundleDigest);
    expect(() => verifyArchiveSyncReviewPermit(permit, {
      bundleDigest: archiveSyncDigest({ bundle: 'changed' }), previewDigest, now: NOW, secret: SECRET,
    })).toThrow(/does not match/i);
    expect(() => verifyArchiveSyncReviewPermit(permit, {
      bundleDigest, previewDigest, now: new Date('2026-09-10T18:01:01.000Z'), secret: SECRET,
    })).toThrow(/expired/i);
  });

  it('reconstructs the apply projection from authoritative HighLevel identities and hashes the exact provider event', () => {
    const payload = buildArchiveSyncApplyPayload({
      preview: preview(),
      highLevelByRecordId: new Map([['BA-B1-01', {
        locationId: 'xXhW340nWLAJhOPzLbAA', contactId: 'contact-01',
      }]]),
      highLevelLocationId: 'xXhW340nWLAJhOPzLbAA',
    });
    expect(payload).toMatchObject({
      schema_version: 'prospect-archive-sync-apply.v1', provider: 'highlevel',
      highlevel_location_id: 'xXhW340nWLAJhOPzLbAA',
    });
    expect(payload.events[0]).toMatchObject({
      highlevel_contact_id: 'contact-01', external_event_id: 'hl-event-1', idempotency_key: 'highlevel:hl-event-1',
    });
    expect(payload.events[0].event_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses partial application when a preview has held provider data', () => {
    expect(() => buildArchiveSyncApplyPayload({
      preview: preview({ held_events: [{
        provider_event_id: 'conflict', highlevel_location_id: 'xXhW340nWLAJhOPzLbAA', highlevel_contact_id: 'contact-01', reason: 'ks_frozen',
      }] }),
      highLevelByRecordId: new Map(),
      highLevelLocationId: 'xXhW340nWLAJhOPzLbAA',
    })).toThrow(/held events/i);
  });

  it('permits an empty reconciled batch while retaining its authoritative location', () => {
    const payload = buildArchiveSyncApplyPayload({
      preview: preview({ proposed_activities: [] }),
      highLevelByRecordId: new Map(),
      highLevelLocationId: 'xXhW340nWLAJhOPzLbAA',
    });
    expect(payload.events).toEqual([]);
    expect(payload.highlevel_location_id).toBe('xXhW340nWLAJhOPzLbAA');
  });

  it('uses a service-only append-only database path with exact HighLevel IDs and conflict detection', () => {
    expect(migration).toContain('CREATE TABLE public.prospect_provider_event_observations');
    expect(migration).toContain("provider_system = 'highlevel'");
    expect(migration).toContain('UNIQUE (provider_system, provider_event_id)');
    expect(migration).toContain("RAISE EXCEPTION 'conflicting HighLevel provider event ID %'");
    expect(migration).toContain('AND v_existing.event_payload = v_event_payload');
    expect(migration).toContain("RAISE EXCEPTION 'KS records are frozen and cannot enter archive sync'");
    expect(migration).toContain("v_replayed_count := v_replayed_count + 1");
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.apply_prospect_archive_sync_batch(jsonb, uuid) FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.apply_prospect_archive_sync_batch(jsonb, uuid) TO service_role');
    expect(migration).toContain('ALTER TABLE public.prospect_provider_event_observations FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("'transaction_scope', 'single_batch'");
    expect(migration).toContain("v_status NOT IN ('meeting_scheduled', 'completed', 'replied', 'declined')");
    expect(migration).toContain("IF NEW.provenance_system <> 'highlevel' THEN");
  });

  it('contains no HighLevel client or write call outside the database RPC', () => {
    expect(persistence).not.toMatch(/services\.leadconnectorhq|GHL_CASELOAD_SELECT_TOKEN|fetch\s*\(/);
    expect(persistence).toContain("supabaseAdmin.rpc('apply_prospect_archive_sync_batch'");
  });
});
