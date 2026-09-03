import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), setCircuit: vi.fn() }));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock('@/lib/privacy-recovery-gate', () => ({ setPrivacyRecoveryCircuit: mocks.setCircuit }));

import { POST } from './route';

describe('privacy recovery control route', () => {
  it('rejects extra JSON payload fields before a circuit or database mutation', async () => {
    process.env.PRIVACY_RECOVERY_CONTROL_TOKEN = 'test-token';
    const request = new NextRequest('https://example.test/api/internal/privacy-recovery', {
      method: 'POST', headers: { 'x-privacy-recovery-token': 'test-token' }, body: JSON.stringify({ state: 'locked', extra: true }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(mocks.setCircuit).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
