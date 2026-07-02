import { describe, it, expect, vi } from 'vitest';
import { checkStageGate, type GateMatterInput } from '@/lib/matter-stage-gate';

// supabase-admin imports server-only; mock the whole module.
vi.mock('server-only', () => ({}));

// Default: every conflict check query returns a cleared row so these tests
// focus on Gate 1 (contact info) without needing to set up conflict state.
// Gate 2 conflict cases live in matter-conflict-gate.test.ts.
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'screened_conflict_checks') {
        const chain: Record<string, unknown> = {};
        const noop = () => chain;
        chain.select = noop;
        chain.eq = noop;
        chain.order = noop;
        chain.limit = noop;
        chain.maybeSingle = () =>
          Promise.resolve({
            data: { check_status: 'cleared', waiver_consent_id: null },
            error: null,
          });
        return chain;
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    },
  },
}));

function matter(overrides: Partial<GateMatterInput> = {}): GateMatterInput {
  return {
    id: 'm-1',
    firm_id: 'firm-1',
    source_screened_lead_id: 'sl-1',
    primary_name: 'Jane Doe',
    primary_email: 'jane@example.com',
    primary_phone: null,
    ...overrides,
  };
}

describe('checkStageGate: retainer_pending contact gate', () => {
  it('full contact (name + email): allowed', async () => {
    const r = await checkStageGate(matter(), 'retainer_pending');
    expect(r.allowed).toBe(true);
  });

  it('name + phone only (no email): allowed', async () => {
    const r = await checkStageGate(matter({ primary_email: null, primary_phone: '416-555-0001' }), 'retainer_pending');
    expect(r.allowed).toBe(true);
  });

  it('name + email only (no phone): allowed', async () => {
    const r = await checkStageGate(matter({ primary_phone: null }), 'retainer_pending');
    expect(r.allowed).toBe(true);
  });

  it('missing primary_name: blocked (missing_contact_info)', async () => {
    const r = await checkStageGate(matter({ primary_name: null }), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('missing_contact_info');
  });

  it('whitespace-only primary_name: blocked', async () => {
    const r = await checkStageGate(matter({ primary_name: '   ' }), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('missing_contact_info');
  });

  it('name present but no email and no phone: blocked', async () => {
    const r = await checkStageGate(matter({ primary_email: null, primary_phone: null }), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('missing_contact_info');
  });

  it('name present, whitespace email and null phone: blocked', async () => {
    const r = await checkStageGate(matter({ primary_email: '   ', primary_phone: null }), 'retainer_pending');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.code).toBe('missing_contact_info');
  });
});

describe('checkStageGate: stages without contact gate', () => {
  it('active: no contact check, allowed when conflict is cleared', async () => {
    const r = await checkStageGate(matter({ primary_email: null, primary_phone: null }), 'active');
    expect(r.allowed).toBe(true);
  });

  it('active -> closing: allowed', async () => {
    const r = await checkStageGate(matter(), 'closing');
    expect(r.allowed).toBe(true);
  });

  it('closing -> closed: allowed', async () => {
    const r = await checkStageGate(matter(), 'closed');
    expect(r.allowed).toBe(true);
  });

  it('intake stage (should not normally be a target): allowed (no gate defined)', async () => {
    const r = await checkStageGate(matter(), 'intake');
    expect(r.allowed).toBe(true);
  });
});

describe('checkStageGate: conflict gate passes when cleared', () => {
  it('cleared conflict check on retainer_pending: allowed', async () => {
    const r = await checkStageGate(matter(), 'retainer_pending');
    expect(r.allowed).toBe(true);
  });

  it('cleared conflict check on active: allowed', async () => {
    const r = await checkStageGate(matter(), 'active');
    expect(r.allowed).toBe(true);
  });
});
