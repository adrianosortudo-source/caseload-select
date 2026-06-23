/**
 * Auth-gate tests for POST /api/portal/leads/[leadId]/dossier.
 *
 * The route previously had no session check and relied on firmId (a public
 * value) as a shared secret. These pin the gate: unauthenticated, client, and
 * cross-firm lawyer callers are rejected before any lead read or LLM call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

type Session = { firm_id: string; role: 'lawyer' | 'operator' | 'client'; exp: number } | null;
const state: { session: Session } = { session: null };

vi.mock('@/lib/portal-auth', () => ({
  getPortalSession: () => Promise.resolve(state.session),
}));

// Mocked so a null-lead read yields 404 (proving auth passed) and the module
// imports cleanly without real clients.
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
    }),
  },
}));
vi.mock('@/lib/openrouter', () => ({ googleai: {}, MODELS: { STANDARD: 'm' } }));

import { POST } from '../route';

const FIRM = 'firm-1';
function makeReq(body: unknown) {
  return { json: async () => body } as never;
}
const params = () => ({ params: Promise.resolve({ leadId: 'lead-1' }) }) as never;

beforeEach(() => {
  state.session = null;
});

describe('POST dossier auth gate', () => {
  it('400 when firmId is missing', async () => {
    state.session = { firm_id: FIRM, role: 'lawyer', exp: Date.now() + 1000 };
    const res = await POST(makeReq({}), params());
    expect(res.status).toBe(400);
  });

  it('401 when there is no session', async () => {
    const res = await POST(makeReq({ firmId: FIRM }), params());
    expect(res.status).toBe(401);
  });

  it('401 for a client session', async () => {
    state.session = { firm_id: FIRM, role: 'client', exp: Date.now() + 1000 };
    const res = await POST(makeReq({ firmId: FIRM }), params());
    expect(res.status).toBe(401);
  });

  it('401 for a lawyer whose firm does not match', async () => {
    state.session = { firm_id: 'other-firm', role: 'lawyer', exp: Date.now() + 1000 };
    const res = await POST(makeReq({ firmId: FIRM }), params());
    expect(res.status).toBe(401);
  });

  it('passes the gate for a matching lawyer (then 404 on the missing lead)', async () => {
    state.session = { firm_id: FIRM, role: 'lawyer', exp: Date.now() + 1000 };
    const res = await POST(makeReq({ firmId: FIRM }), params());
    expect(res.status).toBe(404);
  });

  it('passes the gate for an operator (cross-firm)', async () => {
    state.session = { firm_id: 'whatever', role: 'operator', exp: Date.now() + 1000 };
    const res = await POST(makeReq({ firmId: FIRM }), params());
    expect(res.status).toBe(404);
  });
});
