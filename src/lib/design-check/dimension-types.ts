/**
 * Shared report shape for design-check dimensions. Mirrors seo-check's
 * CheckItem/CategoryResult shape (label/status/detail/fix, pass=10/warn=5/
 * fail=0 scoring) for report-format consistency across the two tools, but
 * defined independently rather than imported, per the 2026-07-16 decision
 * to keep the two tools' scoring logic distinct.
 */

export interface CheckItem {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
  /** false = displayed but excluded from scoring (informational only). */
  scored?: boolean;
}

export interface DimensionResult {
  name: string;
  weight: number;
  score: number;
  maxScore: number;
  items: CheckItem[];
}

export function scoreItems(items: CheckItem[]): { score: number; maxScore: number } {
  let score = 0;
  let maxScore = 0;
  for (const item of items) {
    if (item.scored === false) continue;
    maxScore += 10;
    if (item.status === "pass") score += 10;
    else if (item.status === "warn") score += 5;
  }
  return { score, maxScore };
}
