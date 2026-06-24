import { describe, it, expect } from "vitest";
import {
  buildProspectingDiagnostic,
  classifyActs,
  formatColdEmail,
  formatCallAgenda,
  formatReportText,
  type ProspectInput,
  type DomainScan,
} from "../prospecting";
import type { SeoCheckIssue, SeoCheckResult, SeverityBreakdown } from "../seo-types";

let seq = 0;
function mkIssue(
  over: Partial<SeoCheckIssue> & { category: string; title: string }
): SeoCheckIssue {
  return {
    id: `issue-${seq++}`,
    category: over.category,
    severity: over.severity ?? "high",
    status: over.status ?? "fail",
    title: over.title,
    detail: over.detail ?? "detail",
    fix: over.fix ?? "Do the fix on the affected pages.",
    evidence: over.evidence ?? "1 page: /",
    affectedUrls: over.affectedUrls ?? ["https://example.ca/"],
    affectedCount: over.affectedCount ?? 1,
    totalPages: over.totalPages ?? 5,
    confidence: over.confidence ?? "high",
    effort: over.effort ?? "low",
    priority: over.priority ?? 50,
    prospectingAngle: over.prospectingAngle,
    internalNote: over.internalNote,
  };
}

function mkResult(domain: string, overallScore: number, issues: SeoCheckIssue[]): SeoCheckResult {
  const severityBreakdown: SeverityBreakdown = {
    critical: 0,
    high: issues.length,
    medium: 0,
    low: 0,
    info: 0,
  };
  return {
    domain,
    scanMode: "quick",
    pagesScanned: 5,
    categories: [],
    overallScore,
    grade: "C",
    aiSearchScore: 40,
    aiSearchGrade: "D",
    aiPolicyScore: 50,
    aiPolicyGrade: "C",
    issues,
    severityBreakdown,
    partial: false,
    checkedAt: "2026-06-24T00:00:00.000Z",
    internalSummary: {
      prospectFitScore: 70,
      websiteMaturity: "basic",
      urgencyLevel: "high",
      likelyPainPoints: [],
      strongestOutreachHooks: ["Hook one is clean.", "Hook two is clean."],
      recommendedOpeningAngle: "Lead on where the site quietly undersells the firm.",
      topRevenueOpportunities: [],
      technicalBlockers: [],
      aiVisibilityBlockers: [],
      localSeoOpportunities: [],
      trustAndConversionGaps: [],
    },
  };
}

const PROSPECT: ProspectInput = {
  firmName: "Example Law Professional Corporation",
  primaryDomain: "example.ca",
  alternateDomains: [],
  market: "Toronto, Ontario",
  practiceFocus: "Immigration and litigation",
  competitors: [],
  notes: "",
};

function fullIssueSet(): SeoCheckIssue[] {
  return [
    mkIssue({
      category: "Indexability",
      title: "Indexable",
      priority: 100,
      prospectingAngle: "Some pages are held back from search by a technical setting, not by content.",
    }),
    mkIssue({
      category: "AI Visibility",
      title: "Entity description",
      priority: 80,
      prospectingAngle: "The firm is not described as a named entity AI systems can read.",
    }),
    mkIssue({
      category: "Schema & Structured Data",
      title: "Business / LegalService schema",
      priority: 70,
      prospectingAngle: "No structured data tells search who the firm is.",
    }),
    mkIssue({
      category: "Links & Content",
      title: "Word count",
      priority: 60,
      prospectingAngle: "Several pages are thin on substantive content.",
    }),
    mkIssue({
      category: "Legal Marketing",
      title: "No practice-area pages found",
      priority: 65,
      prospectingAngle: "High-value searches have nowhere to land.",
    }),
    mkIssue({
      category: "Legal Marketing",
      title: "Consultation call to action",
      priority: 75,
      prospectingAngle: "Ready-to-act visitors have no obvious next step.",
    }),
  ];
}

// Em dash, built from its code point so the brand-voice hook does not flag this
// file (a literal em dash anywhere in the repo is banned).
const EM_DASH = String.fromCharCode(0x2014);

describe("classifyActs", () => {
  const cases: Array<[string, string, string]> = [
    ["Indexability", "Indexable", "capture"],
    ["On-Page SEO", "Page title", "capture"],
    ["Local SEO", "Phone number (NAP)", "capture"],
    ["Performance", "Time to first byte", "capture"],
    ["Technical & Security", "HTTPS", "capture"],
    ["Schema & Structured Data", "JSON-LD structured data", "authority"],
    ["Links & Content", "Word count", "target"],
    ["AI Visibility", "Entity description", "authority"],
    ["AI Visibility", "Question-format headings", "target"],
    ["AI Visibility", "Direct-answer sentences", "target"],
    ["AI Visibility", "Semantic HTML structure", "target"],
    ["Legal Marketing", "Phone number visible", "screen"],
    ["Legal Marketing", "Consultation call to action", "screen"],
    ["Legal Marketing", "No clear contact path", "screen"],
    ["Legal Marketing", "Trust signals", "authority"],
    ["Legal Marketing", "Policy / disclaimer pages", "authority"],
    ["Legal Marketing", "Practice-area intent", "target"],
    ["Legal Marketing", "No practice-area pages found", "target"],
  ];
  it.each(cases)("maps %s / %s to %s", (category, title, pillar) => {
    expect(classifyActs(category, title)).toBe(pillar);
  });
});

