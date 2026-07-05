/**
 * Smoke test for the server-rendered audit PDF. Proves the template renders to
 * an actual PDF document (a real text layer, unlike a rasterized print), and
 * that it tolerates a minimal / partial saved result without throwing. Uses
 * createElement so this stays a .test.ts (vitest include is *.test.ts only).
 */

import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { AuditReportPdf, type AuditPdfResult } from "../report-pdf";

const FULL: AuditPdfResult = {
  domain: "example.ca",
  scanMode: "quick",
  pagesScanned: 2,
  overallScore: 80,
  grade: "A-",
  aiSearchScore: 53,
  aiSearchGrade: "C",
  aiPolicyScore: 50,
  aiPolicyGrade: "C",
  checkedAt: "2026-07-05T12:00:00.000Z",
  categories: [{ items: [{ status: "pass" }, { status: "fail" }, { status: "warn" }] }],
  severityBreakdown: { critical: 0, high: 1, medium: 11, low: 6, info: 5 },
  issues: [
    {
      id: "a", title: "Content-Security-Policy", category: "Technical & Security", severity: "high",
      confidence: "high", detail: "Missing CSP header.", fix: "Add a Content-Security-Policy header.",
      evidence: "1 page: https://example.ca/", affectedCount: 2, totalPages: 2, effort: "medium",
      internalNote: "Security posture gap.", prospectingAngle: "Open on the missing headers.",
    },
    {
      id: "b", title: "Image alt text", category: "On-Page SEO", severity: "low", confidence: "high",
      detail: "Some images missing alt.", fix: "Add alt text.",
    },
  ],
  pages: [
    { url: "https://example.ca/", pageType: "homepage", pageGrade: "B+", pageScore: 83, indexable: true, wordCount: 831, rendering: { risk: "low" } },
    { url: "https://example.ca/privacy-policy", pageType: "policy", pageGrade: "C", pageScore: 76, indexable: true, wordCount: 381, rendering: { risk: "low" } },
  ],
  aiBots: [
    { name: "ChatGPT-User", blocked: false, category: "search" },
    { name: "GPTBot", blocked: false, category: "training" },
  ],
  renderingSummary: { risk: "low", highRiskPages: 0, mediumRiskPages: 0, totalPages: 2, evidence: ["Server HTML looks crawlable."] },
  internalSummary: {
    prospectFitScore: 62, websiteMaturity: "decent", urgencyLevel: "medium",
    recommendedOpeningAngle: "Open on the firm's strongest practice area.",
    strongestOutreachHooks: ["Missing security headers."], likelyPainPoints: ["Thin structured data."],
    topRevenueOpportunities: [], technicalBlockers: ["No CSP."], aiVisibilityBlockers: [],
    localSeoOpportunities: [], trustAndConversionGaps: [],
  },
};

async function renderHeader(result: AuditPdfResult): Promise<string> {
  const buf = await renderToBuffer(AuditReportPdf({ result }));
  return Buffer.from(buf.subarray(0, 5)).toString("latin1");
}

describe("AuditReportPdf", () => {
  it("renders a full operator result to a real PDF document", async () => {
    expect(await renderHeader(FULL)).toBe("%PDF-");
  }, 30000);

  it("renders a minimal result (no issues, no pages, no internal) without throwing", async () => {
    expect(await renderHeader({ domain: "bare.ca", overallScore: 50, grade: "C" })).toBe("%PDF-");
  }, 30000);

  it("renders an empty result object without throwing", async () => {
    expect(await renderHeader({})).toBe("%PDF-");
  }, 30000);
});
