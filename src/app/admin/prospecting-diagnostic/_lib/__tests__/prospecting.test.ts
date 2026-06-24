import { describe, it, expect } from "vitest";
import {
  buildProspectingDiagnostic,
  buildScanPlan,
  runScans,
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
    // Page counts are not conflated: primary is its own count; total spans both.
    expect(diag.scanSummary.pagesScanned).toBe(5);
    expect(diag.scanSummary.totalPagesScanned).toBe(10);
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

describe("cold email LSO + brand compliance", () => {
  // The full AI banned-vocab list is enforced on SOURCE by the write-time hook,
  // and the cold email is assembled from source string literals, so re-listing
  // those words here would be redundant (and would itself trip the hook). These
  // assertions cover the parts that are dynamic or LSO-specific: market
  // interpolation, promotional / self-designation terms, comparative reframe
  // shapes, and the em dash.
  const REFRAMES = ["reads more like", "less like", "may not be", "not just"];
  // Word-boundary so "expertise" (a fair description of the firm) does not trip.
  const PROMO_RE = [/\bspecialist\b/i, /\bexpert\b/i, /\bguarantee/i, /free audit/i];

  function assertClean(text: string) {
    const lower = text.toLowerCase();
    for (const r of REFRAMES) expect(lower).not.toContain(r);
    for (const re of PROMO_RE) expect(re.test(text)).toBe(false);
    expect(text.includes(EM_DASH)).toBe(false);
  }

  it("is clean across every lead pillar", () => {
    (["authority", "capture", "target", "screen"] as const).forEach((pillar) => {
      assertClean(formatColdEmail(PROSPECT, pillar));
    });
  });

  it("uses the prospect market and never hard-codes a province", () => {
    const bc = formatColdEmail({ ...PROSPECT, market: "Vancouver, British Columbia" }, "screen");
    expect(bc).toContain("law firms in Vancouver, British Columbia");
    expect(bc.toLowerCase()).not.toContain("ontario");

    const none = formatColdEmail({ ...PROSPECT, market: "" }, "capture");
    expect(none).toContain("law firms");
    expect(none.toLowerCase()).not.toContain("ontario");
  });
});

describe("buildScanPlan", () => {
  it("caps alternates, dedupes, drops the primary, and reports the overflow", () => {
    const plan = buildScanPlan(
      "a.ca",
      ["a.ca", "b.ca", "b.ca", "c.ca", "d.ca", "e.ca", "f.ca"],
      "deep",
      4
    );
    // a.ca removed (primary), b.ca deduped → unique [b,c,d,e,f] = 5, capped to 4.
    expect(plan.capped).toEqual(["b.ca", "c.ca", "d.ca", "e.ca"]);
    expect(plan.dropped).toBe(1);
    expect(plan.queue[0]).toEqual({ domain: "a.ca", role: "primary", mode: "deep" });
    expect(plan.queue).toHaveLength(5);
    expect(plan.queue.slice(1).every((q) => q.role === "alternate" && q.mode === "quick")).toBe(true);
  });

  it("reports zero dropped when alternates fit", () => {
    const plan = buildScanPlan("a.ca", ["b.ca"], "standard", 4);
    expect(plan.dropped).toBe(0);
    expect(plan.capped).toEqual(["b.ca"]);
    expect(plan.queue[0].mode).toBe("standard");
  });
});

describe("runScans", () => {
  const liveSignal = () => new AbortController().signal;

  it("cancellation wins over a primary failure (ordering)", async () => {
    const controller = new AbortController();
    // The user cancels mid-request: the scan aborts the controller, then resolves
    // with no result. A null primary result must NOT read as a primary failure.
    const scan = async () => {
      controller.abort();
      return { result: null as null, error: "cancelled" };
    };
    const plan = buildScanPlan("a.ca", [], "quick", 4);
    const outcome = await runScans(plan.queue, { scan, signal: controller.signal });
    expect(outcome.kind).toBe("cancelled");
  });

  it("stops on a genuine primary failure", async () => {
    const scan = async () => ({ result: null as null, error: "boom" });
    const plan = buildScanPlan("a.ca", ["b.ca"], "quick", 4);
    const outcome = await runScans(plan.queue, { scan, signal: liveSignal() });
    expect(outcome).toEqual({ kind: "primary_failed", domain: "a.ca", error: "boom" });
  });

  it("continues past a failed alternate and collects it as unreachable", async () => {
    const map: Record<string, { result: ReturnType<typeof mkResult> | null; error?: string }> = {
      "a.ca": { result: mkResult("a.ca", 60, []) },
      "b.ca": { result: null, error: "down" },
      "c.ca": { result: mkResult("c.ca", 50, []) },
    };
    const scan = async (domain: string) => map[domain];
    const plan = buildScanPlan("a.ca", ["b.ca", "c.ca"], "quick", 4);
    const outcome = await runScans(plan.queue, { scan, signal: liveSignal() });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.scans.map((s) => s.domain)).toEqual(["a.ca", "b.ca", "c.ca"]);
      expect(outcome.scans.find((s) => s.domain === "b.ca")!.result).toBeNull();
      expect(outcome.scans.find((s) => s.domain === "c.ca")!.result).not.toBeNull();
    }
  });

  it("emits a scanning then done progress event per index", async () => {
    const scan = async (domain: string) => ({ result: mkResult(domain, 50, []) });
    const plan = buildScanPlan("a.ca", ["b.ca"], "quick", 4);
    const events: Array<[number, string]> = [];
    await runScans(plan.queue, {
      scan,
      signal: liveSignal(),
      onProgress: (i, status) => events.push([i, status]),
    });
    expect(events).toContainEqual([0, "scanning"]);
    expect(events).toContainEqual([0, "done"]);
    expect(events).toContainEqual([1, "scanning"]);
    expect(events).toContainEqual([1, "done"]);
  });

  it("cancels on a LATER alternate, after prior scans succeeded", async () => {
    const controller = new AbortController();
    const scan = async (domain: string) => {
      if (domain === "c.ca") {
        controller.abort(); // user clicks Cancel during the second alternate
        return { result: null as null, error: "cancelled" };
      }
      return { result: mkResult(domain, 50, []) };
    };
    const plan = buildScanPlan("a.ca", ["b.ca", "c.ca"], "quick", 4);
    const events: Array<[number, string, string | undefined]> = [];
    const outcome = await runScans(plan.queue, {
      scan,
      signal: controller.signal,
      onProgress: (i, status, error) => events.push([i, status, error]),
    });
    // Cancellation is reported at the alternate where it happened (index 2).
    expect(outcome).toEqual({ kind: "cancelled", index: 2 });
    // The earlier rows completed; the cancelled row carries the cancelled marker.
    expect(events).toContainEqual([0, "done", undefined]);
    expect(events).toContainEqual([1, "done", undefined]);
    expect(events).toContainEqual([2, "error", "cancelled"]);
  });

  it("emits an error progress event carrying the failed-alternate reason", async () => {
    const map: Record<string, { result: ReturnType<typeof mkResult> | null; error?: string }> = {
      "a.ca": { result: mkResult("a.ca", 60, []) },
      "b.ca": { result: null, error: "down" },
    };
    const scan = async (domain: string) => map[domain];
    const plan = buildScanPlan("a.ca", ["b.ca"], "quick", 4);
    const events: Array<[number, string, string | undefined]> = [];
    const outcome = await runScans(plan.queue, {
      scan,
      signal: new AbortController().signal,
      onProgress: (i, status, error) => events.push([i, status, error]),
    });
    expect(outcome.kind).toBe("ok");
    expect(events).toContainEqual([0, "done", undefined]);
    expect(events).toContainEqual([1, "error", "down"]);
  });
});
