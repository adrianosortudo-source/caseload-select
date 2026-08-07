import type { CheckItem, DimensionResult } from "./dimension-types";
import type { AuthorityDimensionResult } from "./dimensions/authority";
import type { JudgmentScore } from "./vision-judgment";
import type { DarkPatternSnapshot } from "./renderer";
import { buildRedFlagPanel, type RedFlagPanel, type RedFlag } from "./red-flags";

/**
 * Phase 4: Track 1 aggregation, letter grade, and the ranked findings
 * report. WEBSITE_DESIGN_GRADING_FRAMEWORK.md "Output design" and
 * "Scoring model" sections.
 *
 * Honesty gap, disclosed rather than smoothed over: the master framework
 * names 10 Track 1 dimensions. "Navigation and information architecture"
 * (weight 9) has no scorer built in this v1 (only its hamburger-label
 * sub-check exists, folded into the Mobile dimension). Rather than
 * silently treating it as a perfect or zero score, it is excluded from
 * the weighted total, and the total is renormalized to the dimensions
 * actually measured. The report must say so explicitly; see
 * `notMeasuredDimensions` below and the framework's own calibration
 * warning: "the measured facts are what make the whole grade defensible."
 */

const NOT_MEASURED_DIMENSIONS = ["Navigation and information architecture"];

export interface GradeBand {
  letter: "A" | "B" | "C" | "D" | "F";
  min: number;
}

// Fixed curve, consistent between the master framework's own example
// (line 183) and the Authority module's grade-band table (line 162).
const GRADE_BANDS: GradeBand[] = [
  { letter: "A", min: 90 },
  { letter: "B", min: 80 },
  { letter: "C", min: 70 },
  { letter: "D", min: 60 },
  { letter: "F", min: 0 },
];

export function scoreToLetterGrade(score: number): GradeBand["letter"] {
  const band = GRADE_BANDS.find((b) => score >= b.min);
  return band?.letter ?? "F";
}

/**
 * Synthesizes two Track-1 dimensions from Phase 2's 7-item design
 * judgment rubric. "trust" is deliberately dropped: the Authority module
 * (Phase 3) absorbs and replaces the framework's dimension 8 more
 * rigorously, per the build plan. "coherence" and "template_tell" do not
 * map onto any one of the framework's 10 named dimensions; they are
 * folded into the hierarchy dimension's item list as supplementary,
 * non-dimension-defining evidence rather than invented a weighted slot of
 * their own.
 */
export function buildJudgmentDimensions(judgments: JudgmentScore[]): DimensionResult[] {
  const byKey = new Map(judgments.map((j) => [j.item, j]));
  const dimensions: DimensionResult[] = [];

  const firstImpression = byKey.get("first_impression");
  if (firstImpression) {
    const items: CheckItem[] = [judgmentToItem("Value and audience clear above the fold, one action wins the eye", firstImpression)];
    dimensions.push({ name: "First Impression and Clarity", weight: 12, score: firstImpression.score, maxScore: 100, items });
  }

  const hierarchyKeys = ["hierarchy", "grid_alignment", "composition_whitespace"] as const;
  const hierarchyJudgments = hierarchyKeys.map((k) => byKey.get(k)).filter((j): j is JudgmentScore => !!j);
  if (hierarchyJudgments.length > 0) {
    const items: CheckItem[] = hierarchyJudgments.map((j) =>
      judgmentToItem(j.item === "hierarchy" ? "Visual hierarchy" : j.item === "grid_alignment" ? "Grid and alignment" : "Composition and whitespace", j)
    );
    const coherence = byKey.get("coherence");
    const templateTell = byKey.get("template_tell");
    if (coherence) items.push({ ...judgmentToItem("Whole-page coherence (supplementary, not weighted)", coherence), scored: false });
    if (templateTell) items.push({ ...judgmentToItem("Designed-for-this-business vs. generic template (supplementary, not weighted)", templateTell), scored: false });
    const avgScore = Math.round(hierarchyJudgments.reduce((s, j) => s + j.score, 0) / hierarchyJudgments.length);
    dimensions.push({ name: "Visual Hierarchy and Composition", weight: 12, score: avgScore, maxScore: 100, items });
  }

  return dimensions;
}

function judgmentToItem(label: string, judgment: JudgmentScore): CheckItem {
  const status = judgment.score >= 70 ? "pass" : judgment.score >= 40 ? "warn" : "fail";
  return { label, status, detail: `${judgment.score}/100. ${judgment.reason}` };
}

