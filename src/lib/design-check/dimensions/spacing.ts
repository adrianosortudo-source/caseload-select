import type { DomSnapshot } from "../renderer";
import { type CheckItem, type DimensionResult, scoreItems } from "../dimension-types";

/**
 * Spacing, grid, and alignment (framework weight 9). Phase 1 covers only
 * the deterministic half: scale adherence via a margin/padding histogram.
 * "Grid type matches content type" and "whitespace reads as confident"
 * are judgment calls deferred to the Phase 2 vision-model layer, per the
 * framework's own D/J split for this dimension. Source: framework doc
 * dimension 5, Visual Craft Principles Part 3 §16.
 */

// A common non-linear spacing scale. Framework doc's own suggested values.
const SCALE_STEPS = [4, 8, 12, 16, 24, 32, 48, 64, 96];
const TOLERANCE_PX = 2; // rem-based sizing rounds to sub-pixel; allow slack
const MIN_SAMPLE_SIZE = 10;

function isOnScale(value: number): boolean {
  return SCALE_STEPS.some((step) => Math.abs(value - step) <= TOLERANCE_PX);
}

export function scoreSpacing(domSnapshot: DomSnapshot): DimensionResult {
  const values = domSnapshot.spacingValuesPx;
  const items: CheckItem[] = [];

  if (values.length < MIN_SAMPLE_SIZE) {
    items.push({
      label: "Spacing scale adherence",
      status: "pass",
      detail: `Only ${values.length} non-zero spacing value${values.length === 1 ? "" : "s"} sampled, too few to judge a pattern.`,
      scored: false,
    });
  } else {
    const onScaleCount = values.filter(isOnScale).length;
    const pct = Math.round((onScaleCount / values.length) * 100);
    const distinctOffScale = new Set(values.filter((v) => !isOnScale(v))).size;

    if (pct >= 70) {
      items.push({
        label: "Spacing scale adherence",
        status: "pass",
        detail: `${pct}% of sampled margin/padding values (${values.length} sampled) land on a consistent scale (4/8/12/16/24/32/48/64/96px, ±${TOLERANCE_PX}px).`,
      });
    } else if (pct >= 45) {
      items.push({
        label: "Spacing scale adherence",
        status: "warn",
        detail: `${pct}% of sampled spacing values land on a consistent scale; ${distinctOffScale} distinct off-scale value${distinctOffScale === 1 ? "" : "s"} suggest ad-hoc spacing decisions in places.`,
        fix: "Standardize margins and padding on a small fixed scale (for example 4/8/12/16/24/32/48/64/96px) instead of one-off values chosen per element.",
      });
    } else {
      items.push({
        label: "Spacing scale adherence",
        status: "fail",
        detail: `Only ${pct}% of sampled spacing values land on a consistent scale, with ${distinctOffScale} distinct off-scale values. This reads as ad-hoc spacing rather than a deliberate system, even when a visitor cannot name why.`,
        fix: "Adopt a fixed spacing scale and audit existing margins/padding against it; a long tail of one-off pixel values is the signature of accumulated small inconsistencies.",
      });
    }
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "Spacing, Grid, and Alignment (partial: scale adherence only)", weight: 9, score, maxScore, items };
}
