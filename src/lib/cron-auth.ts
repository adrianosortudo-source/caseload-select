/**
 * Cron route authorization.
 *
 * Cron-protected routes (triage-backstop, webhook-retry, manual outbox retry,
 * admin webhook-outbox listing, all /api/cron/* sweeps) accept a Bearer
 * token in the Authorization header. Two valid tokens to support different
 * schedulers:
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
 *
 * Constant-time compare via Node crypto.timingSafeEqual (Jim Manico audit
 * APP-005). Prior implementation had a length-mismatch early branch that
 * leaked token length on the side channel; current implementation burns
 * equivalent CPU time regardless of length to keep the timing flat.
 */

import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * High-level check for NextRequest. Pulls the Authorization header,
 * extracts the Bearer token, compares against accepted secrets in
 * constant time. Returns true when a valid token is presented.
 */
export function isCronAuthorized(req: NextRequest): boolean {
  return isAuthorizationHeaderValid(req.headers.get("authorization"));
}

/**
 * Lower-level variant for code paths that already have the raw header
 * value (or no NextRequest in scope — e.g. server actions). Same compare
 * semantics as isCronAuthorized.
 */
export function isAuthorizationHeaderValid(headerValue: string | null | undefined): boolean {
  if (!headerValue || !headerValue.startsWith("Bearer ")) return false;
  const presented = headerValue.slice("Bearer ".length).trim();
  if (!presented) return false;

  const acceptedTokens = [
    process.env.CRON_SECRET,
    process.env.PG_CRON_TOKEN,
  ].filter((t): t is string => typeof t === "string" && t.length > 0);

  // No accepted tokens configured at all → reject (refuse to accept any
  // bearer when the operator hasn't set a secret). Fail closed.
  if (acceptedTokens.length === 0) return false;

  return acceptedTokens.some((accepted) => constantTimeEquals(presented, accepted));
}

/**
 * Constant-time string equality via Node crypto.timingSafeEqual. The
 * comparison runs in time proportional to the LONGER of the two
 * buffers, with no early-exit on length mismatch. timingSafeEqual
 * itself requires equal-length buffers, so we pad the shorter side
 * with zero bytes and force a full compare even when the lengths
 * differ — the function still returns false, but the timing carries
 * no information about how close the attacker's guess was.
 *
 * Exported for unit-test coverage. Real consumers should use
 * isCronAuthorized / isAuthorizationHeaderValid.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length === bufB.length) {
    return timingSafeEqual(bufA, bufB);
  }

  // Lengths differ. We still execute a timingSafeEqual call against
  // a zero-padded buffer of the same size so the rejection path costs
  // ~the same CPU time as the success path. The result is forced to
  // false because the length-mismatch IS a real mismatch — we just
  // don't want the rejection to be fast.
  const longest = Math.max(bufA.length, bufB.length);
  const padA = Buffer.alloc(longest);
  const padB = Buffer.alloc(longest);
  bufA.copy(padA);
  bufB.copy(padB);
  // Equivalent-cost compare; we discard the boolean since we know
  // the original lengths differ and the answer must be false.
  timingSafeEqual(padA, padB);
  return false;
}
