/**
 * Consent-log repair sweep tests.
 *
 * The sweep now finds gaps via a DB-side anti-join RPC
 * (find_leads_missing_email_consent_log): the RPC returns ONLY eligible leads
 * that lack an email consent_log row, regardless of age, so there is no
 * per-lead existence check in app code anymore (Codex audit 2026-07-07,
 * finding 2). @/lib/supabase-admin is mocked: supabase.rpc(name, args)
 * resolves to a configured candidate list, and from('consent_log').insert()
 * records the row (with a per-subject toggle to force an insert error).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state: {
    missingLeads: Record<string, unknown>[];
    rpcError: { message: string } | null;
    insertedRows: Record<string, unknown>[];
    failInsertForSubjectIds: Set<string>;
    lastRpc: { name: string; args: unknown } | null;
  } = {
    missingLeads: [],
    rpcError: null,
    insertedRows: [],
    failInsertForSubjectIds: new Set<string>(),
    lastRpc: null,
  };

  function makeConsentLogQuery() {
    let insertedRow: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      insert: (row: Record<string, unknown>) => {
        insertedRow = row;
        return q;
      },
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
        const subjectId = insertedRow?.subject_id as string;
        if (state.failInsertForSubjectIds.has(subjectId)) {
          return Promise.resolve({ data: null, error: { message: 'insert boom' } }).then(onFulfilled, onRejected);
        }
        state.insertedRows.push(insertedRow as Record<string, unknown>);
        return Promise.resolve({ data: [insertedRow], error: null }).then(onFulfilled, onRejected);
      },
    });
    return q;
  }

  return {
    state,
    supabaseAdmin: {
      rpc: (name: string, args: unknown) => {
        state.lastRpc = { name, args };
        return Promise.resolve({ data: state.rpcError ? null : state.missingLeads, error: state.rpcError });
      },
      from: (table: string) => {
        if (table === 'consent_log') return makeConsentLogQuery();
        throw new Error(`unexpected table in test: ${table}`);
      },
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: h.supabaseAdmin }));

import { runConsentLogRepairSweep } from '@/lib/consent-log-repair';

function lead(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'lead-1',
    firm_id: 'firm-1',
    email_consent_status: 'explicit',
    email_consent_captured_at: '2026-06-01T00:00:00.000Z',
    six_month_expiry_date: null,
    consent_ip: '1.2.3.4',
    consent_user_agent: 'ua-1',
    submitted_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  h.state.missingLeads = [];
  h.state.rpcError = null;
  h.state.insertedRows = [];
  h.state.failInsertForSubjectIds = new Set<string>();
  h.state.lastRpc = null;
});

describe('runConsentLogRepairSweep', () => {
  it('repairs an explicit-consent lead the anti-join returns', async () => {
    h.state.missingLeads = [lead()];

    const result = await runConsentLogRepairSweep();

    expect(result).toMatchObject({ scanned: 1, missing: 1, repaired: 1, failed: 0 });
    expect(result.errors).toEqual([]);
    expect(h.state.insertedRows).toHaveLength(1);

    const row = h.state.insertedRows[0];
    expect(row.subject_id).toBe('lead-1');
    expect(row.firm_id).toBe('firm-1');
    expect(row.channel).toBe('email');
    expect(row.basis_source).toBe('backfill_repair');
    expect(row.event_type).toBe('consent_granted');
    expect(row.consent_type).toBe('express');
    expect(row.consent_status).toBe('granted');
    expect(row.obtained_at).toBe('2026-06-01T00:00:00.000Z');
    expect(row.captured_at).toBe('2026-06-01T00:00:00.000Z');
    expect(row.expires_at).toBeNull();
    expect(row.created_by).toBe('system');
    expect(typeof row.note).toBe('string');
    expect((row.note as string).length).toBeGreaterThan(0);
  });

  it('repairs a NEWER gap the old oldest-500 scan would have starved (finding 2)', async () => {
    // The old sweep loaded only the oldest 500 eligible leads and skipped the
    // covered ones, so once the oldest 500 all had logs, a newer missing lead
    // (lead 501) was never reached. The anti-join RPC returns exactly the
    // still-missing leads regardless of age, so lead 501 comes back here even
    // though 500 older leads already have evidence. The sweep must repair it.
    h.state.missingLeads = [
      lead({ id: 'lead-501', firm_id: 'firm-1', email_consent_status: 'implied', six_month_expiry_date: '2026-12-01T00:00:00.000Z', email_consent_captured_at: null, submitted_at: '2026-07-05T00:00:00.000Z' }),
    ];

    const result = await runConsentLogRepairSweep();

    expect(result).toMatchObject({ scanned: 1, missing: 1, repaired: 1, failed: 0 });
    expect(h.state.insertedRows).toHaveLength(1);
    expect(h.state.insertedRows[0].subject_id).toBe('lead-501');
    // The anti-join, not an app-side oldest-N scan, is the source of truth.
    expect(h.state.lastRpc?.name).toBe('find_leads_missing_email_consent_log');
  });

  it('no-ops when the anti-join returns nothing (all gaps already closed)', async () => {
    h.state.missingLeads = [];

    const result = await runConsentLogRepairSweep();

    expect(result).toMatchObject({ scanned: 0, missing: 0, repaired: 0, failed: 0 });
    expect(h.state.insertedRows).toHaveLength(0);
  });

  it('handles an implied-consent lead with implied_set/implied_inquiry and the lead expiry', async () => {
    h.state.missingLeads = [
      lead({
        id: 'lead-3',
        firm_id: 'firm-2',
        email_consent_status: 'implied',
        email_consent_captured_at: null,
        six_month_expiry_date: '2026-12-01T00:00:00.000Z',
        consent_ip: '5.6.7.8',
        consent_user_agent: 'ua-3',
        submitted_at: '2026-06-01T12:00:00.000Z',
      }),
    ];

    const result = await runConsentLogRepairSweep();

    expect(result).toMatchObject({ scanned: 1, missing: 1, repaired: 1, failed: 0 });
    const row = h.state.insertedRows[0];
    expect(row.event_type).toBe('implied_set');
    expect(row.consent_type).toBe('implied_inquiry');
    expect(row.expires_at).toBe('2026-12-01T00:00:00.000Z');
    // falls back to submitted_at since email_consent_captured_at is null
    expect(row.obtained_at).toBe('2026-06-01T12:00:00.000Z');
    expect(row.captured_at).toBe('2026-06-01T12:00:00.000Z');
  });

  it('increments failed and records the error message without throwing on insert failure', async () => {
    h.state.missingLeads = [lead({ id: 'lead-4' })];
    h.state.failInsertForSubjectIds = new Set(['lead-4']);

    const result = await runConsentLogRepairSweep();

    expect(result).toMatchObject({ scanned: 1, missing: 1, repaired: 0, failed: 1 });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('lead-4');
  });

  it('degrades to an honest empty summary when the anti-join RPC errors (deploy-safe)', async () => {
    h.state.rpcError = { message: 'function find_leads_missing_email_consent_log does not exist' };

    const result = await runConsentLogRepairSweep();

    expect(result).toMatchObject({ scanned: 0, missing: 0, repaired: 0, failed: 0 });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('anti-join failed');
    expect(h.state.insertedRows).toHaveLength(0);
  });

  it('passes the limit through to the RPC as batch_limit', async () => {
    h.state.missingLeads = [];

    await runConsentLogRepairSweep({ limit: 17 });

    expect(h.state.lastRpc?.name).toBe('find_leads_missing_email_consent_log');
    expect(h.state.lastRpc?.args).toEqual({ batch_limit: 17 });
  });
});
