import { describe, it, expect } from "vitest";
import { buildTrack1Report, scoreToLetterGrade, buildJudgmentDimensions } from "../aggregate";
import type { DimensionResult } from "../dimension-types";
import type { AuthorityDimensionResult } from "../dimensions/authority";
import type { DarkPatternSnapshot } from "../renderer";
import type { JudgmentScore } from "../vision-judgment";

function dimension(name: string, weight: number, score: number, items: DimensionResult["items"] = []): DimensionResult {
  return { name, weight, score, maxScore: 100, items };
}

function cleanDarkPatterns(): DarkPatternSnapshot {
  return {
    preCheckedConsentBoxes: [],
    urgencyOrCountdownSignals: [],
    exitIntentScriptSignals: [],
    bandwagonClaimsWithoutProof: [],
  };
}

function authority(score: number, redFlags: AuthorityDimensionResult["redFlags"] = []): AuthorityDimensionResult {
  return {
    name: "Authority and Positioning",
    weight: 15,
    score,
    maxScore: 100,
    subScores: [{ key: "positioning_clarity", name: "Positioning clarity", weight: 20, score, items: [] }],
    redFlags,
    cappedAt: redFlags.length > 0 ? Math.min(...redFlags.map((f) => f.ceiling)) : null,
  };
}

describe("scoreToLetterGrade", () => {
  it("maps the fixed A/B/C/D/F curve both source docs agree on", () => {
    expect(scoreToLetterGrade(100)).toBe("A");
    expect(scoreToLetterGrade(90)).toBe("A");
    expect(scoreToLetterGrade(89)).toBe("B");
    expect(scoreToLetterGrade(80)).toBe("B");
    expect(scoreToLetterGrade(70)).toBe("C");
    expect(scoreToLetterGrade(60)).toBe("D");
    expect(scoreToLetterGrade(59)).toBe("F");
    expect(scoreToLetterGrade(0)).toBe("F");
  });
});

describe("buildTrack1Report handling of dimensions with nothing to score", () => {
  /** A dimension whose every check was unscorable, which is what
   * `scoreItems` returns for a page with no form at all. */
  function notApplicable(name: string, weight: number): DimensionResult {
    return { name, weight, score: 0, maxScore: 0, items: [] };
  }

  it("excludes an unscorable dimension from the weighted average instead of scoring it zero", () => {
    // Found live: four of the six regression domains have no form on the
    // homepage, and `(score / (maxScore || 100))` turned maxScore 0 into a
    // division by 100, scoring the dimension 0 out of 100 at full weight.
    // A firm that links to a contact page instead of embedding a form was
    // losing real points for a layout the tool never examined.
    const withForm = buildTrack1Report([dimension("Typography and Legibility", 12, 80)], authority(80), undefined, cleanDarkPatterns());
    const withoutForm = buildTrack1Report(
      [dimension("Typography and Legibility", 12, 80), notApplicable("Forms and Conversion Flow", 9)],
      authority(80),
      undefined,
      cleanDarkPatterns()
    );
    expect(withoutForm.uncappedScore).toBe(withForm.uncappedScore);
    expect(withoutForm.uncappedScore).toBe(80);
  });

  it("reports the unscorable dimension rather than hiding it", () => {
    const report = buildTrack1Report(
      [dimension("Typography and Legibility", 12, 80), notApplicable("Forms and Conversion Flow", 9)],
      authority(80),
      undefined,
      cleanDarkPatterns()
    );
    expect(report.notApplicableDimensions).toContain("Forms and Conversion Flow");
  });

  it("shows a null bar score, never a zero, for a dimension it could not grade", () => {
    const report = buildTrack1Report(
      [dimension("Typography and Legibility", 12, 80), notApplicable("Forms and Conversion Flow", 9)],
      authority(80),
      undefined,
      cleanDarkPatterns()
    );
    expect(report.dimensionBar.find((d) => d.name === "Forms and Conversion Flow")?.score).toBeNull();
    expect(report.dimensionBar.find((d) => d.name === "Typography and Legibility")?.score).toBe(80);
  });

  it("still scores a dimension that has real checks, even when they all fail", () => {
    // The exclusion is for "nothing to measure", never for "measured and
    // scored zero". A real form that fails every check must still count.
    const report = buildTrack1Report(
      [dimension("Typography and Legibility", 12, 100), dimension("Forms and Conversion Flow", 9, 0)],
      authority(100),
      undefined,
      cleanDarkPatterns()
    );
    expect(report.notApplicableDimensions).toEqual([]);
    expect(report.uncappedScore).toBeLessThan(100);
  });
});

