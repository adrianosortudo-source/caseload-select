/**
 * Meta webhook signature verification.
 *
 * Meta signs every webhook POST to our endpoints with an HMAC-SHA256 hash
 * of the raw request body, using the app's secret. The signature arrives
 * in the `X-Hub-Signature-256` header as `sha256=<hex digest>`.
 *
 * https://developers.facebook.com/docs/messenger-platform/webhooks#security
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#event-notifications
 *
 * Verification is non-negotiable in production. Without it, anyone could
 * post fake "incoming message" events to our endpoints and pollute the
 * triage portal. Constant-time comparison defends against timing attacks.
 *
 * The shared secret is the CaseLoad Select Meta App's "App Secret"
 * (developers.facebook.com → My Apps → CaseLoad Select → Settings → Basic
 * → App Secret). Store it as `META_APP_SECRET` in Vercel env.
 *
 * Meta uses the same signing scheme for Messenger, Instagram Graph,
 * and WhatsApp Cloud API webhooks. One verifier, three receivers.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const HEADER = 'x-hub-signature-256';
const PREFIX = 'sha256=';

interface VerifyArgs {
  /** Raw request body string, exactly as Meta sent it. JSON-parsed body will not work. */
  rawBody: string;
  /** Value of the X-Hub-Signature-256 header (e.g., "sha256=abc..."). */
  signatureHeader: string | null;
  /** App secret from the Meta developer console. */
  appSecret: string;
}

export function verifyMetaSignature({
  rawBody,
  signatureHeader,
  appSecret,
}: VerifyArgs): { valid: boolean; reason?: string } {
  if (!signatureHeader) {
    return { valid: false, reason: 'missing X-Hub-Signature-256 header' };
  }
  if (!signatureHeader.startsWith(PREFIX)) {
    return { valid: false, reason: 'malformed signature header (no sha256= prefix)' };
  }
  if (!appSecret) {
    return { valid: false, reason: 'META_APP_SECRET not configured' };
  }

  const provided = signatureHeader.slice(PREFIX.length);
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');

  if (provided.length !== expected.length) {
    return { valid: false, reason: 'signature length mismatch' };
  }

  const equal = timingSafeEqual(
    Buffer.from(provided, 'hex'),
    Buffer.from(expected, 'hex')
  );

  return equal
    ? { valid: true }
    : { valid: false, reason: 'signature mismatch' };
}

/**
 * Meta's webhook verification challenge handler. When you add a webhook URL
 * in the Meta developer console, Meta sends a GET request with three query
 * params (hub.mode, hub.verify_token, hub.challenge). If hub.verify_token
 * matches the operator-configured value, echo back hub.challenge as plain
 * text. The verify_token is a shared secret the operator picks and
 * configures on both sides (Meta console + this app via env var).
 *
 * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
 *
 * Returns:
 *   - { ok: true, challenge: string } — echo this back as text/plain
 *   - { ok: false, reason: string } — return 403 + reason
 */
export function handleVerificationChallenge({
  searchParams,
  expectedVerifyToken,
}: {
  searchParams: URLSearchParams;
  expectedVerifyToken: string;
}): { ok: true; challenge: string } | { ok: false; reason: string } {
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode !== 'subscribe') {
    return { ok: false, reason: `unexpected hub.mode: ${mode ?? '(missing)'}` };
  }
  if (!token) {
    return { ok: false, reason: 'missing hub.verify_token' };
  }
  if (!expectedVerifyToken) {
    return { ok: false, reason: 'verify token not configured on server' };
  }
  // Constant-time compare (Jim Manico audit APP-005). Plain !== leaks
  // token length and per-byte timing on the rejection path. timingSafeEqual
  // needs equal-length buffers; length-mismatch case still pays the same
  // CPU cost so a length-only probe can't shortcut the compare.
  const tokenBuf = Buffer.from(token, 'utf8');
  const expectedBuf = Buffer.from(expectedVerifyToken, 'utf8');
  if (tokenBuf.length !== expectedBuf.length) {
    // Burn equivalent time, then reject.
    const longest = Math.max(tokenBuf.length, expectedBuf.length);
    const padA = Buffer.alloc(longest);
    const padB = Buffer.alloc(longest);
    tokenBuf.copy(padA);
    expectedBuf.copy(padB);
    timingSafeEqual(padA, padB);
    return { ok: false, reason: 'hub.verify_token mismatch' };
  }
  if (!timingSafeEqual(tokenBuf, expectedBuf)) {
    return { ok: false, reason: 'hub.verify_token mismatch' };
  }
  if (!challenge) {
    return { ok: false, reason: 'missing hub.challenge' };
  }
  return { ok: true, challenge };
}
