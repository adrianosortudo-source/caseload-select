import type { DomSnapshot, TextBlockSample } from "../renderer";
import { type CheckItem, type DimensionResult, scoreItems } from "../dimension-types";

/**
 * Typography and legibility (framework weight 12). Fully deterministic:
 * every check here reads a real computed style or a real canvas-measured
 * font metric, never a vision-model judgment. Source: framework doc
 * dimension 3 + Visual Craft Principles Part 2 §11, Part 4 §25-26.
 */

const LINE_LENGTH_MIN = 45;
const LINE_LENGTH_MAX = 75;
const LINE_HEIGHT_RATIO_MIN = 1.2;
const LINE_HEIGHT_RATIO_MAX = 1.45;
const NARROW_COLUMN_PX = 400;
const HEADING_CONTRAST_MIN_RATIO = 1.25; // h1 vs h2 font-size ratio, "a jump not a nudge"

function headingLevel(tag: string): number {
  return Number(tag.replace("h", "")) || 0;
}

function checkLineLength(bodySamples: TextBlockSample[]): CheckItem {
  const measurable = bodySamples.filter(
    (s) => s.tag === "p" && s.avgCharWidthPx !== null && s.avgCharWidthPx > 0 && s.widthPx > 0
  );
  if (measurable.length === 0) {
    return {
      label: "Body line length",
      status: "pass",
      detail: "No measurable body paragraphs found in the sample.",
      scored: false,
    };
  }
  const charsPerLine = measurable.map((s) => Math.round(s.widthPx / (s.avgCharWidthPx as number)));
  const avg = Math.round(charsPerLine.reduce((a, b) => a + b, 0) / charsPerLine.length);
  const inRange = avg >= LINE_LENGTH_MIN && avg <= LINE_LENGTH_MAX;
  if (inRange) {
    return { label: "Body line length", status: "pass", detail: `~${avg} characters per line, within the 45-75 range.` };
  }
  const tooNarrow = avg < LINE_LENGTH_MIN;
  return {
    label: "Body line length",
    status: "warn",
    detail: `~${avg} characters per line, ${tooNarrow ? "narrower than" : "wider than"} the 45-75 range that keeps reading rhythm comfortable.`,
    fix: tooNarrow
      ? "Widen the text column, or increase the font size relative to the column width."
      : "Narrow the text column (max-width on the paragraph container) so lines do not run too long to track easily.",
  };
}

function checkLineHeight(bodySamples: TextBlockSample[]): CheckItem {
  const measurable = bodySamples.filter((s) => s.tag === "p" && s.fontSizePx > 0 && s.lineHeightPx > 0);
  if (measurable.length === 0) {
    return { label: "Body line height", status: "pass", detail: "No measurable body paragraphs found.", scored: false };
  }
  const ratios = measurable.map((s) => s.lineHeightPx / s.fontSizePx);
  const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const pct = Math.round(avgRatio * 100);
  if (avgRatio >= LINE_HEIGHT_RATIO_MIN && avgRatio <= LINE_HEIGHT_RATIO_MAX) {
    return { label: "Body line height", status: "pass", detail: `${pct}% of font size, within the 120-145% range.` };
  }
  const tooTight = avgRatio < LINE_HEIGHT_RATIO_MIN;
  return {
    label: "Body line height",
    status: "warn",
    detail: `${pct}% of font size, ${tooTight ? "tighter than" : "looser than"} the 120-145% range.`,
    fix: tooTight
      ? "Increase line-height on body copy so lines do not feel like they belong to different thoughts."
      : "Reduce line-height on body copy; overly loose leading breaks reading rhythm as much as overly tight leading does.",
  };
}

function checkAllCapsBody(bodySamples: TextBlockSample[]): CheckItem {
  const offenders = bodySamples.filter((s) => s.tag === "p" && s.textTransform === "uppercase");
  if (offenders.length === 0) {
    return { label: "All-caps body copy", status: "pass", detail: "No paragraph-length text set in all caps." };
  }
  return {
    label: "All-caps body copy",
    status: "fail",
    detail: `${offenders.length} paragraph${offenders.length > 1 ? "s" : ""} set in all caps. All-caps measurably slows reading comprehension at paragraph length.`,
    fix: "Reserve all-caps for short labels and eyebrows; set body-length copy in normal case.",
  };
}

