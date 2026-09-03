import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  storageBuckets: [] as string[],
  registryEnabled: false,
  registerIntent: vi.fn(),
  registerReceipt: vi.fn(),
  assertOpen: vi.fn(),
  assertReplaying: vi.fn(),
}));

vi.mock('../privacy-deletion-registry', () => ({
  isPrivacyDeletionRegistryEnabled: () => mocks.registryEnabled,
  registerDeletionIntent: mocks.registerIntent,
  registerDeletionAppliedReceipt: mocks.registerReceipt,
}));

vi.mock('../privacy-recovery-gate', () => ({
  assertPrivacyOperationsOpen: mocks.assertOpen,
  assertPrivacyRecoveryReplaying: mocks.assertReplaying,
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    storage: {
      from: (bucket: string) => {
        mocks.storageBuckets.push(bucket);
        return { remove: mocks.remove, list: mocks.list };
      },
    },
  },
}));

import {
  eraseScreenedLead,
  isChannelSubjectPrivacySuppressed,
  listPendingScreenedLeadPrivacyCleanups,
  purgeExpiredPrivacyAuditEnvelopes,
  removeIntakeSessionAttachments,
} from '../screened-lead-erasure';

const FIRM_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const PROVIDER_EVIDENCE = {
  metaStatus: 'completed' as const,
  resendStatus: 'not_applicable' as const,
};

function pendingPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      ok: true,
      redacted_count: 1,
      lead_id: 'L-2026-09-02-001',
      deletion_request_id: REQUEST_ID,
      privacy_redacted_at: '2026-09-02T20:00:00.000Z',
      external_cleanup_status: 'pending',
      external_cleanup_manifest: {
        version: 1,
        storage_objects: [],
        external_systems: {
          ghl: { status: 'manual_required', selectors: { lead_id: 'external-1' } },
          meta: { status: 'provider_managed', sender_ids: [] },
          resend: { status: 'provider_managed' },
        },
      },
      ...overrides,
    },
    error: null,
  };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.remove.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.list.mockReset().mockResolvedValue({ data: [], error: null });
  mocks.storageBuckets = [];
  mocks.registryEnabled = false;
  mocks.registerIntent.mockReset().mockResolvedValue('created');
  mocks.registerReceipt.mockReset().mockResolvedValue('created');
  mocks.assertOpen.mockReset().mockResolvedValue(undefined);
  mocks.assertReplaying.mockReset().mockResolvedValue(undefined);
});

