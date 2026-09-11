import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const state = { session: { role: 'operator', lawyer_id: 'op-1' } as { role: string; lawyer_id: string } | null, promoted: 'screened-1' as string | null };
vi.mock('@/lib/portal-auth', () => ({ getOperatorSession: vi.fn(() => Promise.resolve(state.session)) }));
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: {
      id: 'recovery-1', firm_id: '11111111-1111-1111-1111-111111111111', promoted_screened_lead_id: state.promoted,
    }, error: null }) }) }),
  }) },
}));

import { POST } from '../route';

describe('POST /api/admin/voice-recovery/[id]/promote', () => {
  beforeEach(() => { state.session = { role: 'operator', lawyer_id: 'op-1' }; state.promoted = 'screened-1'; });

  it('requires an operator session', async () => {
    state.session = null;
    const response = await POST(new Request('https://example.test') as never, { params: Promise.resolve({ id: 'recovery-1' }) });
    expect(response.status).toBe(401);
  });

  it('is idempotent when the recovery case already points to a screened lead', async () => {
    const response = await POST(new Request('https://example.test') as never, { params: Promise.resolve({ id: 'recovery-1' }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ screened_lead_id: 'screened-1' });
  });
});