describe("buildTrack1Report red-flag capping", () => {
  it("caps rather than averages, so a strong page cannot outscore its own red flag", () => {
    // The framework is explicit: "Do not average away a red flag. A dark
    // pattern or a contrast failure is not offset by a beautiful hero.
    // Cap, do not average."
    const strong = [dimension("Typography and Legibility", 12, 100), dimension("Color and Contrast", 10, 100)];
    const report = buildTrack1Report(
      strong,
      authority(100, [{ key: "no_author_entity", label: "No author entity", detail: "none found", ceiling: 55 }]),
      undefined,
      cleanDarkPatterns()
    );
    expect(report.uncappedScore).toBeGreaterThan(55);
    expect(report.score).toBe(55);
    expect(report.letterGrade).toBe("F");
  });

  it("leaves the score uncapped when no flag is active", () => {
    const report = buildTrack1Report([dimension("Typography and Legibility", 12, 80)], authority(80), undefined, cleanDarkPatterns());
    expect(report.redFlagPanel.ceiling).toBeNull();
    expect(report.score).toBe(report.uncappedScore);
  });

  it("applies the lowest ceiling when several flags are active", () => {
    const report = buildTrack1Report(
      [dimension("Typography and Legibility", 12, 100)],
      authority(100, [
        { key: "generic_full_service", label: "Generic full-service", detail: "9 areas", ceiling: 55 },
        { key: "lso_prohibited_word", label: "Prohibited word", detail: "best", ceiling: 40 },
      ]),
      undefined,
      cleanDarkPatterns()
    );
    expect(report.score).toBe(40);
  });

  it("promotes a WCAG contrast failure into a capping flag, not an ordinary deduction", () => {
    const withContrastFail = [
      dimension("Color and Contrast", 10, 50, [
        { label: "Contrast: a \"Book now\"", status: "fail", detail: "2.1:1, below the 4.5:1 minimum." },
      ]),
    ];
    const report = buildTrack1Report(withContrastFail, authority(100), undefined, cleanDarkPatterns());
    expect(report.redFlagPanel.activeFlags.some((f) => f.key === "contrast_failure")).toBe(true);
  });

  it("raises a pre-checked consent flag as proven, and a countdown as best-effort", () => {
    const report = buildTrack1Report(
      [dimension("Typography and Legibility", 12, 90)],
      authority(90),
      undefined,
      {
        ...cleanDarkPatterns(),
        preCheckedConsentBoxes: [{ labelText: "Subscribe me to marketing updates" }],
        urgencyOrCountdownSignals: ['text: "only 2 spots left"'],
      }
    );
    const consent = report.redFlagPanel.activeFlags.find((f) => f.key === "pre_checked_consent");
    const urgency = report.redFlagPanel.activeFlags.find((f) => f.key === "manufactured_urgency");
    expect(consent?.confidence).toBe("proven");
    expect(urgency?.confidence).toBe("best_effort");
  });

  it("always discloses the flags it could not check rather than implying they were clear", () => {
    const report = buildTrack1Report([dimension("Typography and Legibility", 12, 90)], authority(90), undefined, cleanDarkPatterns());
    const keys = report.redFlagPanel.notCheckableInV1.map((n) => n.key);
    expect(keys).toContain("bait_reciprocity");
    expect(keys).toContain("color_only_status");
  });
});

