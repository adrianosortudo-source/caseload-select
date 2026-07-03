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
 *      voice webhook header (X-CLS-Voice-Signature). TWO accepted forms:
 *
 *      a. STATIC SHARED TOKEN: the header value IS the secret, verbatim.
 *         This is the form GHL can actually send: its webhook action
 *         supports static custom headers only and cannot compute a
 *         digest over the request body. Compared constant-time.
 *         Authenticates the sender; does not provide body integrity.
 *
 *      b. HMAC-SHA256: sha256=<hex> (or bare hex) of HMAC(secret, rawBody).
 *         For senders that can sign (the Vapi realtime loop, tests,
 *         future integrations). Provides sender auth + body integrity.
 *
 *      Field history (2026-07-03): the original contract was HMAC-only.
 *      The Codex F-01 hardening (2026-06-23, correct in intent) made a
 *      missing header an unconditional 401 for any firm with a secret
 *      configured, and since GHL cannot sign, every DRG voice call from
 *      2026-06-23 to 2026-07-03 was silently rejected and lost. The
 *      static-token form exists so the transport that carries real
 *      calls can satisfy the gate.
 *
 *   4. Operator sets VOICE_HMAC_REQUIRED=true in Vercel Production env
 *      vars. From that point, voice POSTs for firms WITHOUT a configured
 *      secret are also rejected 401 platform-wide. (Firms WITH a secret
 *      are enforced regardless of the env toggle, per F-01 below.)
 *
 * The graceful-degradation behaviour lets this file ship before the
 * migration without putting voice intake at risk.
 */

import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin as supabase } from './supabase-admin';

export type VerifyResult =
  | { mode: 'verified'; firmId: string }
  | { mode: 'verified_static_token'; firmId: string }
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
 * Constant-time string equality. Runs a timingSafeEqual over
 * zero-padded buffers of equal length so a length mismatch costs the
 * same as a content mismatch (mirrors lib/cron-auth.ts).
 */
function constantTimeStringEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length === bufB.length) {
    return timingSafeEqual(bufA, bufB);
  }
  const longest = Math.max(bufA.length, bufB.length);
  const padA = Buffer.alloc(longest);
  const padB = Buffer.alloc(longest);
  bufA.copy(padA);
  bufB.copy(padB);
  timingSafeEqual(padA, padB);
  return false;
}

/**
 * Constant-time verification against the configured per-firm secret.
 * Accepts the static-token form (header === secret) or the HMAC form
 * (sha256=<hex> over the raw body). Does not throw; returns a typed
 * result so the caller can decide whether to reject 401 or pass
 * through based on the platform-wide VOICE_HMAC_REQUIRED toggle.
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

  // 2a. Static-token form: the header value IS the secret, verbatim.
  //     Checked BEFORE the hex parse because the secret is typically
  //     base64 (openssl rand -base64 32) and would fail the hex gate.
  //     This is the only form GHL's static-header webhook action can
  //     send. Constant-time compare; a wrong value falls through to the
  //     HMAC path and rejects there.
  if (constantTimeStringEquals(signatureHeader, secret)) {
    return { mode: 'verified_static_token', firmId };
  }

  // Accept "sha256=<hex>" (Meta convention) or bare hex.
  const cleaned = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader;
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    return {
      mode: 'malformed_signature',
      firmId,
      reason: 'signature is not a hex digest and does not match the static token',
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
 *   verified_static_token    | any       | YES (GHL static-header form)
 *   no_column                | any       | YES (pre-migration; the
 *                                                column literally doesn't
 *                                                exist yet, treat as not
 *                                                rolled out)
 *   no_secret_configured     | false     | YES (this firm not rolled out)
 *   no_secret_configured     | true      | NO  (enforcement is on; missing
 *                                                secret IS a misconfig)
 *   no_signature_header      | any       | NO  (F-01: a populated secret
 *                                                opts the firm into
 *                                                enforcement; the env
 *                                                toggle does not soften
 *                                                a missing header)
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
    case 'verified_static_token':
      return { reject: false };
    case 'no_column':
      return { reject: false };
    case 'no_secret_configured':
      return required
        ? { reject: true, reason: 'firm has no voice_webhook_secret configured' }
        : { reject: false };
    case 'no_signature_header':
      // Codex re-audit F-01: when the firm HAS a secret configured, a missing
      // signature is ALWAYS a rejection regardless of VOICE_HMAC_REQUIRED. The
      // operator opted that firm into HMAC by populating the column; accepting
      // unsigned posts on it would be the worst kind of footgun (looks
      // enforced from the column, isn't enforced in the route).
      return { reject: true, reason: 'missing X-CLS-Voice-Signature header (firm has a secret configured)' };
    case 'mismatch':
    case 'malformed_signature':
      return { reject: true, reason: `signature ${verify.mode}: ${verify.reason}` };
  }
}
