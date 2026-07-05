import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isSmsSendEnabled, sendSms } from '@/lib/sms-dispatch';

const ENV_KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'] as const;
const ORIGINAL: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIGINAL[k] = process.env[k];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (ORIGINAL[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL[k];
  }
}
function setAllEnv() {
  process.env.TWILIO_ACCOUNT_SID = 'AC_test';
  process.env.TWILIO_AUTH_TOKEN = 'token_test';
  process.env.TWILIO_FROM_NUMBER = '+15550000000';
}

describe('isSmsSendEnabled', () => {
  beforeEach(clearEnv);
  afterEach(restoreEnv);

  it('is false when no TWILIO_* env vars are set (the shipped state)', () => {
    expect(isSmsSendEnabled()).toBe(false);
  });

  it('is false when only some env vars are set', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'token_test';
    expect(isSmsSendEnabled()).toBe(false);
  });

  it('is true only when all three are set', () => {
    setAllEnv();
    expect(isSmsSendEnabled()).toBe(true);
  });
});

describe('sendSms', () => {
  beforeEach(clearEnv);
  afterEach(() => { restoreEnv(); vi.unstubAllGlobals(); });

  it('skips without calling fetch when the env gate is closed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendSms('+14165551234', 'hi');
    expect(result).toEqual({ skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the Twilio Messages API when the gate is open', async () => {
    setAllEnv();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SM123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendSms('+14165551234', 'hi there');
    expect(result).toEqual({ skipped: false, sid: 'SM123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/Accounts/AC_test/Messages.json');
    expect(options.method).toBe('POST');
    expect(options.body).toContain('To=%2B14165551234');
    expect(options.headers.Authorization).toMatch(/^Basic /);
  });

  it('throws on a non-ok Twilio response', async () => {
    setAllEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' }));
    await expect(sendSms('+1', 'x')).rejects.toThrow(/Twilio send failed/);
  });
});
