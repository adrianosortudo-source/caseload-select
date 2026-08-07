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

// A second, equally legitimate scale system: the plain 8-point grid (every
// multiple of 8), the other common convention alongside the named
// progressive steps above. Added after live investigation (2026-08-06,
// see docs/CALIBRATION_PROPOSAL_website_design_grading_v1.md "Phase 1")
// found drglaw.ca, a site built to a deliberate token scale, scoring 0
// here. Its off-SCALE_STEPS values (56, 80, 88, 112, 40, 72, 200) were
// ALL exact multiples of 8, not arbitrary numbers: a real, coherent grid
// the named-steps list simply does not enumerate. Tested against all six
// regression domains before adopting: this test is tight (near-zero
// tolerance, since a genuine 8px grid lands on exact multiples, not
// merely "close" to them) specifically so it does not become a net wide
// enough to catch ad-hoc spacing too. On the off-canonical values, 86% of
// drglaw.ca's and 88% of tmalaw.ca's were exact 8pt-grid hits, versus 11%
// for marathonlaw.ca and 10% for gosailaw.com: the test discriminates a
// real second scale from noise rather than inflating every site's score.
const GRID_BASE_PX = 8;
const GRID_TOLERANCE_PX = 1;

function isOnNamedScale(value: number): boolean {
  return SCALE_STEPS.some((step) => Math.abs(value - step) <= TOLERANCE_PX);
}

function isOn8ptGrid(value: number): boolean {
  const remainder = value % GRID_BASE_PX;
  return remainder <= GRID_TOLERANCE_PX || GRID_BASE_PX - remainder <= GRID_TOLERANCE_PX;
}

function isOnScale(value: number): boolean {
  return isOnNamedScale(value) || isOn8ptGrid(value);
}

const MIN_SAMPLE_SIZE = 10;

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
        detail: `${pct}% of sampled margin/padding values (${values.length} sampled) land on a consistent scale (either the 4/8/12/16/24/32/48/64/96px named steps, ±${TOLERANCE_PX}px, or a plain 8px grid).`,
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
