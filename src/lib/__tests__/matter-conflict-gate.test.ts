/**
 * Canonical conflict gate tests for checkStageGate (Gate 2, H4).
 *
 * Coverage:
 *   - no conflict check on file blocks retainer_pending and active
 *   - pending status blocks
 *   - potential status blocks
 *   - blocked status blocks
 *   - cleared status allows
 *   - waived with a verified consent_log row allows
 *   - waived without waiver_consent_id blocks
 *   - waived with a waiver_consent_id that resolves to no row blocks
 *   - waived with a consent_log row of the wrong consent_type blocks
 *   - waived with a consent_log row that is not consent_status='granted' blocks
 *   - waived with a consent_log row belonging to a different firm blocks
 *   - non-gate stages (closing, closed) are not affected by conflict state
 *   - the legacy 'conflict_checks' table is never queried; only 'screened_conflict_checks' is used
 *
 * Gate 1 (contact info) is bypassed in these tests by supplying full contact
 * so failures isolate cleanly to Gate 2.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GateMatterInput } from '@/lib/matter-stage-gate';

vi.mock('server-only', () => ({}));

interface ConflictRow {
  check_status: string;
  waiver_consent_id: string | null;
}

interface ConsentRow {
  firm_id: string;
  consent_type: string;
  consent_status: string;
}

// Mutable state so each test can inject a different conflict row / consent row.
const mockState = {
  conflictRow: null as ConflictRow | null,
  consentRow: null as ConsentRow | null,
  // Track which tables were queried to prove legacy table is not consulted.
  queriedTables: [] as string[],
};

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      mockState.queriedTables.push(table);
      if (table === 'screened_conflict_checks') {
        const chain: Record<string, unknown> = {};
        const noop = () => chain;
        chain.select = noop;
        chain.eq = noop;
        chain.order = noop;
        chain.limit = noop;
        chain.maybeSingle = () =>
          Promise.resolve({ data: mockState.conflictRow, error: null });
        return chain;
      }
      if (table === 'consent_log') {
        const chain: Record<string, unknown> = {};
        const noop = () => chain;
        chain.select = noop;
        chain.eq = noop;
        chain.maybeSingle = () =>
          Promise.resolve({ data: mockState.consentRow, error: null });
        return chain;
      }
      // Any other table returns null -- this proves legacy conflict_checks
      // is never queried (if it were, the gate would fail incorrectly).
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        }),
      };
    },
  },
}));

// Import after the mock is in place.
import { checkStageGate } from '@/lib/matter-stage-gate';

function matter(overrides: Partial<GateMatterInput> = {}): GateMatterInput {
  return {
    id: 'matter-h4',
    firm_id: 'firm-h4',
    source_screened_lead_id: 'sl-h4',
    primary_name: 'Alex Marrero',
    primary_email: 'alex@example.com',
    primary_phone: null,
    ...overrides,
  };
}

const VALID_WAIVER_CONSENT: ConsentRow = {
  firm_id: 'firm-h4',
  consent_type: 'conflict_waiver',
  consent_status: 'granted',
};

beforeEach(() => {
  mockState.conflictRow = null;
  mockState.consentRow = null;
  mockState.queriedTables = [];
});

describe('checkStageGate conflict gate: no check on file', () => {
  it('no row in screened_conflict_checks blocks retainer_pending', async () => {
    mockState.conflictRow = null;
    const r = await checkStageGate(matter(), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('conflict_not_cleared');
  });

  it('no row in screened_conflict_checks blocks active', async () => {
    mockState.conflictRow = null;
    const r = await checkStageGate(matter(), 'active');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('conflict_not_cleared');
  });
});

describe('checkStageGate conflict gate: pending and potential block', () => {
  it('pending status blocks retainer_pending', async () => {
    mockState.conflictRow = { check_status: 'pending', waiver_consent_id: null };
    const r = await checkStageGate(matter(), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('conflict_not_cleared');
  });

  it('pending status blocks active', async () => {
    mockState.conflictRow = { check_status: 'pending', waiver_consent_id: null };
    const r = await checkStageGate(matter(), 'active');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('conflict_not_cleared');
  });

  it('potential status blocks retainer_pending', async () => {
    mockState.conflictRow = { check_status: 'potential', waiver_consent_id: null };
    const r = await checkStageGate(matter(), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('conflict_not_cleared');
  });

  it('potential status blocks active', async () => {
    mockState.conflictRow = { check_status: 'potential', waiver_consent_id: null };
    const r = await checkStageGate(matter(), 'active');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('conflict_not_cleared');
  });

  it('blocked status blocks retainer_pending', async () => {
    mockState.conflictRow = { check_status: 'blocked', waiver_consent_id: null };
    const r = await checkStageGate(matter(), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('conflict_not_cleared');
  });

  it('blocked status blocks active', async () => {
    mockState.conflictRow = { check_status: 'blocked', waiver_consent_id: null };
    const r = await checkStageGate(matter(), 'active');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('conflict_not_cleared');
  });
});

describe('checkStageGate conflict gate: cleared allows', () => {
  it('cleared allows retainer_pending', async () => {
    mockState.conflictRow = { check_status: 'cleared', waiver_consent_id: null };
    const r = await checkStageGate(matter(), 'retainer_pending');
    expect(r.allowed).toBe(true);
  });

  it('cleared allows active', async () => {
    mockState.conflictRow = { check_status: 'cleared', waiver_consent_id: null };
    const r = await checkStageGate(matter(), 'active');
    expect(r.allowed).toBe(true);
  });
});

describe('checkStageGate conflict gate: waived', () => {
  it('waived WITH a verified conflict_waiver consent_log row allows retainer_pending', async () => {
    mockState.conflictRow = { check_status: 'waived', waiver_consent_id: 'consent-uuid-001' };
    mockState.consentRow = VALID_WAIVER_CONSENT;
    const r = await checkStageGate(matter(), 'retainer_pending');
    expect(r.allowed).toBe(true);
  });

  it('waived WITH a verified conflict_waiver consent_log row allows active', async () => {
    mockState.conflictRow = { check_status: 'waived', waiver_consent_id: 'consent-uuid-001' };
    mockState.consentRow = VALID_WAIVER_CONSENT;
    const r = await checkStageGate(matter(), 'active');
    expect(r.allowed).toBe(true);
  });

  it('waived WITHOUT waiver_consent_id blocks (waiver reference required)', async () => {
    mockState.conflictRow = { check_status: 'waived', waiver_consent_id: null };
    const r = await checkStageGate(matter(), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('conflict_not_cleared');
  });

  it('waived with a waiver_consent_id that resolves to no consent_log row blocks', async () => {
    mockState.conflictRow = { check_status: 'waived', waiver_consent_id: 'consent-uuid-ghost' };
    mockState.consentRow = null;
    const r = await checkStageGate(matter(), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.code).toBe('conflict_not_cleared');
      expect(r.reason).toMatch(/does not exist/);
    }
  });

  it('waived with a consent_log row of the wrong consent_type blocks', async () => {
    mockState.conflictRow = { check_status: 'waived', waiver_consent_id: 'consent-uuid-001' };
    mockState.consentRow = { ...VALID_WAIVER_CONSENT, consent_type: 'express' };
    const r = await checkStageGate(matter(), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.code).toBe('conflict_not_cleared');
      expect(r.reason).toMatch(/not 'conflict_waiver'/);
    }
  });

  it('waived with a withdrawn consent_log row blocks', async () => {
    mockState.conflictRow = { check_status: 'waived', waiver_consent_id: 'consent-uuid-001' };
    mockState.consentRow = { ...VALID_WAIVER_CONSENT, consent_status: 'withdrawn' };
    const r = await checkStageGate(matter(), 'active');
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.code).toBe('conflict_not_cleared');
      expect(r.reason).toMatch(/not 'granted'/);
    }
  });

  it('waived with a consent_log row belonging to a different firm blocks (cross-firm waiver)', async () => {
    mockState.conflictRow = { check_status: 'waived', waiver_consent_id: 'consent-uuid-001' };
    mockState.consentRow = { ...VALID_WAIVER_CONSENT, firm_id: 'firm-someone-else' };
    const r = await checkStageGate(matter({ firm_id: 'firm-h4' }), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.code).toBe('conflict_not_cleared');
      expect(r.reason).toMatch(/different firm/);
    }
  });
});

describe('checkStageGate conflict gate: non-gate stages bypass conflict check', () => {
  it('closing stage is not in the conflict gate; no supabase query', async () => {
    mockState.conflictRow = null;
    const r = await checkStageGate(matter(), 'closing');
    expect(r.allowed).toBe(true);
    expect(mockState.queriedTables).not.toContain('screened_conflict_checks');
  });

  it('closed stage is not in the conflict gate; no supabase query', async () => {
    mockState.conflictRow = null;
    const r = await checkStageGate(matter(), 'closed');
    expect(r.allowed).toBe(true);
    expect(mockState.queriedTables).not.toContain('screened_conflict_checks');
  });
});

describe('checkStageGate conflict gate: legacy conflict_checks is not queried', () => {
  it('only screened_conflict_checks is queried, never conflict_checks', async () => {
    mockState.conflictRow = { check_status: 'cleared', waiver_consent_id: null };
    await checkStageGate(matter(), 'retainer_pending');
    expect(mockState.queriedTables).toContain('screened_conflict_checks');
    expect(mockState.queriedTables).not.toContain('conflict_checks');
  });

  it('legacy conflict_checks not queried for active stage either', async () => {
    mockState.conflictRow = { check_status: 'cleared', waiver_consent_id: null };
    await checkStageGate(matter(), 'active');
    expect(mockState.queriedTables).not.toContain('conflict_checks');
  });
});