describe("buildTrack1Report findings and honesty", () => {
  it("ranks high-severity findings above medium ones", () => {
    const dims = [
      dimension("Typography and Legibility", 12, 50, [
        { label: "Line height", status: "warn", detail: "150%", fix: "Reduce line-height on body copy." },
      ]),
      dimension("Mobile and Responsive", 6, 50, [
        { label: "Tap target size", status: "fail", detail: "95% too small", fix: "Increase padding on small links." },
      ]),
    ];
    const report = buildTrack1Report(dims, authority(90), undefined, cleanDarkPatterns());
    expect(report.rankedFindings[0].severity).toBe("high");
    expect(report.rankedFindings[0].label).toBe("Tap target size");
  });

  it("frames each finding upside-first, leading with the opportunity and keeping evidence separate", () => {
    // "Frame upside, not deficit" is a standing product rule, and the
    // framework requires the measured fact stay distinguishable from the
    // judgment so the grade survives pushback.
    const dims = [
      dimension("Mobile and Responsive", 6, 50, [
        { label: "Tap target size", status: "fail", detail: "18 of 19 are under 44px", fix: "Increase padding on small links." },
      ]),
    ];
    const report = buildTrack1Report(dims, authority(90), undefined, cleanDarkPatterns());
    expect(report.rankedFindings[0].opportunity).toBe("Increase padding on small links.");
    expect(report.rankedFindings[0].evidence).toBe("18 of 19 are under 44px");
  });

  it("omits passing checks and anything with no concrete fix", () => {
    const dims = [
      dimension("Typography and Legibility", 12, 100, [
        { label: "Line length", status: "pass", detail: "55 characters." },
        { label: "Heading contrast", status: "warn", detail: "flat ratio" },
      ]),
    ];
    const report = buildTrack1Report(dims, authority(90), undefined, cleanDarkPatterns());
    expect(report.rankedFindings).toHaveLength(0);
  });

  it("names the dimension it does not measure instead of silently scoring it", () => {
    const report = buildTrack1Report([dimension("Typography and Legibility", 12, 90)], authority(90), undefined, cleanDarkPatterns());
    expect(report.notMeasuredDimensions).toContain("Navigation and information architecture");
    expect(report.dimensionBar.some((d) => d.name === "Navigation and information architecture")).toBe(false);
  });

  it("flattens the Authority dimension into the bar without needing a flat items array", () => {
    // Regression guard for the live defect this suite was written after:
    // Authority keeps its checks under subScores, and a caller that
    // assumed a flat `items` array threw and silently cost a vision pass.
    const report = buildTrack1Report([dimension("Typography and Legibility", 12, 90)], authority(55), undefined, cleanDarkPatterns());
    expect(report.dimensionBar.find((d) => d.name === "Authority and Positioning")?.score).toBe(55);
  });
});

describe("buildJudgmentDimensions", () => {
  const judgments: JudgmentScore[] = [
    { item: "first_impression", score: 58, reason: "One CTA above the fold." },
    { item: "hierarchy", score: 60, reason: "Two competing headings." },
    { item: "grid_alignment", score: 55, reason: "Edges nearly align." },
    { item: "composition_whitespace", score: 53, reason: "Cramped sections." },
    { item: "coherence", score: 50, reason: "Reads as separate pages." },
    { item: "template_tell", score: 40, reason: "Generic theme." },
    { item: "trust", score: 45, reason: "No proof near the ask." },
  ];

  it("produces the two judgment-backed dimensions the report shows", () => {
    const dims = buildJudgmentDimensions(judgments);
    expect(dims.map((d) => d.name)).toEqual(["First Impression and Clarity", "Visual Hierarchy and Composition"]);
  });

  it("drops the rubric's trust item, since the Authority dimension supersedes it", () => {
    const dims = buildJudgmentDimensions(judgments);
    const allLabels = dims.flatMap((d) => d.items.map((i) => i.label)).join(" ");
    expect(allLabels.toLowerCase()).not.toContain("trust");
  });

  it("keeps coherence and template-tell as unweighted supplementary evidence, not invented dimensions", () => {
    const dims = buildJudgmentDimensions(judgments);
    const hierarchy = dims.find((d) => d.name === "Visual Hierarchy and Composition")!;
    const supplementary = hierarchy.items.filter((i) => i.scored === false);
    expect(supplementary).toHaveLength(2);
  });

  it("returns nothing when the vision pass did not run, rather than fabricating scores", () => {
    expect(buildJudgmentDimensions([])).toEqual([]);
  });
});
