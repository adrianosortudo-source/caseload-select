/**
 * Triage queue sort key.
 *
 * Lawyers see Band A first, then B, then C, then D (refer-eligible OOS),
 * then anything unbanded (should not happen for live rows; the fallback
 * keeps the comparator total in case the column is unexpectedly null).
 *
 * Band D ranks below A/B/C because OOS / refer-eligible matters are the
 * lowest priority for "act now" attention. Within each band, earliest
 * decision_deadline ranks first — the most urgent matter at the top
 * regardless of how recently it was submitted.
 */

const BAND_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };

export interface TriageSortable {
  band: "A" | "B" | "C" | "D" | null;
  decision_deadline: string;
}

export function compareTriageRows(a: TriageSortable, b: TriageSortable): number {
  const aBand = BAND_ORDER[a.band ?? ""] ?? 99;
  const bBand = BAND_ORDER[b.band ?? ""] ?? 99;
  if (aBand !== bBand) return aBand - bBand;
  return new Date(a.decision_deadline).getTime() - new Date(b.decision_deadline).getTime();
}

export function sortTriageRows<T extends TriageSortable>(rows: T[]): T[] {
  return rows.slice().sort(compareTriageRows);
}