describe('eraseScreenedLead', () => {
  it('fails before the local mutation when the enabled registry is unavailable', async () => {
    mocks.registryEnabled = true;
    mocks.registerIntent.mockRejectedValueOnce(new Error('registry unavailable'));

    const result = await eraseScreenedLead({
      firmId: FIRM_ID, leadId: 'L-2026-09-02-001', reason: 'subject_request', deletionRequestId: REQUEST_ID,
      externalDeletion: { erase: vi.fn() },
    });

    expect(result).toMatchObject({ ok: false, database_redacted: false, error: 'external privacy deletion saga is unavailable' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('completes the external adapter before the local terminal mutation', async () => {
    mocks.registryEnabled = true;
    const sequence: string[] = [];
    mocks.registerIntent.mockImplementationOnce(async () => { sequence.push('intent'); return 'created'; });
    mocks.registerReceipt.mockImplementationOnce(async () => { sequence.push('receipt'); return 'created'; });
    mocks.rpc.mockImplementationOnce(async () => {
      sequence.push('database');
      return pendingPayload({ external_cleanup_status: 'complete' });
    });
    const adapter = { erase: vi.fn(async () => {
      sequence.push('external');
      return { ok: true, cleanup: { ghlStatus: 'completed' as const, metaStatus: 'completed' as const, resendStatus: 'not_applicable' as const } };
    }) };

    const result = await eraseScreenedLead({
      firmId: FIRM_ID, leadId: 'L-2026-09-02-001', reason: 'subject_request', deletionRequestId: REQUEST_ID,
      externalDeletion: adapter,
    });

    expect(result.ok).toBe(true);
    expect(sequence).toEqual(['intent', 'external', 'database', 'receipt']);
  });

  it('calls the atomic primitive with the exact firm and lead scope', async () => {
    mocks.rpc.mockResolvedValueOnce(pendingPayload());

    const result = await eraseScreenedLead({
      firmId: FIRM_ID,
      leadId: 'L-2026-09-02-001',
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
    });

    expect(mocks.rpc).toHaveBeenCalledWith('redact_screened_lead_subject', {
      p_firm_id: FIRM_ID,
      p_lead_id: 'L-2026-09-02-001',
      p_reason: 'subject_request',
      p_deletion_request_id: REQUEST_ID,
    });
    expect(result).toMatchObject({
      ok: false,
      database_redacted: true,
      external_cleanup_status: 'pending',
      pending_cleanup_categories: ['ghl', 'meta', 'resend'],
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('returns the original deletion request on an idempotent retry', async () => {
    const originalRequest = '33333333-3333-4333-8333-333333333333';
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        redacted_count: 0,
        deletion_request_id: originalRequest,
        privacy_redacted_at: '2026-09-02T20:00:00.000Z',
        external_cleanup_status: 'complete',
        external_cleanup_manifest: {},
      },
      error: null,
    });

    const result = await eraseScreenedLead({
      firmId: FIRM_ID,
      leadId: 'L-2026-09-02-001',
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
    });

    expect(result).toMatchObject({
      ok: true,
      redacted_count: 0,
      deletion_request_id: originalRequest,
      external_cleanup_status: 'complete',
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('reports an enumeration-safe missing subject as a no-op', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        redacted_count: 0,
        deletion_request_id: REQUEST_ID,
        external_cleanup_status: 'not_applicable',
        external_cleanup_manifest: {},
      },
      error: null,
    });

    const result = await eraseScreenedLead({
      firmId: FIRM_ID,
      leadId: 'L-NOT-FOUND',
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
    });

    expect(result).toMatchObject({
      ok: true,
      database_redacted: false,
      redacted_count: 0,
      external_cleanup_status: 'not_applicable',
    });
  });

  it('does not mark a pending request complete from a missing manifest', async () => {
    mocks.rpc.mockResolvedValueOnce(
      pendingPayload({ external_cleanup_manifest: {} }),
    );

    const result = await eraseScreenedLead({
      firmId: FIRM_ID,
      leadId: 'L-2026-09-02-001',
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
    });

    expect(result.ok).toBe(false);
    expect(result.pending_cleanup_categories).toContain('manifest_version');
    expect(result.pending_cleanup_categories).toContain('storage_objects');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('does not treat provider-managed location markers as completion evidence', async () => {
    mocks.rpc.mockResolvedValueOnce(
      pendingPayload({
        external_cleanup_manifest: {
          version: 1,
          storage_objects: [],
          external_systems: {
            ghl: { status: 'not_applicable' },
            meta: { status: 'provider_managed' },
            resend: { status: 'provider_managed' },
          },
        },
      }),
    );

    const result = await eraseScreenedLead({
      firmId: FIRM_ID,
      leadId: 'L-2026-09-02-001',
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
      externalCleanup: {
        metaStatus: 'provider_managed',
        resendStatus: 'provider_managed',
      } as unknown as NonNullable<Parameters<typeof eraseScreenedLead>[0]['externalCleanup']>,
    });

    expect(result).toMatchObject({
      ok: false,
      external_cleanup_status: 'pending',
      pending_cleanup_categories: ['meta', 'resend'],
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('removes only manifest storage objects before acknowledging completion', async () => {
    mocks.rpc
      .mockResolvedValueOnce(
        pendingPayload({
          external_cleanup_manifest: {
            version: 1,
            storage_objects: [
              { bucket: 'intake-attachments', path: `${FIRM_ID}/session-1/offer.pdf` },
              { bucket: 'intake-attachments', path: `${FIRM_ID}/session-1/offer.pdf` },
            ],
            external_systems: {
              ghl: { status: 'manual_required' },
              meta: { status: 'provider_managed' },
              resend: { status: 'provider_managed' },
            },
          },
        }),
      )
      .mockResolvedValueOnce({ data: { ok: true }, error: null });

    const result = await eraseScreenedLead({
      firmId: FIRM_ID,
      leadId: 'L-2026-09-02-001',
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
      externalCleanup: {
        ghlStatus: 'completed',
        ...PROVIDER_EVIDENCE,
      },
    });

    expect(mocks.storageBuckets).toEqual(['intake-attachments']);
    expect(mocks.remove).toHaveBeenCalledWith([
      `${FIRM_ID}/session-1/offer.pdf`,
    ]);
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      'complete_screened_lead_external_cleanup',
      {
        p_firm_id: FIRM_ID,
        p_deletion_request_id: REQUEST_ID,
        p_cleanup_summary: {
          storage_deleted_count: 1,
          ghl_status: 'completed',
          meta_status: 'completed',
          resend_status: 'not_applicable',
        },
      },
    );
    expect(result).toMatchObject({
      ok: true,
      storage_objects_removed: 1,
      external_cleanup_status: 'complete',
    });
  });

  it('removes an exact legacy Screen session prefix supplied by the atomic manifest', async () => {
    mocks.rpc
      .mockResolvedValueOnce(
        pendingPayload({
          external_cleanup_manifest: {
            version: 1,
            storage_objects: [
              {
                bucket: 'intake-attachments',
                prefix: `${FIRM_ID}/22222222-2222-4222-8222-222222222222`,
              },
            ],
            external_systems: {
              ghl: { status: 'not_applicable' },
              meta: { status: 'provider_managed' },
              resend: { status: 'provider_managed' },
            },
          },
        }),
      )
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    mocks.list.mockResolvedValueOnce({
      data: [{ name: 'offer.pdf' }],
      error: null,
    });

    const result = await eraseScreenedLead({
      firmId: FIRM_ID,
      leadId: 'L-S1-22222222-2222-4222-8222-222222222222',
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
      externalCleanup: PROVIDER_EVIDENCE,
    });

    expect(mocks.list).toHaveBeenCalledWith(
      `${FIRM_ID}/22222222-2222-4222-8222-222222222222`,
      expect.objectContaining({ limit: 1000, offset: 0 }),
    );
    expect(mocks.remove).toHaveBeenCalledWith([
      `${FIRM_ID}/22222222-2222-4222-8222-222222222222/offer.pdf`,
    ]);
    expect(result).toMatchObject({
      ok: true,
      storage_objects_removed: 1,
    });
  });

  it('leaves the durable request pending when Storage cleanup fails', async () => {
    mocks.rpc.mockResolvedValueOnce(
      pendingPayload({
        external_cleanup_manifest: {
          version: 1,
          storage_objects: [
            { bucket: 'intake-attachments', path: `${FIRM_ID}/session-1/offer.pdf` },
          ],
          external_systems: {
            ghl: { status: 'not_applicable' },
            meta: { status: 'provider_managed' },
            resend: { status: 'provider_managed' },
          },
        },
      }),
    );
    mocks.remove.mockResolvedValueOnce({
      data: null,
      error: { message: 'storage unavailable' },
    });

    const result = await eraseScreenedLead({
      firmId: FIRM_ID,
      leadId: 'L-2026-09-02-001',
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
      externalCleanup: {
        ...PROVIDER_EVIDENCE,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      database_redacted: true,
      external_cleanup_status: 'pending',
      pending_cleanup_categories: ['storage_objects'],
    });
    expect(result.error).not.toContain('storage unavailable');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('refuses an unexpected storage bucket without deleting from it', async () => {
    mocks.rpc.mockResolvedValueOnce(
      pendingPayload({
        external_cleanup_manifest: {
          version: 1,
          storage_objects: [{ bucket: 'deliverables', path: 'anything' }],
          external_systems: {
            ghl: { status: 'not_applicable' },
            meta: { status: 'provider_managed' },
            resend: { status: 'provider_managed' },
          },
        },
      }),
    );

    const result = await eraseScreenedLead({
      firmId: FIRM_ID,
      leadId: 'L-2026-09-02-001',
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
      externalCleanup: {
        ...PROVIDER_EVIDENCE,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('unsupported storage cleanup target');
    expect(mocks.storageBuckets).not.toContain('deliverables');
  });

  it('refuses a manifest object outside the requested firm namespace', async () => {
    mocks.rpc.mockResolvedValueOnce(
      pendingPayload({
        external_cleanup_manifest: {
          version: 1,
          storage_objects: [
            {
              bucket: 'intake-attachments',
              path: '99999999-9999-4999-8999-999999999999/session-1/offer.pdf',
            },
          ],
          external_systems: {
            ghl: { status: 'not_applicable' },
            meta: { status: 'provider_managed' },
            resend: { status: 'provider_managed' },
          },
        },
      }),
    );

    const result = await eraseScreenedLead({
      firmId: FIRM_ID,
      leadId: 'L-2026-09-02-001',
      reason: 'subject_request',
      deletionRequestId: REQUEST_ID,
      externalCleanup: {
        ...PROVIDER_EVIDENCE,
      },
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'unsupported storage cleanup target',
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe('removeIntakeSessionAttachments', () => {
  it('uses one exact firm/session prefix and relists offset zero', async () => {
    mocks.list
      .mockResolvedValueOnce({ data: [{ name: 'one.pdf' }, { name: 'two.png' }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const result = await removeIntakeSessionAttachments(FIRM_ID, 'session-1');

    expect(mocks.list).toHaveBeenCalledWith(`${FIRM_ID}/session-1`, {
      limit: 1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    });
    expect(mocks.remove).toHaveBeenCalledWith([
      `${FIRM_ID}/session-1/one.pdf`,
      `${FIRM_ID}/session-1/two.png`,
    ]);
    expect(result).toEqual({ ok: true, removed: 2 });
  });
});

describe('purgeExpiredPrivacyAuditEnvelopes', () => {
  it('delegates age eligibility to the database and reports counts', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        retention_period: '3 years',
        eligible_request_count: 2,
        purged_event_count: 7,
        purged_channel_event_count: 4,
        purged_consent_event_count: 2,
        purged_attribution_event_count: 1,
        remaining_eligible_count: 3,
        has_more: true,
      },
      error: null,
    });

    const result = await purgeExpiredPrivacyAuditEnvelopes(75);

    expect(mocks.rpc).toHaveBeenCalledWith(
      'purge_expired_privacy_audit_envelopes',
      { p_limit: 75 },
    );
    expect(result).toEqual({
      ok: true,
      retention_period: '3 years',
      eligible_request_count: 2,
      purged_event_count: 7,
      purged_channel_event_count: 4,
      purged_consent_event_count: 2,
      purged_attribution_event_count: 1,
      remaining_eligible_count: 3,
      has_more: true,
    });
  });

  it('surfaces expiry refusal rather than reporting a successful sweep', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { ok: false, error: 'p_limit must be between 1 and 1000' },
      error: null,
    });

    await expect(purgeExpiredPrivacyAuditEnvelopes(1001)).resolves.toMatchObject({
      ok: false,
      eligible_request_count: 0,
      purged_event_count: 0,
      error: 'p_limit must be between 1 and 1000',
    });
  });
});

describe('isChannelSubjectPrivacySuppressed', () => {
  it('passes the subject identifier only to the firm-scoped service RPC', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });

    const result = await isChannelSubjectPrivacySuppressed({
      firmId: FIRM_ID,
      channel: 'instagram',
      senderId: 'igsid-private',
    });

    expect(result).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'is_channel_subject_privacy_suppressed',
      {
        p_firm_id: FIRM_ID,
        p_channel: 'instagram',
        p_sender_id: 'igsid-private',
      },
    );
  });

  it('fails closed when the suppression register cannot be checked', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection reset' },
    });

    await expect(
      isChannelSubjectPrivacySuppressed({
        firmId: FIRM_ID,
        channel: 'facebook',
        senderId: 'psid-private',
      }),
    ).rejects.toThrow('channel privacy suppression lookup failed');
  });
});

describe('listPendingScreenedLeadPrivacyCleanups', () => {
  it('returns bounded coordinator keys without fetching the PII manifest', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        pending_count: 1,
        requests: [
          {
            firm_id: FIRM_ID,
            screened_lead_id: '44444444-4444-4444-8444-444444444444',
            current_lead_id:
              'privacy-redacted:44444444-4444-4444-8444-444444444444',
            deletion_request_id: REQUEST_ID,
          },
        ],
      },
      error: null,
    });

    const result = await listPendingScreenedLeadPrivacyCleanups(50);

    expect(mocks.rpc).toHaveBeenCalledWith(
      'list_pending_screened_lead_privacy_cleanups',
      { p_limit: 50 },
    );
    expect(result).toMatchObject({ ok: true, pending_count: 1 });
    expect(result.requests[0]).not.toHaveProperty('external_cleanup_manifest');
  });

  it('rejects malformed rows rather than silently losing a retry', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        pending_count: 1,
        requests: [{ firm_id: FIRM_ID }],
      },
      error: null,
    });

    await expect(listPendingScreenedLeadPrivacyCleanups()).resolves.toMatchObject({
      ok: false,
      requests: [],
      error: 'pending privacy cleanup listing returned an invalid row',
    });
  });
});