export interface DimensionBarEntry {
  name: string;
  weight: number;
  /** 0-100, or null when nothing on this page was scorable for the
   * dimension (e.g. no form to grade). Null is excluded from the weighted
   * average rather than counted as zero. */
  score: number | null;
}

export interface RankedFinding {
  dimension: string;
  label: string;
  severity: "flag" | "high" | "medium";
  /** Upside-framed headline (the fix, stated as the gain), per the
   * framework's "frame upside, not deficit" output rule. */
  opportunity: string;
  /** The measured fact behind the finding, kept separate from the
   * upside framing per the framework's objective/subjective split. */
  evidence: string;
  /** A disclosed ESTIMATE from fix-text keywords, not a measured cost.
   * Never presented to the reader as more precise than it is. */
  estimatedEffort: "low" | "medium" | "high";
  /** Set only on severity "flag" entries (see red-flags.ts / Phase 3 of
   * docs/BUILD_PLAN_design_check_calibration_v1.md): which class of red
   * flag this is, so a disqualifying flag (caps the grade) ranks above
   * an advisory one (a real opportunity, caps nothing) within the flag
   * tier, and so the report can visually tell the two apart. */
  flagClassification?: "disqualifying" | "advisory";
}

const HIGH_EFFORT_PATTERN = /restructure|rebuild|redesign|narrow the text column|add (organization|person) schema|reorganiz/i;
const LOW_EFFORT_PATTERN = /^(add a |add an |set |state |remove |attribute |show |link )/i;

function estimateEffort(fix: string): RankedFinding["estimatedEffort"] {
  if (HIGH_EFFORT_PATTERN.test(fix)) return "high";
  if (LOW_EFFORT_PATTERN.test(fix)) return "low";
  return "medium";
}

// Upside-framed copy per red-flag key: the gain from clearing the flag,
// never a restatement of the problem. Covers every key detectFrameworkRedFlags
// (red-flags.ts) can produce, across all three flag sources.
const FLAG_OPPORTUNITY_COPY: Record<string, string> = {
  pre_checked_consent: "Uncheck this box by default so a visitor's consent reflects a choice they actually made.",
  manufactured_urgency: "Remove the countdown or urgency signal so the page reads as considered rather than pressured.",
  exit_intent_popup: "Remove the exit-intent pop-up so a visitor who is not ready yet can leave and come back without friction.",
  bandwagon_claim_without_proof: "Attach a citation or source next to this claim so the number reads as evidence, not an assertion.",
  contrast_failure: "Darken the text, lighten the background, or both, so every visitor, including those with low vision, can read this content.",
  self_designation_without_proof: "Back this claim with a named, dated basis (an award, a credential, a published source) so it reads as earned rather than asserted.",
  generic_full_service: "Name the firm's actual point of difference so a visitor can tell this firm apart from a generic full-service listing.",
  no_author_entity: "Add a named byline or author markup so visitors and search engines can see who stands behind this content.",
  unattributed_testimonials: "Attach a name or a verifiable basis to at least one testimonial so it reads as real evidence.",
  lso_specialist_expert_unearned: "Name the Certified Specialist designation and practice area, or replace this word with earned, verifiable language.",
  lso_prohibited_word: "Replace this word with a specific, evidence-backed statement the firm can stand behind.",
  lso_aggressive_framing: "Replace aggressive framing with language that demonstrates earned authority instead.",
  possible_outcome_guarantee: "Confirm this is not an outcome promise, or rephrase it so it reads as a legitimate legal term rather than a guarantee of results.",
};

const FLAG_SOURCE_DIMENSION: Record<RedFlag["source"], string> = {
  dark_pattern: "Trust and Conversion Patterns",
  contrast_failure: "Color and Contrast",
  authority_module: "Authority and Positioning",
};

function buildFlagFindings(activeFlags: RedFlag[]): RankedFinding[] {
  return activeFlags.map((f) => {
    const opportunity = FLAG_OPPORTUNITY_COPY[f.key] ?? "Address this flagged item to strengthen the page.";
    return {
      dimension: FLAG_SOURCE_DIMENSION[f.source],
      label: f.label,
      severity: "flag",
      opportunity,
      evidence: f.detail,
      estimatedEffort: estimateEffort(opportunity),
      flagClassification: f.classification,
    };
  });
}

