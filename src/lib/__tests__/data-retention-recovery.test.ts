import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listPending: vi.fn(),
  eraseScreenedLead: vi.fn(),
  expiry: vi.fn(),
  prospectSweep: vi.fn(),
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.neq = () => chain;
      chain.lt = () => chain;
      chain.is = () => chain;
      chain.eq = () => chain;
      chain.then = (
        resolve: (value: { data: unknown[]; error: null }) => unknown,
        reject?: (error: unknown) => unknown,
      ) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return chain;
    },
  },
}));
vi.mock('@/lib/caseload-prospect-erasure', () => ({
  runProspectRetentionSweep: mocks.prospectSweep,
}));
vi.mock('@/lib/screened-lead-erasure', () => ({
  listPendingScreenedLeadPrivacyCleanups: mocks.listPending,
  eraseScreenedLead: mocks.eraseScreenedLead,
  purgeExpiredPrivacyAuditEnvelopes: mocks.expiry,
  removeIntakeSessionAttachments: vi.fn(),
}));

import { runDataRetention } from '../data-retention';

const PENDING = {
  firm_id: '11111111-1111-4111-8111-111111111111',
  screened_lead_id: '22222222-2222-4222-8222-222222222222',
  current_lead_id: 'privacy-redacted:22222222-2222-4222-8222-222222222222',
  deletion_request_id: '33333333-3333-4333-8333-333333333333',
};

beforeEach(() => {
  mocks.listPending.mockReset().mockResolvedValue({
    ok: true,
    pending_count: 1,
    requests: [PENDING],
  });
  mocks.eraseScreenedLead.mockReset().mockResolvedValue({
    ok: true,
    database_redacted: true,
    redacted_count: 0,
    deletion_request_id: PENDING.deletion_request_id,
    privacy_redacted_at: '2026-09-02T20:00:00.000Z',
    external_cleanup_status: 'complete',
    storage_objects_removed: 0,
    pending_cleanup_categories: [],
  });
  mocks.expiry.mockReset().mockResolvedValue({
    ok: true,
    retention_period: '3 years',
    eligible_request_count: 0,
    purged_event_count: 0,
    purged_channel_event_count: 0,
    purged_consent_event_count: 0,
    purged_attribution_event_count: 0,
    remaining_eligible_count: 0,
    has_more: false,
  });
  mocks.prospectSweep.mockReset().mockResolvedValue({
    ok: true,
    anonymized_count: 0,
    prospect_ids: [],
  });
});

describe('runDataRetention pending privacy cleanup recovery', () => {
  it('replays the original request through the atomic RPC before selecting new candidates', async () => {
    const result = await runDataRetention();

    expect(mocks.listPending).toHaveBeenCalledWith(100);
    expect(mocks.eraseScreenedLead).toHaveBeenCalledWith({
      firmId: PENDING.firm_id,
      leadId: PENDING.current_lead_id,
      reason: 'retention_sweep',
      deletionRequestId: PENDING.deletion_request_id,
    });
    expect(result).toMatchObject({
      privacy_cleanup_retries: 1,
      privacy_cleanup_completed: 1,
      errors: [],
    });
  });

  it('keeps incomplete external cleanup visible as a failed retention run', async () => {
    mocks.eraseScreenedLead.mockResolvedValueOnce({
      ok: false,
      database_redacted: true,
      redacted_count: 0,
      deletion_request_id: PENDING.deletion_request_id,
      privacy_redacted_at: '2026-09-02T20:00:00.000Z',
      external_cleanup_status: 'pending',
      storage_objects_removed: 0,
      pending_cleanup_categories: ['ghl'],
      error: 'external privacy cleanup requires explicit operator completion',
    });

    const result = await runDataRetention();

    expect(result.privacy_cleanup_retries).toBe(1);
    expect(result.privacy_cleanup_completed).toBe(0);
    expect(result.errors).toContain(
      'pending privacy cleanup: external privacy cleanup requires explicit operator completion',
    );
  });

  it('reports when the bounded pending-cleanup list may be starving later requests', async () => {
    mocks.listPending.mockResolvedValueOnce({
      ok: true,
      pending_count: 100,
      requests: [PENDING],
    });

    const result = await runDataRetention();

    expect(result.errors).toContain(
      'pending privacy cleanup listing reached its 100-request safety limit; later requests may require a cursor-capable recovery RPC',
    );
  });

  it('drains all database-reported audit-expiry batches and accumulates breakdowns', async () => {
    mocks.expiry
      .mockResolvedValueOnce({
        ok: true,
        retention_period: '3 years',
        eligible_request_count: 100,
        purged_event_count: 150,
        purged_channel_event_count: 100,
        purged_consent_event_count: 25,
        purged_attribution_event_count: 25,
        remaining_eligible_count: 2,
        has_more: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        retention_period: '3 years',
        eligible_request_count: 2,
        purged_event_count: 3,
        purged_channel_event_count: 1,
        purged_consent_event_count: 1,
        purged_attribution_event_count: 1,
        remaining_eligible_count: 0,
        has_more: false,
      });

    const result = await runDataRetention();

    expect(mocks.expiry).toHaveBeenCalledTimes(2);
    expect(mocks.expiry).toHaveBeenNthCalledWith(1, 100);
    expect(mocks.expiry).toHaveBeenNthCalledWith(2, 100);
    expect(result).toMatchObject({
      privacy_audit_requests_expired: 102,
      privacy_audit_events_purged: 153,
      privacy_audit_channel_events_purged: 101,
      privacy_audit_consent_events_purged: 26,
      privacy_audit_attribution_events_purged: 26,
      privacy_audit_remaining_eligible: 0,
    });
  });

  it('fails visibly when the audit-expiry safety cap is reached with backlog remaining', async () => {
    mocks.expiry.mockResolvedValue({
      ok: true,
      retention_period: '3 years',
      eligible_request_count: 100,
      purged_event_count: 100,
      purged_channel_event_count: 100,
      purged_consent_event_count: 0,
      purged_attribution_event_count: 0,
      remaining_eligible_count: 1,
      has_more: true,
    });

    const result = await runDataRetention();

    expect(mocks.expiry).toHaveBeenCalledTimes(100);
    expect(result.errors).toContain(
      'privacy audit expiry: safety cap reached with 1 eligible records remaining',
    );
  });
});