describe("buildProspectingDiagnostic", () => {
  it("populates all four ACTS sections and the spec fields", () => {
    const scans: DomainScan[] = [
      { domain: "example.ca", role: "primary", result: mkResult("example.ca", 55, fullIssueSet()) },
    ];
    const diag = buildProspectingDiagnostic(PROSPECT, scans);

    // Each pillar got a real finding (not the strength placeholder) and caps at 4.
    (["authority", "capture", "target", "screen"] as const).forEach((p) => {
      expect(diag.actsFindings[p].length).toBeGreaterThanOrEqual(1);
      expect(diag.actsFindings[p].length).toBeLessThanOrEqual(4);
    });
    expect(diag.actsFindings.capture[0].title).toBe("Indexable");
    expect(diag.actsFindings.screen.some((f) => f.title === "Consultation call to action")).toBe(true);
    expect(diag.actsFindings.target.some((f) => f.title === "No practice-area pages found")).toBe(true);

    // Spec fields present.
    expect(diag.topOutreachHooks.length).toBeGreaterThan(0);
    expect(diag.strategicCallQuestions.length).toBeGreaterThanOrEqual(5);
    expect(diag.strategicCallQuestions.length).toBeLessThanOrEqual(7);
    expect(diag.thirtySixtyNinetyPlan.day30.length).toBeGreaterThan(0);
    expect(diag.thirtySixtyNinetyPlan.day60.length).toBeGreaterThan(0);
    expect(diag.thirtySixtyNinetyPlan.day90.length).toBeGreaterThan(0);
    expect(diag.reportReadySummary).toContain("Example Law Professional Corporation");
    expect(diag.coldEmailDraft).toContain("Subject: Quick observation");

    // The lead pillar (highest-priority issue is Indexability) drives the email.
    expect(diag.coldEmailDraft.toLowerCase()).toContain("held back from search");
    // CaseLoad Screen anchors the 30-day plan.
    expect(diag.thirtySixtyNinetyPlan.day30.join(" ")).toContain("CaseLoad Screen");
  });

  it("flags domain fragmentation and names the cleanest domain", () => {
    const scans: DomainScan[] = [
      { domain: "example.ca", role: "primary", result: mkResult("example.ca", 62, fullIssueSet()) },
      { domain: "old-example.com", role: "alternate", result: mkResult("old-example.com", 38, []) },
    ];
    const prospect = { ...PROSPECT, alternateDomains: ["old-example.com"] };
    const diag = buildProspectingDiagnostic(prospect, scans);

    expect(diag.domainComparison).toBeDefined();
    expect(diag.domainComparison!.fragmentationFlagged).toBe(true);
    expect(diag.domainComparison!.strongestDomain).toBe("example.ca");
    // Fragmentation finding is promoted to the front of Authority.
    expect(diag.actsFindings.authority[0].title.toLowerCase()).toContain("fragment");
    // Domain question is added to the strategic call list.
    expect(diag.strategicCallQuestions[0].toLowerCase()).toContain("domain");
  });

  it("handles an unreachable alternate without crashing", () => {
    const scans: DomainScan[] = [
      { domain: "example.ca", role: "primary", result: mkResult("example.ca", 60, fullIssueSet()) },
      { domain: "dead.example", role: "alternate", result: null, error: "Could not connect" },
    ];
    const prospect = { ...PROSPECT, alternateDomains: ["dead.example"] };
    const diag = buildProspectingDiagnostic(prospect, scans);

    expect(diag.domainComparison!.fragmentationFlagged).toBe(false);
    expect(diag.domainComparison!.canonicalRecommendation).toContain("Only");
    const deadRow = diag.domainComparison!.rows.find((r) => r.domain === "dead.example")!;
    expect(deadRow.reachable).toBe(false);
  });

  it("falls back to strength findings when the primary scan has no issues", () => {
    const scans: DomainScan[] = [
      { domain: "example.ca", role: "primary", result: mkResult("example.ca", 88, []) },
    ];
    const diag = buildProspectingDiagnostic(PROSPECT, scans);
    (["authority", "capture", "target", "screen"] as const).forEach((p) => {
      expect(diag.actsFindings[p].length).toBe(1);
      expect(diag.actsFindings[p][0].title).toContain("looks solid");
    });
    expect(diag.coldEmailDraft).toContain("Subject:");
  });
});

describe("brand-voice safety of generated copy", () => {
  it("never emits an em dash in operator or prospect-facing text", () => {
    const scans: DomainScan[] = [
      { domain: "example.ca", role: "primary", result: mkResult("example.ca", 55, fullIssueSet()) },
    ];
    const diag = buildProspectingDiagnostic({ ...PROSPECT, alternateDomains: ["old.example"] }, [
      ...scans,
      { domain: "old.example", role: "alternate", result: mkResult("old.example", 40, []) },
    ]);

    const blobs = [
      diag.coldEmailDraft,
      diag.reportReadySummary,
      diag.recommendedOpeningAngle,
      ...diag.strategicCallQuestions,
      ...diag.thirtySixtyNinetyPlan.day30,
      ...diag.thirtySixtyNinetyPlan.day60,
      ...diag.thirtySixtyNinetyPlan.day90,
      formatColdEmail(PROSPECT, "screen"),
      formatCallAgenda(diag),
      formatReportText(diag),
    ];
    for (const b of blobs) {
      expect(b.includes(EM_DASH)).toBe(false);
    }
  });
});
