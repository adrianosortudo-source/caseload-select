/**
 * Pins the F-04 regression fix: recordApproval now delegates to the
 * record_approval_atomic Postgres RPC instead of doing a status-update-then-
 * insert in the application layer.
 *
 * The contract:
 *   - calls supabase.rpc('record_approval_atomic', { ...params })
 *   - returns ok with the full ApprovalRecord on RPC ok
 *   - returns { ok: false, stale: true } when the RPC reports stale
 *   - returns { ok: false, error } when the RPC returns a non-stale error
 *
 * If a future refactor reintroduces an application-layer transaction (and the
 * crash window with it), these tests fail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

interface State {
  rpcCalls: Array<{ name: string; params: unknown }>;
  rpcResult: { data: unknown; error: { message: string } | null };
  fetchedRecord: { data: unknown; error: { message: string } | null };
  notificationEnqueued: boolean;
  fetchedMatter: unknown;
  insertedRows: Array<unknown>;
}

const state: State = {
  rpcCalls: [],
  rpcResult: { data: { ok: true, record_id: 'rec-1', created_at: 'now' }, error: null },
  fetchedRecord: { data: null, error: null },
  notificationEnqueued: false,
  fetchedMatter: { title: 'T' },
  insertedRows: [],
};

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: (name: string, params: unknown) => {
      state.rpcCalls.push({ name, params });
      return Promise.resolve(state.rpcResult);
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve(state.fetchedRecord),
          maybeSingle: () => Promise.resolve(state.fetchedMatter ? { data: state.fetchedMatter } : { data: null }),
        }),
      }),
      insert: (rows: unknown) => {
        state.insertedRows.push(rows);
        state.notificationEnqueued = true;
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import { recordApproval } from '@/lib/deliverables';

const baseInput = {
  deliverableId: 'd1',
  versionId: 'v1',
  versionNumber: 2,
  firmId: 'f1',
  deliverableTitle: 'Article draft',
  decision: 'approved' as const,
  attestation: 'I agree to LSO 4.2-1.',
  signer: { id: 'law1', name: 'Damaris', email: 'd@firm.ca' },
  ipAddress: '203.0.113.7',
  userAgent: 'UA/1.0',
  note: null,
};

const fullRecord = {
  id: 'rec-1',
  deliverable_id: 'd1',
  version_id: 'v1',
  firm_id: 'f1',
  decision: 'approved',
  signer_role: 'lawyer',
  signer_id: 'law1',
  signer_name: 'Damaris',
  signer_email: 'd@firm.ca',
  attestation: 'I agree to LSO 4.2-1.',
  version_number: 2,
  deliverable_title: 'Article draft',
  ip_address: '203.0.113.7',
  user_agent: 'UA/1.0',
  note: null,
  created_at: 'now',
};

beforeEach(() => {
  state.rpcCalls = [];
  state.rpcResult = { data: { ok: true, record_id: 'rec-1', created_at: 'now' }, error: null };
  state.fetchedRecord = { data: fullRecord, error: null };
  state.notificationEnqueued = false;
  state.insertedRows = [];
});

describe('recordApproval -> record_approval_atomic RPC', () => {
  it('invokes the atomic RPC with the frozen attestation, signer, IP, UA, version', async () => {
    const res = await recordApproval(baseInput);
    expect(res.ok).toBe(true);
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].name).toBe('record_approval_atomic');
    const p = state.rpcCalls[0].params as Record<string, unknown>;
    expect(p.p_deliverable_id).toBe('d1');
    expect(p.p_version_id).toBe('v1');
    expect(p.p_firm_id).toBe('f1');
    expect(p.p_decision).toBe('approved');
    expect(p.p_signer_role).toBe('lawyer');
    expect(p.p_signer_email).toBe('d@firm.ca');
    expect(p.p_attestation).toContain('4.2-1');
    expect(p.p_version_number).toBe(2);
    expect(p.p_ip_address).toBe('203.0.113.7');
    expect(p.p_user_agent).toBe('UA/1.0');
  });

  it('returns stale=true when the RPC reports a version drift', async () => {
    state.rpcResult = { data: { ok: false, stale: true, error: 'a newer version exists' }, error: null };
    const res = await recordApproval(baseInput);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.stale).toBe(true);
    }
  });

  it('returns a non-stale error when the RPC returns ok=false without stale', async () => {
    state.rpcResult = { data: { ok: false, error: 'deliverable not found' }, error: null };
    const res = await recordApproval(baseInput);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('deliverable not found');
      expect(res.stale).toBeFalsy();
    }
  });

  it('surfaces transport errors as a 500-class result', async () => {
    state.rpcResult = { data: null, error: { message: 'connection reset' } };
    const res = await recordApproval(baseInput);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('connection reset');
    }
  });

  it('does NOT perform an application-layer status update before insert (regression pin)', async () => {
    // The previous app-layer code called .from("content_deliverables").update(...)
    // BEFORE .from("approval_records").insert(...). With the RPC, no plain table
    // update/insert against either table happens. The only writes through the
    // mocked client are the notification_outbox insert and the record fetch.
    await recordApproval(baseInput);
    const tableWrites = state.insertedRows.filter((r) => r !== null);
    // The only insert path the mock exposes is .from(...).insert, which the
    // notification enqueue uses. Anything else would imply the app-layer
    // transaction is back.
    expect(tableWrites.length).toBeLessThanOrEqual(1);
  });
});