function checkJustifiedNarrowColumn(bodySamples: TextBlockSample[]): CheckItem {
  const offenders = bodySamples.filter((s) => s.textAlign === "justify" && s.widthPx > 0 && s.widthPx < NARROW_COLUMN_PX);
  if (offenders.length === 0) {
    return { label: "Justified text on narrow columns", status: "pass", detail: "No narrow-column text found using full justification." };
  }
  return {
    label: "Justified text on narrow columns",
    status: "warn",
    detail: `${offenders.length} text block${offenders.length > 1 ? "s" : ""} under ${NARROW_COLUMN_PX}px wide use full justification, which creates visible rivers of white space at that width.`,
    fix: "Use ragged-right (text-align: left) instead of justify on narrow columns.",
  };
}

function checkHeadingContrast(headingSamples: TextBlockSample[]): CheckItem {
  const h1 = headingSamples.find((h) => h.tag === "h1");
  const h2 = headingSamples.find((h) => h.tag === "h2");
  if (!h1 || !h2 || h1.fontSizePx <= 0 || h2.fontSizePx <= 0) {
    return {
      label: "Headline-to-subline contrast",
      status: "pass",
      detail: "Not enough distinct heading levels present to compare.",
      scored: false,
    };
  }
  const ratio = h1.fontSizePx / h2.fontSizePx;
  if (ratio >= HEADING_CONTRAST_MIN_RATIO) {
    return {
      label: "Headline-to-subline contrast",
      status: "pass",
      detail: `H1 is ${ratio.toFixed(2)}x the size of H2, a real jump.`,
    };
  }
  return {
    label: "Headline-to-subline contrast",
    status: "warn",
    detail: `H1 is only ${ratio.toFixed(2)}x the size of H2. A barely-perceptible size difference reads as a mistake, not a hierarchy decision.`,
    fix: "Increase the size or weight gap between H1 and H2 so the hierarchy reads as an intentional jump.",
  };
}

function checkHeadingOrder(snapshot: DomSnapshot): CheckItem[] {
  const items: CheckItem[] = [];
  items.push(
    snapshot.h1Count === 1
      ? { label: "Single H1", status: "pass", detail: "Exactly one H1 on the page." }
      : snapshot.h1Count === 0
        ? { label: "Single H1", status: "fail", detail: "No H1 found. The main heading signals the page's primary topic.", fix: "Add a single H1 as the page's main heading." }
        : { label: "Single H1", status: "warn", detail: `${snapshot.h1Count} H1 tags found. Best practice is one per page.`, fix: "Keep one H1; convert the others to H2 or H3." }
  );

  const levels = snapshot.headingOrder.map(headingLevel).filter((n) => n > 0);
  let maxSeen = 0;
  let skipped = false;
  for (const level of levels) {
    if (level > maxSeen + 1 && maxSeen > 0) skipped = true;
    maxSeen = Math.max(maxSeen, level);
  }
  items.push(
    skipped
      ? {
          label: "No skipped heading levels",
          status: "warn",
          detail: "The heading sequence skips a level (for example H1 straight to H3), which breaks the semantic outline independent of how it looks.",
          fix: "Insert the missing intermediate heading level, or restructure so the sequence steps down one level at a time.",
        }
      : { label: "No skipped heading levels", status: "pass", detail: "Heading levels step down without skipping." }
  );

  return items;
}

export function scoreTypography(domSnapshot: DomSnapshot): DimensionResult {
  const items: CheckItem[] = [
    checkLineLength(domSnapshot.bodyTextSample),
    checkLineHeight(domSnapshot.bodyTextSample),
    checkAllCapsBody(domSnapshot.bodyTextSample),
    checkJustifiedNarrowColumn(domSnapshot.bodyTextSample),
    checkHeadingContrast(domSnapshot.headingSamples),
    ...checkHeadingOrder(domSnapshot),
  ];
  const { score, maxScore } = scoreItems(items);
  return { name: "Typography and Legibility", weight: 12, score, maxScore, items };
}
