/**
 * HMAC verification for GHL Voice AI webhooks.
 *
 * Closes Codex audit HIGH #7. Previously /api/voice-intake accepted any
 * POST that included a valid firm UUID (a non-secret value visible in
 * widget embeds), so anyone could forge a voice lead. This helper
 * verifies an HMAC-SHA256 signature on the raw request body against a
 * per-firm shared secret stored in intake_firms.voice_webhook_secret.
 *
 * Rollout posture (deliberate gradualism):
 *
 *   1. Migration adds the voice_webhook_secret column (NULL by default).
 *      Migration file: supabase/migrations/20260513_voice_webhook_secret.sql.
 *      Apply via Supabase SQL editor or `npx supabase db push` when ready.
 *      Until applied, this helper degrades to "no verification possible"
 *      and the route returns its current behavior (open).
 *
 *   2. Operator generates a secret per firm and stores it in the column.
 *      Recommended: openssl rand -base64 32. Store using
 *      `UPDATE intake_firms SET voice_webhook_secret = ... WHERE id = ...`.
 *      Until this is done per-firm, that firm's voice webhook continues
 *      to accept unauthenticated POSTs.
 *
 *   3. Operator configures the same secret in the firm's GHL sub-account
 *      voice webhook header (X-CLS-Voice-Signature, sha256=<hex>).
 *
 *   4. Operator sets VOICE_HMAC_REQUIRED=true in Vercel Production env
 *      vars. From that point, unauthenticated voice POSTs are rejected
 *      401 platform-wide. Until then, the helper verifies signatures
 *      when present but never rejects on missing/invalid — a "soft
 *      enforce" mode so ops can dry-run the wiring per firm without
 *      breaking the existing voice path.
 *
 * The graceful-degradation behaviour lets this file ship before the
 * migration without putting voice intake at risk.
 */

import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin as supabase } from './supabase-admin';

export type VerifyResult =
  | { mode: 'verified'; firmId: string }
  | { mode: 'no_secret_configured'; firmId: string }
  | { mode: 'no_column'; firmId: string }
  | { mode: 'no_signature_header'; firmId: string }
  | { mode: 'mismatch'; firmId: string; reason: string }
  | { mode: 'malformed_signature'; firmId: string; reason: string };

/**
 * The signature header GHL is configured to send. SHA256 hex digest of
 * HMAC(secret, rawBody). Format mirrors the X-Hub-Signature-256 pattern
 * Meta uses, so the GHL workflow setup mirrors what the operator already
 * understands.
 */
export const VOICE_SIGNATURE_HEADER = 'x-cls-voice-signature';

/**
 * Returns true when HMAC enforcement is on globally. Off by default so
 * the rollout can proceed firm-by-firm before the platform-wide cutover.
 */
export function isHmacRequired(): boolean {
  const v = (process.env.VOICE_HMAC_REQUIRED ?? '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Constant-time HMAC compare against the configured per-firm secret.
 * Does not throw; returns a typed result so the caller can decide
 * whether to reject 401 or pass through based on the platform-wide
 * VOICE_HMAC_REQUIRED toggle.
 *
 * `rawBody` MUST be the byte-exact request body. Parsing the JSON first
 * and re-serializing would change whitespace and break the HMAC.
 */
export async function verifyVoiceWebhookSignature(args: {
  firmId: string;
  rawBody: string;
  signatureHeader: string | null;
}): Promise<VerifyResult> {
  const { firmId, rawBody, signatureHeader } = args;

  // 1. Load the firm's secret. The column may not yet exist (pre-migration)
  //    or may be NULL (rollout-in-progress firm). Both are non-fatal —
  //    let the caller decide based on isHmacRequired().
  let secret: string | null = null;
  try {
    const { data, error } = await supabase
      .from('intake_firms')
      .select('voice_webhook_secret')
      .eq('id', firmId)
      .maybeSingle();
    if (error) {
      // Postgres reports undefined column as code 42703. Other errors
      // (network, RLS, missing row) are also non-fatal here; we fall
      // through to "no_secret_configured" so the route returns soft-pass
      // when HMAC isn't required platform-wide.
      const code = (error as { code?: string }).code;
      if (code === '42703' || /column.*does not exist/i.test(error.message ?? '')) {
        return { mode: 'no_column', firmId };
      }
      return { mode: 'no_secret_configured', firmId };
    }
    secret = (data as { voice_webhook_secret?: string | null } | null)?.voice_webhook_secret ?? null;
  } catch {
    return { mode: 'no_column', firmId };
  }

  if (!secret) {
    return { mode: 'no_secret_configured', firmId };
  }

  // 2. Caller has a secret. From here, the signature header is required.
  if (!signatureHeader) {
    return { mode: 'no_signature_header', firmId };
  }

  // Accept "sha256=<hex>" (Meta convention) or bare hex.
  const cleaned = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader;
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    return {
      mode: 'malformed_signature',
      firmId,
      reason: 'signature is not a hex digest',
    };
  }

  // 3. Compute expected HMAC and constant-time compare.
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expected.length !== cleaned.length) {
    return { mode: 'mismatch', firmId, reason: 'length differs' };
  }

  let match = false;
  try {
    match = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(cleaned, 'hex'));
  } catch {
    return { mode: 'malformed_signature', firmId, reason: 'buffer construction failed' };
  }
  if (!match) {
    return { mode: 'mismatch', firmId, reason: 'digest does not match' };
  }

  return { mode: 'verified', firmId };
}

/**
 * Decide whether to reject the request based on the verify result and
 * the platform-wide VOICE_HMAC_REQUIRED toggle.
 *
 * Returns { reject: true, reason } when the route should respond 401;
 * { reject: false } when the route should proceed.
 *
 * Decision matrix:
 *
 *   verify result            | required? | proceed?
 *   -------------------------+-----------+----------
 *   verified                 | any       | YES
 *   no_column                | any       | YES (pre-migration; the
 *                                                column literally doesn't
 *                                                exist yet, treat as not
 *                                                rolled out)
 *   no_secret_configured     | false     | YES (this firm not rolled out)
 *   no_secret_configured     | true      | NO  (enforcement is on; missing
 *                                                secret IS a misconfig)
 *   no_signature_header      | false     | YES (caller didn't send; this
 *                                                firm has a secret but
 *                                                hasn't enforced yet)
 *   no_signature_header      | true      | NO
 *   mismatch / malformed     | any       | NO  (signature was sent and
 *                                                doesn't match; that's
 *                                                always a real failure)
 */
export function shouldRejectVoiceRequest(
  verify: VerifyResult,
  required: boolean,
): { reject: true; reason: string } | { reject: false } {
  switch (verify.mode) {
    case 'verified':
      return { reject: false };
    case 'no_column':
      return { reject: false };
    case 'no_secret_configured':
      return required
        ? { reject: true, reason: 'firm has no voice_webhook_secret configured' }
        : { reject: false };
    case 'no_signature_header':
      return required
        ? { reject: true, reason: 'missing X-CLS-Voice-Signature header' }
        : { reject: false };
    case 'mismatch':
    case 'malformed_signature':
      return { reject: true, reason: `signature ${verify.mode}: ${verify.reason}` };
  }
}
