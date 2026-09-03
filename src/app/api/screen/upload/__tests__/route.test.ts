import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialSession: {
    id: 'session-1',
    firm_id: '11111111-1111-4111-8111-111111111111',
    otp_verified: true,
  } as Record<string, unknown> | null,
  currentSession: { otp_verified: true } as Record<string, unknown> | null,
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => Promise.resolve({ ok: true })),
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimitHeaders: vi.fn(() => ({})),
}));
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== 'intake_sessions') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: mocks.initialSession, error: null }),
            maybeSingle: () => Promise.resolve({ data: mocks.currentSession, error: null }),
          }),
        }),
      };
    },
    storage: {
      from: () => ({ upload: mocks.upload, remove: mocks.remove }),
    },
  },
}));

import { POST } from '../route';

const FIRM_ID = '11111111-1111-4111-8111-111111111111';
const EXPECTED_PATH = `${FIRM_ID}/session-1/1788381000000-offer.pdf`;

function request(): Request {
  const body = new FormData();
  body.set('session_id', 'session-1');
  body.set('file', new File(['offer'], 'offer.pdf', { type: 'application/pdf' }));
  return new Request('https://app.caseloadselect.ca/api/screen/upload', {
    method: 'POST',
    body,
  });
}

beforeEach(() => {
  mocks.initialSession = { id: 'session-1', firm_id: FIRM_ID, otp_verified: true };
  mocks.currentSession = { otp_verified: true };
  mocks.upload.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.remove.mockReset().mockResolvedValue({ data: [], error: null });
  vi.spyOn(Date, 'now').mockReturnValue(1788381000000);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/screen/upload privacy race', () => {
  it('returns the authorized URL when the session remains eligible', async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.upload).toHaveBeenCalledWith(
      EXPECTED_PATH,
      expect.any(ArrayBuffer),
      { contentType: 'application/pdf', upsert: false },
    );
    expect(body.path).toBe(EXPECTED_PATH);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('removes a late upload when deletion disables the session', async () => {
    mocks.currentSession = { otp_verified: false };

    const response = await POST(request());

    expect(response.status).toBe(410);
    expect(mocks.remove).toHaveBeenCalledWith([EXPECTED_PATH]);
  });

  it('reports operator attention when rollback cleanup is incomplete', async () => {
    mocks.currentSession = null;
    mocks.remove.mockResolvedValueOnce({
      data: null,
      error: { message: 'storage unavailable' },
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/operator attention/);
  });
});
