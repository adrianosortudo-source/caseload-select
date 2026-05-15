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
// ─── Band D doctrine (2026-05-15) — refer-eligible matters get a longer window ─
// Referral conversations take longer than triage; the lawyer is reaching out
// to a colleague, not signing the case themselves. Urgency overrides still
// apply: a Band D matter with urgency >= 8 stays at 12h (a serious matter
// outside the firm's practice can still be time-critical for the lead).
export const TIMER_HOURS_OUT_OF_SCOPE = 96;

// ─── CRM Bible v5 DR-004 — whale nurture trigger ────────────────────────────
export const WHALE_VALUE_FLOOR = 7;
export const WHALE_READINESS_CEILING = 4;

/**
 * Compute the decision deadline given the urgency axis score, an optional
 * matter type, and a reference "now" timestamp.
 *
 * Tier order (first match wins):
 *   urgency >= 8                       → 12h  (crisis; overrides everything)
 *   urgency >= 6                       → 24h  (high urgency)
 *   matterType === 'out_of_scope'      → 96h  (Band D refer-eligible)
 *   default                            → 48h
 *
 * matterType is optional for back-compat with callers that compute the
 * deadline before they know the matter type; in that case the urgency
 * tiers alone apply.
 */
export function computeDecisionDeadline(urgency: number, now: Date, matterType?: string): Date {
  let hoursAhead = TIMER_HOURS_DEFAULT;
  if (urgency >= 8) hoursAhead = TIMER_HOURS_URGENCY_8;
  else if (urgency >= 6) hoursAhead = TIMER_HOURS_URGENCY_6;
  else if (matterType === 'out_of_scope') hoursAhead = TIMER_HOURS_OUT_OF_SCOPE;
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
 * Initial lifecycle status at insert time.
 *
 * Doctrine (2026-05-15): The engine sorts attention, the lawyer decides
 * outcome. Every lead — in-scope or out-of-scope — lands in `triaging`
 * with a band assigned by `computeBand`. OOS matters carry `band='D'`
 * (refer-eligible). `'declined'` is reserved for future engine-spam /
 * abuse handling; routine OOS is never auto-declined at intake.
 *
 * The `matterType` parameter is retained for back-compat with callers
 * that still pass it; the return value no longer depends on it.
 */
export function computeInitialStatus(_matterType: string): {
  status: 'triaging' | 'declined';
  changedBy: string | null;
} {
  return { status: 'triaging', changedBy: 'system' };
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
