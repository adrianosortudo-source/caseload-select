import type { DomSnapshot, TextBlockSample } from "../renderer";
import { type CheckItem, type DimensionResult, scoreItems } from "../dimension-types";
import { checkTextContrast } from "../wcag-contrast";

/**
 * Color and contrast (framework weight 10). WCAG AA text contrast is the
 * one fully-defensible check here: a real formula, not a judgment call.
 * Source: framework doc dimension 4, WCAG 2.1 AA.
 *
 * Scope note: only checks samples where the element's OWN
 * background-color is opaque. A transparent background-color means the
 * effective background is painted by an ancestor this single-element
 * sample cannot see; rather than assume white and risk a fabricated
 * pass or fail, those samples are reported as not checkable. See
 * wcag-contrast.ts checkTextContrast.
 */

// WCAG AA: 4.5:1 for normal text, 3:1 for large text (>=24px, or >=18.66px
// and bold/700+).
const AA_NORMAL_TEXT_RATIO = 4.5;
const AA_LARGE_TEXT_RATIO = 3.0;
const LARGE_TEXT_PX = 24;
const LARGE_BOLD_TEXT_PX = 18.66;

function isLargeText(sample: TextBlockSample): boolean {
  const weight = parseInt(sample.fontWeight, 10) || 400;
  if (sample.fontSizePx >= LARGE_TEXT_PX) return true;
  if (sample.fontSizePx >= LARGE_BOLD_TEXT_PX && weight >= 700) return true;
  return false;
}

function checkSampleContrast(sample: TextBlockSample): CheckItem | null {
  const result = checkTextContrast(sample.color, sample.backgroundColor);
  const label = `Contrast: ${sample.tag} "${sample.text.slice(0, 40)}${sample.text.length > 40 ? "..." : ""}"`;

  if (!result.checkable) {
    // Not a defect; genuinely not measurable from this single-element
    // sample. Never scored, never reported as a pass or fail it did not
    // earn.
    return null;
  }

  const threshold = isLargeText(sample) ? AA_LARGE_TEXT_RATIO : AA_NORMAL_TEXT_RATIO;
  const ratio = Math.round(result.ratio * 100) / 100;
  if (ratio >= threshold) {
    return { label, status: "pass", detail: `${ratio}:1, meets WCAG AA (${threshold}:1 required for this text size).` };
  }
  return {
    label,
    status: "fail",
    detail: `${ratio}:1, below the WCAG AA minimum of ${threshold}:1 for this text size. This is an accessibility floor, not a stylistic preference.`,
    fix: "Darken the text color, lighten the background, or both, until the contrast ratio clears the threshold.",
  };
}

export function scoreColorContrast(domSnapshot: DomSnapshot): DimensionResult {
  const allSamples = [...domSnapshot.headingSamples, ...domSnapshot.bodyTextSample];
  const items: CheckItem[] = [];
  let uncheckableCount = 0;

  for (const sample of allSamples) {
    const item = checkSampleContrast(sample);
    if (item) items.push(item);
    else uncheckableCount++;
  }

  if (items.length === 0) {
    items.push({
      label: "Text contrast",
      status: "pass",
      detail:
        uncheckableCount > 0
          ? `${uncheckableCount} text sample${uncheckableCount > 1 ? "s" : ""} had a transparent own background-color and could not be checked from a single-element sample.`
          : "No text samples available to check.",
      scored: false,
    });
  } else if (uncheckableCount > 0) {
    items.push({
      label: "Contrast coverage note",
      status: "pass",
      detail: `${uncheckableCount} of ${allSamples.length} sampled text elements could not be contrast-checked (transparent own background-color; the effective background is painted by an ancestor).`,
      scored: false,
    });
  }

  const { score, maxScore } = scoreItems(items);
  return { name: "Color and Contrast", weight: 10, score, maxScore, items };
}
