import type { DesignCheckResult } from "../../src/components/website-design-check/WebsiteDesignCheckReport";

// Synthetic, test-only data. Intercepted in the browser; never sent to a service.
export const fixture: DesignCheckResult = {
  domain: "synthetic-fixture.example",
  checkedAt: "2026-11-08T12:00:00.000Z",
  score: 40, uncappedScore: 76, letterGrade: "F",
  attainable: { score: 76, letterGrade: "B" },
  dimensionBar: [
    { name: "Typography and Legibility", weight: 1, score: 75 },
    { name: "Color and Contrast", weight: 1, score: null },
    { name: "Forms and Conversion Flow", weight: 1, score: 83 },
    { name: "Performance and Technical Health", weight: 1, score: 80 },
    { name: "Spacing, Grid, and Alignment (partial: scale adherence only)", weight: 1, score: 100 },
    { name: "Mobile and Responsive", weight: 1, score: 67 },
    { name: "Authority and Positioning", weight: 1, score: 40 },
  ],
  notApplicableDimensions: ["Color and Contrast"],
  notMeasuredDimensions: ["Navigation and information architecture"],
  rankedFindings: [
    { dimension: "Authority and Positioning", label: "Self-designation without proof", flagKey: "self_designation_without_proof", severity: "flag", flagClassification: "disqualifying", inAttainablePath: true, estimatedEffort: "medium", opportunity: "Back this claim with a named, dated basis (an award, a credential, a published source) so it reads as earned rather than asserted.", evidence: "Synthetic evidence for the visual regression fixture, including a longer sentence that exercises the available component measure." },
    { dimension: "Authority and Positioning", label: "Testimonial attribution", severity: "high", inAttainablePath: true, estimatedEffort: "low", opportunity: "Attribute each testimonial to a name and, where possible, a matter type. An unattributed quote is not verifiable proof.", evidence: "Synthetic attribution evidence used to verify the visual layout." },
    { dimension: "Authority and Positioning", label: "Naked self-designation claims", severity: "high", inAttainablePath: true, estimatedEffort: "medium", opportunity: "Remove unbacked superlatives, or pair each with adjacent verifiable proof (a named credential, a dated review, a specific case).", evidence: "Synthetic claim evidence for a longer paragraph in the report." },
    { dimension: "Mobile and Responsive", label: "Tap target size", severity: "high", estimatedEffort: "medium", opportunity: "Increase padding on small links and buttons so the tappable area meets the minimum, even if the visible text stays the same size.", evidence: "Synthetic target-size evidence for the visual regression fixture." },
    { dimension: "Typography and Legibility", label: "Headline-to-subline contrast", severity: "medium", estimatedEffort: "medium", opportunity: "Increase the size or weight gap between H1 and H2 so the hierarchy reads as an intentional jump.", evidence: "Synthetic heading-hierarchy evidence for the visual regression fixture." },
  ],
  redFlagPanel: {
    ceiling: 40,
    activeFlags: [{ key: "self_designation_without_proof", label: "Self-designation without proof", detail: "Synthetic evidence for a visible limitation in the report, with enough detail to exercise natural paragraph wrapping.", ceiling: 40, confidence: "best_effort", source: "Synthetic fixture", classification: "disqualifying" }],
    notCheckableInV1: [{ key: "synthetic-interaction", label: "Status or error shown by color alone", reason: "Requires triggering form validation and interactive states to observe; not reliably detectable from a single static render." }],
  },
};
