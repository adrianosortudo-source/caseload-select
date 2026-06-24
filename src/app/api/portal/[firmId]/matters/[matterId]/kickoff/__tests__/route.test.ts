/**
 * F7 kickoff race fix pin.
 *
 * The kickoff route used to read welcome_draft_sent_at, then insert the client
 * welcome message, then stamp. Two concurrent kickoffs both observed unsent
 * and both sent the welcome. The fix uses a conditional UPDATE
 * (welcome_draft_sent_at IS NULL) to claim the send atomically BEFORE
 * inserting; if the claim returns zero rows, kickoff treats it as already-sent
 * and skips the message insert.
 *
 * These tests pin the claim-before-insert ordering and the no-double-send
 * guarantee on a concurrent loser.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const FIRM = '11111111-1111-1111-1111-111111111111';
const MATTER = '22222222-2222-2222-2222-222222222222';

interface MockMatter {
  id: string;
  firm_id: string;
  matter_stage: string;
  primary_email: string | null;
  practice_area: string;
  welcome_draft_html: string | null;
  welcome_draft_edited_html: string | null;
  welcome_draft_sent_at: string | null;
}

interface State {
  session: { firm_id: string; role: 'lawyer' | 'operator'; lawyer_id?: string } | null;
  matter: MockMatter | null;
  claimRows: Array<{ id: string }> | null;
  insertMessageOk: boolean;
  messageInserts: number;
  insertCalls: Array<unknown>;
  updateCalls: Array<unknown>;
}

const state: State = {
  session: null,
  matter: null,
  claimRows: null,
  insertMessageOk: true,
  messageInserts: 0,
  insertCalls: [],
  updateCalls: [],
};

vi.mock('@/lib/portal-auth', () => ({
  getFirmSession: () => Promise.resolve(state.session),
  generatePortalToken: () => 'tok.sig',
}));

vi.mock('@/lib/matter-stage', () => ({
  getMatterById: () => Promise.resolve(state.matter),
  transitionMatterStage: () =>
    Promise.resolve({ ok: true, from: 'intake', to: 'retainer_pending', event: {}, webhook: null }),
}));

vi.mock('@/lib/matter-messages', () => ({
  insertMessage: () => {
    state.messageInserts++;
    return Promise.resolve(
      state.insertMessageOk
        ? { ok: true, message: { id: `msg-${state.messageInserts}` } }
        : { ok: false, error: 'sanitiser refused' },
    );
  },
}));

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      select: () => {
        // Chainable thenable so .eq().eq().or().order() all resolve to data
        // appropriate to whatever the kickoff route reads (existing
        // assignments, candidate explainer articles, etc.).
        const chain: {
          eq: () => typeof chain;
          or: () => typeof chain;
          order: () => Promise<{ data: unknown[] }>;
          then: (
            onF: (v: { data: unknown[] }) => unknown,
            onR?: (e: unknown) => unknown,
          ) => Promise<unknown>;
        } = {
          eq: () => chain,
          or: () => chain,
          order: () => Promise.resolve({ data: [] }),
          then: (onF, onR) => Promise.resolve({ data: [] }).then(onF, onR),
        };
        return chain;
      },
      update: (patch: unknown) => {
        state.updateCalls.push(patch);
        const chain: {
          eq: () => typeof chain;
          is: () => typeof chain;
          select: () => Promise<{ data: Array<{ id: string }> | null; error: null }>;
          then: (
            onF: (v: { error: null }) => unknown,
            onR?: (e: unknown) => unknown,
          ) => Promise<unknown>;
        } = {
          eq: () => chain,
          is: () => chain,
          select: () =>
            Promise.resolve({ data: state.claimRows, error: null }),
          then: (onF, onR) =>
            Promise.resolve({ error: null }).then(onF, onR),
        };
        return chain;
      },
      insert: (rows: unknown) => {
        state.insertCalls.push(rows);
        return {
          select: () => Promise.resolve({ data: [{ id: 'x' }], error: null }),
        };
      },
    }),
  },
}));

import { POST } from '../route';

function makeReq() {
  return {
    headers: { get: () => 'https://app.caseloadselect.ca' },
    url: 'https://app.caseloadselect.ca/api/portal/x/matters/y/kickoff',
  } as never;
}
const params = () => ({ params: Promise.resolve({ firmId: FIRM, matterId: MATTER }) }) as never;

beforeEach(() => {
  state.session = { firm_id: FIRM, role: 'lawyer', lawyer_id: 'law-1' };
  state.matter = {
    id: MATTER,
    firm_id: FIRM,
    matter_stage: 'intake',
    primary_email: 'client@example.com',
    practice_area: 'corporate',
    welcome_draft_html: '<p>Welcome</p>',
    welcome_draft_edited_html: null,
    welcome_draft_sent_at: null,
  };
  state.claimRows = [{ id: MATTER }]; // default: this caller wins the claim
  state.insertMessageOk = true;
  state.messageInserts = 0;
  state.insertCalls = [];
  state.updateCalls = [];
});

describe('POST kickoff: welcome-send claim-before-insert (F7)', () => {
  it('attempts a conditional claim BEFORE inserting the client message', async () => {
    const res = await POST(makeReq(), params());
    expect(res.status).toBe(200);
    // First mutation is the claim UPDATE on client_matters, not insertMessage.
    expect(state.updateCalls.length).toBeGreaterThanOrEqual(1);
    expect(state.messageInserts).toBe(1);
  });

  it('does NOT insert a welcome message when the claim returns zero rows (race loser)', async () => {
    state.claimRows = []; // someone else already claimed
    const res = await POST(makeReq(), params());
    const body = await res.json();
    expect(res.status).toBe(200);
    const welcomeStep = body.steps.find((s: { step: string }) => s.step === 'welcome_send');
    expect(welcomeStep.ok).toBe(true);
    expect(welcomeStep.detail).toMatch(/already sent/);
    expect(state.messageInserts).toBe(0); // no double-send
  });

  it('releases the claim (welcome_draft_sent_at -> null) when the message insert fails', async () => {
    state.insertMessageOk = false;
    const res = await POST(makeReq(), params());
    const body = await res.json();
    const welcomeStep = body.steps.find((s: { step: string }) => s.step === 'welcome_send');
    expect(welcomeStep.ok).toBe(false);
    // Look for a release UPDATE that sets welcome_draft_sent_at back to null.
    const released = state.updateCalls.find(
      (u) =>
        typeof u === 'object' &&
        u !== null &&
        (u as Record<string, unknown>).welcome_draft_sent_at === null,
    );
    expect(released).toBeTruthy();
  });

  it('skips the send (claim or insert) when welcome_draft_sent_at is already set', async () => {
    state.matter = { ...state.matter!, welcome_draft_sent_at: '2026-06-23T00:00:00Z' };
    const res = await POST(makeReq(), params());
    const body = await res.json();
    const welcomeStep = body.steps.find((s: { step: string }) => s.step === 'welcome_send');
    expect(welcomeStep.ok).toBe(true);
    expect(welcomeStep.detail).toBe('already sent');
    expect(state.messageInserts).toBe(0);
  });
});
