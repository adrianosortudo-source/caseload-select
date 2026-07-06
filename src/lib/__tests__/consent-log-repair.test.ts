/**
 * Consent-log repair sweep tests.
 *
 * Mocks @/lib/supabase-admin with a small chainable query builder keyed by
 * table name (same convention as agency-prospect-import.test.ts): the
 * screened_leads table resolves to a fixed candidate list, the consent_log
 * table simulates the existence check (count) and the insert, with a
 * per-test toggle to force an insert error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state: {
    leads: Record<string, unknown>[];
    existingSubjectIds: Set<string>;
    insertedRows: Record<string, unknown>[];
    failExistsCheck: boolean;
    failInsertForSubjectIds: Set<string>;
  } = {
    leads: [],
    existingSubjectIds: new Set<string>(),
    insertedRows: [],
    failExistsCheck: false,
    failInsertForSubjectIds: new Set<string>(),
  };

  function makeScreenedLeadsQuery() {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      in: () => q,
      order: () => q,
      limit: () => Promise.resolve({ data: state.leads, error: null }),
    });
    return q;
  }

  function makeConsentLogQuery() {
    let mode: 'count' | 'insert' | null = null;
    let eqFilters: Record<string, unknown> = {};
    let insertedRow: Record<string, unknown> | null = null;

    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => {
        mode = 'count';
        return q;
      },
      eq: (key: string, value: unknown) => {
        eqFilters = { ...eqFilters, [key]: value };
        return q;
      },
      insert: (row: Record<string, unknown>) => {
        mode = 'insert';
        insertedRow = row;
        return q;
      },
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
        if (mode === 'count') {
          if (state.failExistsCheck) {
            return Promise.resolve({ count: null, error: { message: 'exists check boom' } }).then(
              onFulfilled,
              onRejected,
            );
          }
          const subjectId = eqFilters['subject_id'] as string;
          const exists = state.existingSubjectIds.has(subjectId);
          return Promise.resolve({ count: exists ? 1 : 0, error: null }).then(onFulfilled, onRejected);
        }
        if (mode === 'insert') {
          const subjectId = insertedRow?.subject_id as string;
          if (state.failInsertForSubjectIds.has(subjectId)) {
            return Promise.resolve({ data: null, error: { message: 'insert boom' } }).then(
              onFulfilled,
              onRejected,
            );
          }
          state.insertedRows.push(insertedRow as Record<string, unknown>);
          return Promise.resolve({ data: [insertedRow], error: null }).then(onFulfilled, onRejected);
        }
        return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
      },
    });
    return q;
  }

  return {
    state,
    supabaseAdmin: {
      from: (table: string) => {
        if (table === 'screened_leads') return makeScreenedLeadsQuery();
        if (table === 'consent_log') return makeConsentLogQuery();
        throw new Error(`unexpected table in test: ${table}`);
      },
    },
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: h.supabaseAdmin }));

import { runConsentLogRepairSweep } from '@/lib/consent-log-repair';

beforeEach(() => {
  h.state.leads = [];
  h.state.existingSubjectIds = new Set<string>();
  h.state.insertedRows = [];
  h.state.failExistsCheck = false;
  h.state.failInsertForSubjectIds = new Set<string>();
});

describe('runConsentLogRepairSweep', () => {
  it('repairs an explicit-consent lead with no existing consent_log row', async () => {
    h.state.leads = [
      {
        id: 'lead-1',
        firm_id: 'firm-1',
        email_consent_status: 'explicit',
        email_consent_captured_at: '2026-06-01T00:00:00.000Z',
        six_month_expiry_date: null,
        consent_ip: '1.2.3.4',
        consent_user_agent: 'ua-1',
        submitted_at: '2026-06-01T00:00:00.000Z',
      },
    ];

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

  it('does not insert when a consent_log row already exists for the subject', async () => {
    h.state.leads = [
      {
        id: 'lead-2',
        firm_id: 'firm-1',
        email_consent_status: 'explicit',
        email_consent_captured_at: '2026-06-01T00:00:00.000Z',
        six_month_expiry_date: null,
        consent_ip: null,
        consent_user_agent: null,
        submitted_at: '2026-06-01T00:00:00.000Z',
      },
    ];
    h.state.existingSubjectIds = new Set(['lead-2']);

    const result = await runConsentLogRepairSweep();

    expect(result).toMatchObject({ scanned: 1, missing: 0, repaired: 0, failed: 0 });
    expect(h.state.insertedRows).toHaveLength(0);
  });

  it('handles an implied-consent lead with implied_set/implied_inquiry and the lead expiry', async () => {
    h.state.leads = [
      {
        id: 'lead-3',
        firm_id: 'firm-2',
        email_consent_status: 'implied',
        email_consent_captured_at: null,
        six_month_expiry_date: '2026-12-01T00:00:00.000Z',
        consent_ip: '5.6.7.8',
        consent_user_agent: 'ua-3',
        submitted_at: '2026-06-01T12:00:00.000Z',
      },
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
    h.state.leads = [
      {
        id: 'lead-4',
        firm_id: 'firm-1',
        email_consent_status: 'explicit',
        email_consent_captured_at: '2026-06-01T00:00:00.000Z',
        six_month_expiry_date: null,
        consent_ip: null,
        consent_user_agent: null,
        submitted_at: '2026-06-01T00:00:00.000Z',
      },
    ];
    h.state.failInsertForSubjectIds = new Set(['lead-4']);

    const result = await runConsentLogRepairSweep();

    expect(result).toMatchObject({ scanned: 1, missing: 1, repaired: 0, failed: 1 });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('lead-4');
  });

  it('respects the limit option', async () => {
    let seenLimit: number | undefined;
    const originalFrom = h.supabaseAdmin.from;
    h.supabaseAdmin.from = ((table: string) => {
      if (table !== 'screened_leads') return originalFrom(table);
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        in: () => q,
        order: () => q,
        limit: (n: number) => {
          seenLimit = n;
          return Promise.resolve({ data: [], error: null });
        },
      });
      return q;
    }) as typeof h.supabaseAdmin.from;

    await runConsentLogRepairSweep({ limit: 17 });

    expect(seenLimit).toBe(17);

    h.supabaseAdmin.from = originalFrom;
  });
});
