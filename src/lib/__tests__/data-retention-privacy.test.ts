import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  screenedTarget: null as { id: string; lead_id: string; firm_id: string } | null,
  legacyTarget: null as { id: string; intake_session_id: string | null } | null,
  intakeSession: null as { id: string; firm_id: string } | null,
  updates: [] as Array<{
    table: string;
    payload: Record<string, unknown>;
    field: string;
    value: unknown;
  }>,
  filters: [] as Array<{ table: string; field: string; value: unknown }>,
  eraseScreenedLead: vi.fn(),
  listPendingScreenedLeadPrivacyCleanups: vi.fn(),
  removeIntakeSessionAttachments: vi.fn(),
}));

vi.mock('@/lib/caseload-prospect-erasure', () => ({
  runProspectRetentionSweep: vi.fn(),
}));
vi.mock('@/lib/screened-lead-erasure', () => ({
  eraseScreenedLead: mocks.eraseScreenedLead,
  listPendingScreenedLeadPrivacyCleanups:
    mocks.listPendingScreenedLeadPrivacyCleanups,
  removeIntakeSessionAttachments: mocks.removeIntakeSessionAttachments,
  purgeExpiredPrivacyAuditEnvelopes: vi.fn(),
}));
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => {
        const filters: Array<{ field: string; value: unknown }> = [];
        const chain = {
          eq(field: string, value: unknown) {
            filters.push({ field, value });
            mocks.filters.push({ table, field, value });
            return chain;
          },
          maybeSingle() {
            if (table === 'screened_leads') {
              const firmFilter = filters.find((filter) => filter.field === 'firm_id');
              const matchesFirm = !firmFilter || firmFilter.value === mocks.screenedTarget?.firm_id;
              return Promise.resolve({
                data: matchesFirm ? mocks.screenedTarget : null,
                error: null,
              });
            }
            if (table === 'leads') {
              return Promise.resolve({ data: mocks.legacyTarget, error: null });
            }
            if (table === 'intake_sessions') {
              return Promise.resolve({ data: mocks.intakeSession, error: null });
            }
            throw new Error(`unexpected maybeSingle table ${table}`);
          },
        };
        if (table === 'webhook_outbox') {
          return {
            eq(field: string, value: unknown) {
              mocks.filters.push({ table, field, value });
              return Promise.resolve({ data: [], error: null });
            },
          };
        }
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        const chain = {
          eq(field: string, value: unknown) {
            mocks.updates.push({ table, payload, field, value });
            return chain;
          },
          then(
            resolve: (value: { error: null }) => unknown,
            reject?: (error: unknown) => unknown,
          ) {
            return Promise.resolve({ error: null }).then(resolve, reject);
          },
        };
        return chain;
      },
    }),
  },
}));

import { purgeLeadPii } from '../data-retention';

