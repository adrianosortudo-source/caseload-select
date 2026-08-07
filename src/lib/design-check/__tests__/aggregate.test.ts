import { describe, it, expect } from "vitest";
import { buildTrack1Report, scoreToLetterGrade, buildJudgmentDimensions } from "../aggregate";
import type { DimensionResult } from "../dimension-types";
import type { AuthorityDimensionResult } from "../dimensions/authority";
import type { DarkPatternSnapshot } from "../render-types";
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
  it("maps the curve recalibrated in Phase 5 of docs/BUILD_PLAN_design_check_calibration_v1.md, not the framework doc's original 90/80/70/60", () => {
    // That original academic curve graded all six regression domains F,
    // including a site built to doctrine with zero active flags: a
    // calibration failure, not a market finding. This curve is derived
    // from the measured six-domain baseline under three fixed
    // constraints (the doctrine-built anchor lands B+, uncapped
    // mid-market sites land C/D not F, F stays reserved for a real
    // disqualifying flag or the genuine bottom tail); see
    // docs/CALIBRATION_PROPOSAL_website_design_grading_v1.md "Corrected
    // baseline v2" for the full derivation.
    expect(scoreToLetterGrade(100)).toBe("A");
    expect(scoreToLetterGrade(85)).toBe("A");
    expect(scoreToLetterGrade(84)).toBe("B");
    expect(scoreToLetterGrade(65)).toBe("B");
    expect(scoreToLetterGrade(64)).toBe("C");
    expect(scoreToLetterGrade(55)).toBe("C");
    expect(scoreToLetterGrade(54)).toBe("D");
    expect(scoreToLetterGrade(45)).toBe("D");
    expect(scoreToLetterGrade(44)).toBe("F");
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
    // pattern or a contrast failure is not offset by a beautiful hero."
    // Uses a disqualifying flag (lso_aggressive_framing): after the
    // Phase 3 split, only disqualifying flags cap the overall grade.
    const strong = [dimension("Typography and Legibility", 12, 100), dimension("Color and Contrast", 10, 100)];
    const report = buildTrack1Report(
      strong,
      authority(100, [{ key: "lso_aggressive_framing", label: "Aggressive framing", detail: "dominate", ceiling: 55, classification: "disqualifying" }]),
      undefined,
      cleanDarkPatterns()
    );
    expect(report.uncappedScore).toBeGreaterThan(55);
    expect(report.score).toBe(55);
    // 55 is the recalibrated curve's exact C threshold (Phase 5); the
    // letter is incidental here, the real assertion is the cap above.
    expect(report.letterGrade).toBe("C");
  });

  it("leaves the score uncapped when no flag is active", () => {
    const report = buildTrack1Report([dimension("Typography and Legibility", 12, 80)], authority(80), undefined, cleanDarkPatterns());
    expect(report.redFlagPanel.ceiling).toBeNull();
    expect(report.score).toBe(report.uncappedScore);
  });

  it("applies the lowest ceiling among several disqualifying flags", () => {
    const report = buildTrack1Report(
      [dimension("Typography and Legibility", 12, 100)],
      authority(100, [
        { key: "lso_aggressive_framing", label: "Aggressive framing", detail: "dominate", ceiling: 55, classification: "disqualifying" },
        { key: "lso_prohibited_word", label: "Prohibited word", detail: "best", ceiling: 40, classification: "disqualifying" },
      ]),
      undefined,
      cleanDarkPatterns()
    );
    expect(report.score).toBe(40);
  });

  it("never caps the overall grade on advisory flags alone, even though the Authority dimension still self-caps on them", () => {
    // Phase 3 of docs/BUILD_PLAN_design_check_calibration_v1.md: fires on
    // 5 of 6 regression domains, describing a market-wide gap, not harm.
    const strong = [dimension("Typography and Legibility", 12, 100), dimension("Color and Contrast", 10, 100)];
    const report = buildTrack1Report(
      strong,
      authority(55, [{ key: "no_author_entity", label: "No author entity", detail: "none found", ceiling: 55, classification: "advisory" }]),
      undefined,
      cleanDarkPatterns()
    );
    expect(report.redFlagPanel.ceiling).toBeNull();
    expect(report.score).toBe(report.uncappedScore);
    // The Authority dimension's OWN score is still 55 (its self-cap,
    // untouched by this phase); only the OVERALL grade is uncapped.
    expect(report.dimensionBar.find((d) => d.name === "Authority and Positioning")?.score).toBe(55);
  });

  it("caps at the lowest disqualifying ceiling and ignores a numerically lower advisory ceiling entirely", () => {
    const report = buildTrack1Report(
      [dimension("Typography and Legibility", 12, 100)],
      authority(100, [
        { key: "lso_prohibited_word", label: "Prohibited word", detail: "best", ceiling: 60, classification: "disqualifying" },
        // Lower ceiling than the disqualifying flag above, but advisory:
        // must not win, or an advisory flag would silently cap the grade
        // through the back door.
        { key: "generic_full_service", label: "Generic full-service", detail: "9 areas", ceiling: 40, classification: "advisory" },
      ]),
      undefined,
      cleanDarkPatterns()
    );
    expect(report.score).toBe(60);
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

describe("buildTrack1Report flag findings (Phase 3)", () => {
  it("pins every active flag at the top of rankedFindings, ahead of ordinary high-severity findings", () => {
    const dims = [
      dimension("Mobile and Responsive", 6, 50, [
        { label: "Tap target size", status: "fail", detail: "95% too small", fix: "Increase padding on small links." },
      ]),
    ];
    const report = buildTrack1Report(
      dims,
      authority(100, [{ key: "lso_prohibited_word", label: "Prohibited word", detail: "best", ceiling: 40, classification: "disqualifying" }]),
      undefined,
      cleanDarkPatterns()
    );
    expect(report.rankedFindings[0].severity).toBe("flag");
    expect(report.rankedFindings[0].label).toBe("Prohibited word");
    expect(report.rankedFindings[1].label).toBe("Tap target size");
  });

  it("ranks a disqualifying flag ahead of an advisory one within the flag tier", () => {
    const report = buildTrack1Report(
      [dimension("Typography and Legibility", 12, 90)],
      authority(90, [
        { key: "no_author_entity", label: "No author entity", detail: "none found", ceiling: 55, classification: "advisory" },
        { key: "lso_prohibited_word", label: "Prohibited word", detail: "best", ceiling: 40, classification: "disqualifying" },
      ]),
      undefined,
      cleanDarkPatterns()
    );
    const flagFindings = report.rankedFindings.filter((f) => f.severity === "flag");
    expect(flagFindings[0].flagClassification).toBe("disqualifying");
    expect(flagFindings[1].flagClassification).toBe("advisory");
  });

  it("writes upside-framed opportunity copy for a flag finding, never a bare restatement of the problem", () => {
    const report = buildTrack1Report(
      [dimension("Typography and Legibility", 12, 90)],
      authority(90, [{ key: "no_author_entity", label: "No author entity", detail: "none found", ceiling: 55, classification: "advisory" }]),
      undefined,
      cleanDarkPatterns()
    );
    const finding = report.rankedFindings.find((f) => f.severity === "flag");
    expect(finding!.opportunity).toContain("Add");
    expect(finding!.evidence).toBe("none found");
  });
});

describe("buildTrack1Report attainable score (Phase 4)", () => {
  it("credits a recoverable fail item against its own dimension's unchanged maxScore", () => {
    // Typography 70/100 with one failing, fixable item: recovering it is
    // worth +10 (a fail item recovers the full 10 points a pass item
    // earns, per scoreItems). Authority sits alongside, untouched.
    // Verified independently by script before pinning: uncapped/score 81,
    // attainable 86.
    const dims = [
      dimension("Typography and Legibility", 12, 70, [{ label: "Line height", status: "fail", detail: "150%", fix: "Reduce line-height on body copy." }]),
    ];
    const report = buildTrack1Report(dims, authority(90), undefined, cleanDarkPatterns());
    expect(report.score).toBe(81);
    expect(report.attainable.score).toBe(86);
    expect(report.attainable.letterGrade).toBe(scoreToLetterGrade(86));
  });

  it("holds the invariant that attainable is never below the current score, especially when a disqualifying flag caps the current score deeply", () => {
    // The case Phase 4 exists for: a flag caps the visible score at 40
    // while the underlying measured craft is 96. Attainable ignores the
    // ceiling (the path always contains the capping flag, so clearing
    // the path is assumed to clear it), surfacing the real number.
    // Verified independently by script: uncapped 96, score 40, attainable 96.
    const report = buildTrack1Report(
      [dimension("Typography and Legibility", 12, 90)],
      authority(100, [{ key: "lso_prohibited_word", label: "Prohibited word", detail: "best", ceiling: 40, classification: "disqualifying" }]),
      undefined,
      cleanDarkPatterns()
    );
    expect(report.score).toBe(40);
    expect(report.attainable.score).toBe(96);
    expect(report.attainable.score).toBeGreaterThanOrEqual(report.score);
  });

  it("renders the equal case (a clean site) without a fabricated gap", () => {
    // Nothing to fix, no flags: attainable equals the current score
    // exactly, not an invented improvement.
    const report = buildTrack1Report([dimension("Typography and Legibility", 12, 100)], authority(100), undefined, cleanDarkPatterns());
    expect(report.attainable.score).toBe(report.score);
    expect(report.attainable.letterGrade).toBe(report.letterGrade);
    expect(report.rankedFindings).toHaveLength(0);
  });

  it("never credits an Authority-dimension finding, even when it sits in the path: the conservative rule", () => {
    // Authority's own sub-scores are not item-additive the way a
    // deterministic checklist is, so a fail item there must not move the
    // attainable number even though it is a real, ranked, in-path
    // finding. Verified independently by script: uncapped/score 68,
    // attainable 68 (unchanged).
    const authorityWithFailItem: AuthorityDimensionResult = {
      name: "Authority and Positioning",
      weight: 15,
      score: 50,
      maxScore: 100,
      subScores: [
        {
          key: "author_credibility",
          name: "Author credibility",
          weight: 20,
          score: 50,
          items: [{ label: "No named author", status: "fail", detail: "none found", fix: "Add a byline." }],
        },
      ],
      redFlags: [],
      cappedAt: null,
    };
    const report = buildTrack1Report([dimension("Typography and Legibility", 12, 90)], authorityWithFailItem, undefined, cleanDarkPatterns());
    const authorityFinding = report.rankedFindings.find((f) => f.dimension === "Authority and Positioning");
    expect(authorityFinding?.inAttainablePath).toBe(true); // it IS in the path
    expect(report.attainable.score).toBe(report.score); // but contributes no credit
    expect(report.attainable.score).toBe(68);
  });

  it("marks every active flag plus enough ordinary findings to reach at least five as in the path", () => {
    const dims = [
      dimension("Typography and Legibility", 12, 50, [
        { label: "Line height", status: "warn", detail: "150%", fix: "Reduce line-height." },
        { label: "Line length", status: "fail", detail: "110 characters", fix: "Narrow the text column." },
      ]),
      dimension("Mobile and Responsive", 6, 50, [{ label: "Tap targets", status: "fail", detail: "95% too small", fix: "Increase padding." }]),
    ];
    const report = buildTrack1Report(dims, authority(90), undefined, cleanDarkPatterns());
    // 3 ordinary findings, no flags: path length is max(5, 0) = 5, but
    // only 3 findings exist, so all 3 are in the path.
    expect(report.rankedFindings).toHaveLength(3);
    expect(report.rankedFindings.every((f) => f.inAttainablePath)).toBe(true);
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
