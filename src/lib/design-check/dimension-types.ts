/**
 * Shared report shape for design-check dimensions. Mirrors seo-check's
 * CheckItem/CategoryResult shape (label/status/detail/fix, pass=10/warn=5/
 * fail=0 scoring) for report-format consistency across the two tools, but
 * defined independently rather than imported, per the 2026-07-16 decision
 * to keep the two tools' scoring logic distinct.
 */

/**
 * tablestakes vs differentiation (Brand Amplitude's Brand Audit framework,
 * "points of parity" vs "points of difference"): a tablestakes failure
 * means the firm is not credible at all in this category, independent of
 * anything else on the page; a differentiation gap means the firm is
 * credible but has not stated why a visitor should pick them over any
 * other credible firm. Conflating the two produces the generic-grader
 * feel this tool is built to avoid: "you're missing category basics" and
 * "you have no stated point of difference" are different conversations,
 * and the report should never present them as the same kind of finding.
 * Optional because not every check cleanly maps to one side (a WCAG
 * contrast failure is tablestakes; a "grid alignment" judgment score
 * often is not really either).
 */
export type FindingTag = "tablestakes" | "differentiation";

export interface CheckItem {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
  /** false = displayed but excluded from scoring (informational only). */
  scored?: boolean;
  tag?: FindingTag;
}

export interface DimensionResult {
  name: string;
  weight: number;
  score: number;
  maxScore: number;
  items: CheckItem[];
}

/**
 * Stamps a tag onto every item that doesn't already carry one. Used at
 * the dimension-aggregation point rather than on each individual check
 * literal: most checks in a given deterministic dimension share the same
 * tag (Typography, Color/Contrast, Forms, and Mobile are entirely
 * tablestakes territory), so tagging per-dimension is the accurate,
 * low-diff place to do it. A check passed in with its own tag already
 * set (used for the few checks that are craft-quality rather than
 * tablestakes or differentiation, and so are deliberately left untagged
 * by the caller) is never overwritten.
 */
export function tagUntagged(items: CheckItem[], tag: FindingTag): CheckItem[] {
  return items.map((item) => (item.tag ? item : { ...item, tag }));
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
