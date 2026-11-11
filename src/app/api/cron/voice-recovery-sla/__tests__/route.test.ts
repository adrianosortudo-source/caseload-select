import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

let authorized = true;
vi.mock('@/lib/cron-auth', () => ({ isCronAuthorized: () => authorized }));
const from = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from } }));
vi.mock('@/lib/voice-callback-notify', () => ({ notifyOperatorOfVoiceRecoverySla: vi.fn() }));

function request() {
  return new NextRequest('https://app.example.test/api/cron/voice-recovery-sla', {
    headers: { authorization: 'Bearer test' },
  });
}

describe('GET /api/cron/voice-recovery-sla', () => {
  const originalEnabled = process.env.VOICE_RECOVERY_SLA_ESCALATION_ENABLED;
  beforeEach(() => { authorized = true; from.mockReset(); delete process.env.VOICE_RECOVERY_SLA_ESCALATION_ENABLED; });
  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.VOICE_RECOVERY_SLA_ESCALATION_ENABLED;
    else process.env.VOICE_RECOVERY_SLA_ESCALATION_ENABLED = originalEnabled;
  });

  it('rejects a request that does not satisfy cron authorization', async () => {
    authorized = false;
    const { GET } = await import('../route');
    expect((await GET(request())).status).toBe(401);
  });

  it('is a no-write no-send dry run until explicitly enabled', async () => {
    const { GET } = await import('../route');
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, enabled: false, escalated: 0 });
    expect(from).not.toHaveBeenCalled();
  });
});