function buildRankedFindings(dimensions: DimensionResult[], flagFindings: RankedFinding[]): RankedFinding[] {
  const findings: RankedFinding[] = [...flagFindings];
  for (const dim of dimensions) {
    for (const item of dim.items) {
      if (item.status === "pass" || !item.fix) continue;
      findings.push({
        dimension: dim.name,
        label: item.label,
        severity: item.status === "fail" ? "high" : "medium",
        opportunity: item.fix,
        evidence: item.detail,
        estimatedEffort: estimateEffort(item.fix),
      });
    }
  }
  // Rank by impact (flag tier first, disqualifying flags before advisory
  // ones within it, then high/medium by severity, then the owning
  // dimension's weight) then by low cost to fix, per the framework's
  // "rank by impact then by low cost" instruction.
  const dimensionWeight = new Map(dimensions.map((d) => [d.name, d.weight]));
  const effortOrder: Record<RankedFinding["estimatedEffort"], number> = { low: 0, medium: 1, high: 2 };
  const severityOrder: Record<RankedFinding["severity"], number> = { flag: 0, high: 1, medium: 2 };
  const flagClassOrder: Record<"disqualifying" | "advisory", number> = { disqualifying: 0, advisory: 1 };
  return findings.sort((a, b) => {
    const severityDelta = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDelta !== 0) return severityDelta;
    if (a.severity === "flag" && b.severity === "flag") {
      const classDelta = flagClassOrder[a.flagClassification ?? "advisory"] - flagClassOrder[b.flagClassification ?? "advisory"];
      if (classDelta !== 0) return classDelta;
    }
    const weightDelta = (dimensionWeight.get(b.dimension) ?? 0) - (dimensionWeight.get(a.dimension) ?? 0);
    if (weightDelta !== 0) return weightDelta;
    return effortOrder[a.estimatedEffort] - effortOrder[b.estimatedEffort];
  });
}

export interface Track1Report {
  score: number; // 0-100, post red-flag cap
  uncappedScore: number;
  letterGrade: GradeBand["letter"];
  dimensionBar: DimensionBarEntry[];
  notMeasuredDimensions: string[];
  /** Dimensions this page gave the tool nothing to score. Reported, never
   * silently folded into the grade as a zero. */
  notApplicableDimensions: string[];
  rankedFindings: RankedFinding[];
  redFlagPanel: RedFlagPanel;
}

export function buildTrack1Report(
  deterministicDimensions: DimensionResult[],
  authority: AuthorityDimensionResult,
  visionJudgments: JudgmentScore[] | undefined,
  darkPatterns: DarkPatternSnapshot
): Track1Report {
  const judgmentDimensions = visionJudgments ? buildJudgmentDimensions(visionJudgments) : [];
  const authorityAsDimension: DimensionResult = { name: authority.name, weight: authority.weight, score: authority.score, maxScore: authority.maxScore, items: authority.subScores.flatMap((s) => s.items) };
  const allDimensions = [...deterministicDimensions, authorityAsDimension, ...judgmentDimensions];

  // A dimension whose every check was unscorable (maxScore 0) was NOT
  // MEASURED on this page, which is not the same as scoring zero. Forms is
  // the common case: a firm whose homepage links to a contact page instead
  // of embedding a form has nothing to grade here, and grading it 0 out of
  // 100 at full weight 9 punishes a layout choice the tool never examined.
  // Four of the six regression domains hit exactly that. These are dropped
  // from the weighted average (which renormalizes over the rest) and
  // reported separately, the same posture as notMeasuredDimensions.
  const scoredDimensions = allDimensions.filter((d) => d.maxScore > 0);
  const notApplicableDimensions = allDimensions.filter((d) => d.maxScore === 0);

  const totalWeight = scoredDimensions.reduce((sum, d) => sum + d.weight, 0);
  const weightedSum = scoredDimensions.reduce((sum, d) => sum + (d.score / d.maxScore) * 100 * d.weight, 0);
  const uncappedScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  const redFlagPanel = buildRedFlagPanel(darkPatterns, deterministicDimensions, authority.redFlags);
  const score = redFlagPanel.ceiling !== null ? Math.min(uncappedScore, redFlagPanel.ceiling) : uncappedScore;

  const dimensionBar: DimensionBarEntry[] = allDimensions.map((d) => ({
    name: d.name,
    weight: d.weight,
    // null, never 0: "nothing here to measure" must not read as a failure.
    score: d.maxScore > 0 ? Math.round((d.score / d.maxScore) * 100) : null,
  }));

  return {
    score,
    uncappedScore,
    letterGrade: scoreToLetterGrade(score),
    dimensionBar,
    notMeasuredDimensions: NOT_MEASURED_DIMENSIONS,
    notApplicableDimensions: notApplicableDimensions.map((d) => d.name),
    rankedFindings: buildRankedFindings(allDimensions, buildFlagFindings(redFlagPanel.activeFlags)),
    redFlagPanel,
  };
}
