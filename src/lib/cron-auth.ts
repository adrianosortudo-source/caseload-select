/**
 * Cron route authorization.
 *
 * Cron-protected routes (triage-backstop, webhook-retry, manual outbox retry,
 * admin webhook-outbox listing) accept a Bearer token in the Authorization
 * header. Two valid tokens to support different schedulers:
 *
 *   CRON_SECRET     — the project's existing operator/cron token. Used by
 *                     Vercel cron jobs, the operator's own curl recipes,
 *                     and the existing /api/portal/generate flow.
 *
 *   PG_CRON_TOKEN   — separate token for Supabase pg_cron + pg_net jobs.
 *                     Stored in Supabase Vault and read in the cron SQL.
 *                     Set as a Vercel env var so the route can verify.
 *
 * Either token is accepted. Operator can rotate one without affecting the
 * other.
 */

import type { NextRequest } from "next/server";

export function isCronAuthorized(req: NextRequest): boolean {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length).trim();
  if (!presented) return false;

  const acceptedTokens = [
    process.env.CRON_SECRET,
    process.env.PG_CRON_TOKEN,
  ].filter((t): t is string => typeof t === "string" && t.length > 0);

  // Constant-time comparison against each accepted token. Avoids timing-side
  // channels that could leak the secret length / prefix.
  return acceptedTokens.some((accepted) => constantTimeEquals(presented, accepted));
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still iterate to keep timing similar; result is false but the loop
    // matters for the constant-time intent.
    let mismatch = 1;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const ca = i < a.length ? a.charCodeAt(i) : 0;
      const cb = i < b.length ? b.charCodeAt(i) : 0;
      mismatch |= ca ^ cb;
    }
    return mismatch === 0;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
