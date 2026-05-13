/**
 * Tests for src/lib/voice-webhook-auth.ts — covers the pure decision
 * table (shouldRejectVoiceRequest) and the signature compute path.
 * verifyVoiceWebhookSignature is exercised against a mocked supabase
 * client so a missing column / missing row / NULL secret all behave
 * as the rollout posture intends.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'crypto';

// `server-only` is a Next.js convention that throws when imported from a
// client component; stub it for Vitest.
vi.mock('server-only', () => ({}));

// Programmable mock — each test re-installs the shape it wants.
const supabaseMockState: {
  data: { voice_webhook_secret: string | null } | null;
  error: { code?: string; message: string } | null;
} = { data: null, error: null };

vi.mock('../supabase-admin', () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_field: string, _v: unknown) => ({
          maybeSingle: () =>
            Promise.resolve({
              data: supabaseMockState.data,
              error: supabaseMockState.error,
            }),
        }),
      }),
    }),
  },
}));

import {
  verifyVoiceWebhookSignature,
  shouldRejectVoiceRequest,
  isHmacRequired,
  type VerifyResult,
} from '../voice-webhook-auth';

const FIRM_ID = '00000000-0000-0000-0000-000000000001';

function setMockSecret(secret: string | null): void {
  supabaseMockState.data = { voice_webhook_secret: secret };
  supabaseMockState.error = null;
}

function setMockError(code: string, message: string): void {
  supabaseMockState.data = null;
  supabaseMockState.error = { code, message };
}

function makeSignature(secret: string, rawBody: string, prefix = 'sha256='): string {
  const hex = createHmac('sha256', secret).update(rawBody).digest('hex');
  return prefix + hex;
}

describe('verifyVoiceWebhookSignature — rollout posture', () => {
  it("returns 'no_column' when the column does not exist (pre-migration)", async () => {
    setMockError('42703', 'column intake_firms.voice_webhook_secret does not exist');
    const r = await verifyVoiceWebhookSignature({
      firmId: FIRM_ID,
      rawBody: '{}',
      signatureHeader: 'sha256=abc',
    });
    expect(r.mode).toBe('no_column');
  });

  it("returns 'no_column' for a column-not-found message even without code 42703", async () => {
    setMockError('42P01', 'column does not exist');
    const r = await verifyVoiceWebhookSignature({
      firmId: FIRM_ID,
      rawBody: '{}',
      signatureHeader: 'sha256=abc',
    });
    expect(r.mode).toBe('no_column');
  });

  it("returns 'no_secret_configured' when the column exists but the value is NULL", async () => {
    setMockSecret(null);
    const r = await verifyVoiceWebhookSignature({
      firmId: FIRM_ID,
      rawBody: '{}',
      signatureHeader: 'sha256=abc',
    });
    expect(r.mode).toBe('no_secret_configured');
  });

  it("returns 'no_signature_header' when the secret is configured but no header was sent", async () => {
    setMockSecret('super-secret-value');
    const r = await verifyVoiceWebhookSignature({
      firmId: FIRM_ID,
      rawBody: '{}',
      signatureHeader: null,
    });
    expect(r.mode).toBe('no_signature_header');
  });

  it("returns 'malformed_signature' when the header is not hex", async () => {
    setMockSecret('super-secret-value');
    const r = await verifyVoiceWebhookSignature({
      firmId: FIRM_ID,
      rawBody: '{}',
      signatureHeader: 'sha256=not-hex!',
    });
    expect(r.mode).toBe('malformed_signature');
  });

  it("returns 'mismatch' when the HMAC does not match", async () => {
    setMockSecret('super-secret-value');
    // Compute HMAC with a DIFFERENT secret to simulate forgery
    const wrongSig = makeSignature('different-secret', '{}');
    const r = await verifyVoiceWebhookSignature({
      firmId: FIRM_ID,
      rawBody: '{}',
      signatureHeader: wrongSig,
    });
    expect(r.mode).toBe('mismatch');
  });

  it("returns 'verified' when HMAC matches", async () => {
    const secret = 'super-secret-value';
    setMockSecret(secret);
    const body = '{"transcript":"hello"}';
    const sig = makeSignature(secret, body);
    const r = await verifyVoiceWebhookSignature({
      firmId: FIRM_ID,
      rawBody: body,
      signatureHeader: sig,
    });
    expect(r.mode).toBe('verified');
  });

  it('accepts a bare hex digest without the sha256= prefix', async () => {
    const secret = 'super-secret-value';
    setMockSecret(secret);
    const body = '{}';
    const sig = makeSignature(secret, body, '');
    const r = await verifyVoiceWebhookSignature({
      firmId: FIRM_ID,
      rawBody: body,
      signatureHeader: sig,
    });
    expect(r.mode).toBe('verified');
  });
});

describe('shouldRejectVoiceRequest — decision matrix', () => {
  const vr = (mode: VerifyResult['mode']): VerifyResult => {
    switch (mode) {
      case 'verified':
        return { mode, firmId: FIRM_ID };
      case 'no_secret_configured':
        return { mode, firmId: FIRM_ID };
      case 'no_column':
        return { mode, firmId: FIRM_ID };
      case 'no_signature_header':
        return { mode, firmId: FIRM_ID };
      case 'mismatch':
        return { mode, firmId: FIRM_ID, reason: 'digest mismatch' };
      case 'malformed_signature':
        return { mode, firmId: FIRM_ID, reason: 'not hex' };
    }
  };

  it('verified → never reject', () => {
    expect(shouldRejectVoiceRequest(vr('verified'), true).reject).toBe(false);
    expect(shouldRejectVoiceRequest(vr('verified'), false).reject).toBe(false);
  });

  it('no_column → never reject (pre-migration safety)', () => {
    expect(shouldRejectVoiceRequest(vr('no_column'), true).reject).toBe(false);
    expect(shouldRejectVoiceRequest(vr('no_column'), false).reject).toBe(false);
  });

  it('no_secret_configured → reject only when required=true', () => {
    expect(shouldRejectVoiceRequest(vr('no_secret_configured'), false).reject).toBe(false);
    expect(shouldRejectVoiceRequest(vr('no_secret_configured'), true).reject).toBe(true);
  });

  it('no_signature_header → reject only when required=true', () => {
    expect(shouldRejectVoiceRequest(vr('no_signature_header'), false).reject).toBe(false);
    expect(shouldRejectVoiceRequest(vr('no_signature_header'), true).reject).toBe(true);
  });

  it('mismatch → always reject', () => {
    expect(shouldRejectVoiceRequest(vr('mismatch'), true).reject).toBe(true);
    expect(shouldRejectVoiceRequest(vr('mismatch'), false).reject).toBe(true);
  });

  it('malformed_signature → always reject', () => {
    expect(shouldRejectVoiceRequest(vr('malformed_signature'), true).reject).toBe(true);
    expect(shouldRejectVoiceRequest(vr('malformed_signature'), false).reject).toBe(true);
  });
});

describe('isHmacRequired — env toggle parsing', () => {
  const origEnv = process.env.VOICE_HMAC_REQUIRED;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.VOICE_HMAC_REQUIRED;
    else process.env.VOICE_HMAC_REQUIRED = origEnv;
  });

  it('defaults to false when env var is unset', () => {
    delete process.env.VOICE_HMAC_REQUIRED;
    expect(isHmacRequired()).toBe(false);
  });

  it('parses common truthy values', () => {
    process.env.VOICE_HMAC_REQUIRED = 'true';
    expect(isHmacRequired()).toBe(true);
    process.env.VOICE_HMAC_REQUIRED = 'TRUE';
    expect(isHmacRequired()).toBe(true);
    process.env.VOICE_HMAC_REQUIRED = '1';
    expect(isHmacRequired()).toBe(true);
    process.env.VOICE_HMAC_REQUIRED = 'yes';
    expect(isHmacRequired()).toBe(true);
  });

  it('treats other strings as false (conservative)', () => {
    process.env.VOICE_HMAC_REQUIRED = 'false';
    expect(isHmacRequired()).toBe(false);
    process.env.VOICE_HMAC_REQUIRED = 'maybe';
    expect(isHmacRequired()).toBe(false);
    process.env.VOICE_HMAC_REQUIRED = '0';
    expect(isHmacRequired()).toBe(false);
  });
});