const FIRM_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_FIRM_ID = '99999999-9999-4999-8999-999999999999';
const LEAD_UUID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  mocks.screenedTarget = null;
  mocks.legacyTarget = null;
  mocks.intakeSession = null;
  mocks.updates = [];
  mocks.filters = [];
  mocks.eraseScreenedLead.mockReset();
  mocks.listPendingScreenedLeadPrivacyCleanups.mockReset().mockResolvedValue({
    ok: true,
    pending_count: 0,
    requests: [],
  });
  mocks.eraseScreenedLead.mockResolvedValue({
    ok: true,
    database_redacted: false,
    redacted_count: 0,
    deletion_request_id: REQUEST_ID,
    privacy_redacted_at: null,
    external_cleanup_status: 'not_applicable',
    storage_objects_removed: 0,
    pending_cleanup_categories: [],
  });
  mocks.removeIntakeSessionAttachments.mockReset().mockResolvedValue({
    ok: true,
    removed: 0,
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('purgeLeadPii privacy scope', () => {
  it('clears only the exact legacy lead and its linked intake session', async () => {
    mocks.legacyTarget = { id: LEAD_UUID, intake_session_id: 'session-1' };
    mocks.intakeSession = { id: 'session-1', firm_id: FIRM_ID };
    mocks.removeIntakeSessionAttachments.mockResolvedValueOnce({ ok: true, removed: 2 });

    const result = await purgeLeadPii(LEAD_UUID, { firmId: FIRM_ID });

    expect(result).toMatchObject({ ok: true, legacy_lead_anonymized: true });
    expect(mocks.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'leads', field: 'id', value: LEAD_UUID }),
        expect.objectContaining({ table: 'intake_sessions', field: 'id', value: 'session-1' }),
      ]),
    );
    expect(mocks.updates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'intake_sessions', field: 'status', value: 'complete' }),
      ]),
    );
    expect(mocks.removeIntakeSessionAttachments).toHaveBeenCalledWith(
      FIRM_ID,
      'session-1',
    );
    expect(mocks.filters).toContainEqual({
      table: 'webhook_outbox',
      field: 'lead_id',
      value: LEAD_UUID,
    });
  });

  it('does not touch a legacy lead whose linked session belongs to another firm', async () => {
    mocks.legacyTarget = { id: LEAD_UUID, intake_session_id: 'session-1' };
    mocks.intakeSession = { id: 'session-1', firm_id: OTHER_FIRM_ID };

    const result = await purgeLeadPii(LEAD_UUID, { firmId: FIRM_ID });

    expect(result).toMatchObject({ ok: true, legacy_lead_anonymized: false });
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.removeIntakeSessionAttachments).not.toHaveBeenCalled();
  });

  it('passes tenant scope to the atomic screened-lead erasure and returns its durable request ID', async () => {
    const originalRequest = '44444444-4444-4444-8444-444444444444';
    mocks.screenedTarget = {
      id: '55555555-5555-4555-8555-555555555555',
      lead_id: 'L-2026-09-02-001',
      firm_id: FIRM_ID,
    };
    mocks.eraseScreenedLead.mockResolvedValueOnce({
      ok: true,
      database_redacted: true,
      redacted_count: 0,
      deletion_request_id: originalRequest,
      privacy_redacted_at: '2026-09-02T20:00:00.000Z',
      external_cleanup_status: 'complete',
      storage_objects_removed: 0,
      pending_cleanup_categories: [],
    });

    const result = await purgeLeadPii('L-2026-09-02-001', {
      firmId: FIRM_ID,
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
    });

    expect(mocks.eraseScreenedLead).toHaveBeenCalledWith({
      firmId: FIRM_ID,
      leadId: 'L-2026-09-02-001',
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
      externalCleanup: undefined,
    });
    expect(result).toMatchObject({
      ok: true,
      deletion_request_id: originalRequest,
      screened_lead_redacted: true,
    });
  });

  it('retries an already-redacted public lead ID through the tombstone even when lookup no longer finds it', async () => {
    mocks.eraseScreenedLead.mockResolvedValueOnce({
      ok: false,
      database_redacted: true,
      redacted_count: 0,
      deletion_request_id: REQUEST_ID,
      privacy_redacted_at: '2026-09-02T20:00:00.000Z',
      external_cleanup_status: 'pending',
      storage_objects_removed: 0,
      pending_cleanup_categories: ['ghl'],
      error: 'external privacy cleanup requires explicit operator completion',
    });

    const result = await purgeLeadPii('L-2026-09-02-001', {
      firmId: FIRM_ID,
      deletionRequestId: REQUEST_ID,
    });

    expect(mocks.eraseScreenedLead).toHaveBeenCalledWith(
      expect.objectContaining({
        firmId: FIRM_ID,
        leadId: 'L-2026-09-02-001',
        deletionRequestId: REQUEST_ID,
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      deletion_request_id: REQUEST_ID,
      screened_lead_redacted: true,
      external_cleanup_status: 'pending',
    });
  });

  it('recovers the tenant for an already-redacted legacy Screen public ID from its exact intake session', async () => {
    const publicLeadId = `L-S1-${LEAD_UUID}`;
    mocks.intakeSession = { id: LEAD_UUID, firm_id: FIRM_ID };
    mocks.eraseScreenedLead.mockResolvedValueOnce({
      ok: true,
      database_redacted: true,
      redacted_count: 0,
      deletion_request_id: REQUEST_ID,
      privacy_redacted_at: '2026-09-02T20:00:00.000Z',
      external_cleanup_status: 'complete',
      storage_objects_removed: 0,
      pending_cleanup_categories: [],
    });

    const result = await purgeLeadPii(publicLeadId);

    expect(mocks.eraseScreenedLead).toHaveBeenCalledWith(
      expect.objectContaining({
        firmId: FIRM_ID,
        leadId: publicLeadId,
      }),
    );
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.removeIntakeSessionAttachments).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      screened_lead_redacted: true,
    });
  });

  it('recovers a pending request by deletion request ID without requiring firm_id', async () => {
    const currentLeadId =
      'privacy-redacted:55555555-5555-4555-8555-555555555555';
    mocks.listPendingScreenedLeadPrivacyCleanups.mockResolvedValueOnce({
      ok: true,
      pending_count: 1,
      requests: [
        {
          firm_id: FIRM_ID,
          screened_lead_id: '55555555-5555-4555-8555-555555555555',
          current_lead_id: currentLeadId,
          deletion_request_id: REQUEST_ID,
        },
      ],
    });
    mocks.eraseScreenedLead.mockResolvedValueOnce({
      ok: true,
      database_redacted: true,
      redacted_count: 0,
      deletion_request_id: REQUEST_ID,
      privacy_redacted_at: '2026-09-02T20:00:00.000Z',
      external_cleanup_status: 'complete',
      storage_objects_removed: 0,
      pending_cleanup_categories: [],
    });

    const result = await purgeLeadPii('L-2026-09-02-001', {
      deletionRequestId: REQUEST_ID,
      externalCleanup: {
        ghlStatus: 'completed',
        metaStatus: 'completed',
        resendStatus: 'not_applicable',
      },
    });

    expect(mocks.listPendingScreenedLeadPrivacyCleanups).toHaveBeenCalledWith(1000);
    expect(mocks.eraseScreenedLead).toHaveBeenCalledWith(
      expect.objectContaining({
        firmId: FIRM_ID,
        leadId: currentLeadId,
        deletionRequestId: REQUEST_ID,
      }),
    );
    expect(result).toMatchObject({ ok: true, external_cleanup_status: 'complete' });
  });
});
