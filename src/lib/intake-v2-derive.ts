/**
 * Pure derivation functions for /api/intake-v2.
 *
 * Each constant in this file is a CRM Bible v5 decision (referenced by the
 * decision register entry). Drift here breaks the contract with the lawyer
 * portal and the GHL cadence routing.
 */

// ─── CRM Bible v5 DR-003 — urgency-tiered timer compression ─────────────────
export const TIMER_HOURS_DEFAULT = 48;
export const TIMER_HOURS_URGENCY_6 = 24;
export const TIMER_HOURS_URGENCY_8 = 12;

// ─── CRM Bible v5 DR-004 — whale nurture trigger ────────────────────────────
export const WHALE_VALUE_FLOOR = 7;
export const WHALE_READINESS_CEILING = 4;

/**
 * Compute the decision deadline given the urgency axis score and a reference
 * "now" timestamp. Urgency 8+ compresses to 12h, urgency 6+ to 24h, otherwise
 * 48h (the active conversion window from CRM Bible v5 DR-002).
 */
export function computeDecisionDeadline(urgency: number, now: Date): Date {
  let hoursAhead = TIMER_HOURS_DEFAULT;
  if (urgency >= 8) hoursAhead = TIMER_HOURS_URGENCY_8;
  else if (urgency >= 6) hoursAhead = TIMER_HOURS_URGENCY_6;
  return new Date(now.getTime() + hoursAhead * 3600 * 1000);
}

/**
 * Whale nurture flag. The lead enters the whale nurture cadence regardless
 * of band when value is high but readiness is low: high-value future matters
 * from leads not yet ready to retain.
 */
export function computeWhaleNurture(value: number, readiness: number): boolean {
  return value >= WHALE_VALUE_FLOOR && readiness <= WHALE_READINESS_CEILING;
}

/**
 * Initial lifecycle status at insert time. Out-of-scope leads auto-fire
 * decline immediately (CRM Bible v5 DR-006); everything else lands in
 * `triaging` for the lawyer to act on.
 */
export function computeInitialStatus(matterType: string): {
  status: 'triaging' | 'declined';
  changedBy: string | null;
} {
  if (matterType === 'out_of_scope') {
    return { status: 'declined', changedBy: 'system:oos' };
  }
  return { status: 'triaging', changedBy: null };
}

/**
 * Clamp + round any candidate axis number to the integer range 0-10. Returns
 * null for null/undefined/non-numeric inputs so the column accepts NULL
 * rather than silently coercing absent values to 0 (Number(null) === 0 is the
 * trap this guards against).
 */
export function clampAxis(n: unknown): number | null {
  if (n === null || n === undefined) return null;
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(10, Math.round(v)));
}
