import { describe, expect, it } from "vitest";
import { compareDiagnostics, type SavedRunLike } from "../compare";
import type { SeoCheckIssue, SeoCheckResult, SeverityBreakdown } from "../seo-types";

function issue(id: string, title: string, severity: SeoCheckIssue["severity"] = "high"): SeoCheckIssue {
  return {
    id,
    category: "Intent Alignment",
    severity,
    status: "fail",
    title,
    detail: title,
    affectedUrls: ["https://example.ca/a"],
    affectedCount: 1,
    totalPages: 1,
    confidence: "high",
    effort: "medium",
    priority: 50,
  };
}

function result(over: Partial<SeoCheckResult> = {}): SeoCheckResult {
  const severityBreakdown: SeverityBreakdown = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  return {
    domain: "example.ca",
    scanMode: "quick",
    pagesScanned: 5,
    pages: [],
    categories: [],
    overallScore: 50,
    grade: "C",
    aiSearchScore: 60,
    aiSearchGrade: "B",
    aiPolicyScore: 50,
    aiPolicyGrade: "C",
    issues: [],
    severityBreakdown,
    checkedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

function run(id: string, seo: number, issues: SeoCheckIssue[], intentScore = 40): SavedRunLike {
  return {
    id,
    prospect_firm_name: "Example Law",
    primary_domain: "example.ca",
    created_at: "2026-07-01T00:00:00.000Z",
    overall_score: seo,
    ai_search_score: 60,
    intent_score: intentScore,
    prospect_fit_score: 70,
    pages_scanned: 5,
    total_pages_scanned: 5,
    diagnostic: {
      prospect: { firmName: "Example Law", primaryDomain: "example.ca", alternateDomains: [], market: "", practiceFocus: "", competitors: [], notes: "" },
      scanSummary: { checkedAt: "2026-07-01T00:00:00.000Z", pagesScanned: 5, totalPagesScanned: 5, scanMode: "quick", domainsChecked: ["example.ca"] },
      actsFindings: { authority: [], capture: [], target: [], screen: [] },
      topOutreachHooks: [],
      strategicCallQuestions: [],
      recommendedOpeningAngle: "",
      thirtySixtyNinetyPlan: { day30: [], day60: [], day90: [] },
      reportReadySummary: "",
      coldEmailDraft: "",
    },
    scans: [
      {
        domain: "example.ca",
        role: "primary",
        result: result({
          overallScore: seo,
          issues,
          intentAlignment: {
            score: intentScore,
            grade: "C",
            confidence: "medium",
            bestMatchingPage: "https://example.ca/service",
            evidence: [],
          },
        }),
      },
    ],
  };
}

describe("compareDiagnostics", () => {
  it("computes score deltas and issue movement", () => {
    const before = run("old", 50, [issue("a", "Old issue"), issue("b", "Persistent issue")], 40);
    const after = run("new", 65, [issue("b", "Persistent issue", "medium"), issue("c", "New issue")], 55);

    const comparison = compareDiagnostics(before, after);

    expect(comparison.scoreDeltas.find((s) => s.label === "SEO Health")?.delta).toBe(15);
    expect(comparison.scoreDeltas.find((s) => s.label === "Intent Alignment")?.delta).toBe(15);
    expect(comparison.resolvedIssues.map((i) => i.id)).toEqual(["a"]);
    expect(comparison.newIssues.map((i) => i.id)).toEqual(["c"]);
    expect(comparison.persistentIssues.map((i) => i.id)).toEqual(["b"]);
    expect(comparison.persistentIssues[0].beforeSeverity).toBe("high");
    expect(comparison.persistentIssues[0].afterSeverity).toBe("medium");
  });

  it("describes competitor changes", () => {
    const before = run("old", 50, []);
    before.scans.push({ domain: "competitor.ca", role: "competitor", result: result({ overallScore: 70, aiSearchScore: 65 }) });
    const after = run("new", 52, []);
    after.scans.push({ domain: "competitor.ca", role: "competitor", result: result({ overallScore: 80, aiSearchScore: 65 }) });

    expect(compareDiagnostics(before, after).competitorChanges[0]).toContain("SEO 70 to 80");
  });
});
