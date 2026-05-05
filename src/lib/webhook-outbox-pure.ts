/**
 * Webhook outbox — pure helpers (no I/O).
 *
 * Backoff math and retry-decision logic split from the I/O wrapper so they
 * can be tested without mocking Supabase.
 */

const MIN_BACKOFF_SECONDS = 30;          // first retry after 30s
const MAX_BACKOFF_SECONDS = 6 * 3600;    // cap at 6h
const BACKOFF_MULTIPLIER = 4;             // 30s, 2m, 8m, 32m, 2h08m, 6h(cap)
export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Compute the next retry time given the current attempt count.
 *
 *   attempt 0 (just inserted, never tried) → wait MIN_BACKOFF
 *   attempt 1 (one failure)                → wait MIN_BACKOFF * 4 = 2 min
 *   attempt 2                              → wait * 16 = 8 min
 *   attempt 3                              → wait * 64 = 32 min
 *   attempt 4                              → wait * 256 = ~2h, capped
 *   attempt 5                              → max attempts; mark failed instead
 *
 * Capped at MAX_BACKOFF_SECONDS so a long-stuck row eventually gets retried
 * within a reasonable window rather than drifting into next-day territory.
 */
export function nextAttemptDelaySeconds(attempts: number): number {
  const exp = Math.max(0, attempts);
  const raw = MIN_BACKOFF_SECONDS * Math.pow(BACKOFF_MULTIPLIER, exp);
  return Math.min(MAX_BACKOFF_SECONDS, Math.round(raw));
}

export function nextAttemptAt(attempts: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + nextAttemptDelaySeconds(attempts) * 1000);
}

/**
 * Decide what to do after an attempt completes.
 *
 *   attempt succeeded             → mark sent
 *   attempt failed, retries left  → mark pending with new next_attempt_at
 *   attempt failed, no retries    → mark failed (operator can manual-retry)
 */
export type AttemptOutcome =
  | { next: "sent" }
  | { next: "pending"; nextAttemptAt: Date }
  | { next: "failed" };

export function decideAttemptOutcome(args: {
  fired: boolean;
  attempts: number;          // count BEFORE this attempt
  maxAttempts: number;
  now?: Date;
}): AttemptOutcome {
  if (args.fired) return { next: "sent" };
  const newAttempts = args.attempts + 1;
  if (newAttempts >= args.maxAttempts) return { next: "failed" };
  return { next: "pending", nextAttemptAt: nextAttemptAt(newAttempts, args.now) };
}
