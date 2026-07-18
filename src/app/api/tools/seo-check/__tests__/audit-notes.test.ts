/**
 * Tests for the operator "Audit note" classifier (classifyAuditNote), the
 * canonical implementation in ../audit-notes. That module is shared by the
 * on-screen report (SeoReport.tsx) and the server-rendered PDF (report-pdf.tsx),
 * so this test pins the real function rather than a replica.
 */

import { describe, it, expect } from "vitest";
import { classifyAuditNote, classifyActionTier } from "../audit-notes";

type Severity = "critical" | "high" | "medium" | "low" | "info";
type Confidence = "high" | "medium" | "low";

interface Issue {
  title: string;
  category: string;
  severity: Severity;
  confidence: Confidence;
  pageTypeImpact?: string[];
  detail?: string;
}

function issue(overrides: Partial<Issue> & Pick<Issue, "title" | "category">): Issue {
  return { severity: "high", confidence: "high", ...overrides };
}

describe("classifyAuditNote", () => {
  it("rates schema, NAP, security-header, and no-practice-pages findings as safe to mention", () => {
    expect(classifyAuditNote(issue({ title: "JSON-LD structured data", category: "Schema & Structured Data" }))).toBe("safe");
    expect(classifyAuditNote(issue({ title: "NAP in structured data", category: "Local SEO" }))).toBe("safe");
    expect(classifyAuditNote(issue({ title: "HSTS header", category: "Technical & Security" }))).toBe("safe");
    expect(classifyAuditNote(issue({ title: "Content-Security-Policy", category: "Technical & Security" }))).toBe("safe");
    // structure-practice ("No practice-area pages found") is a URL/page-type
    // inventory fact, not a content-extraction check, so it is safe despite
    // sharing the "Legal Marketing" category with the CTA/contact findings below.
    expect(classifyAuditNote(issue({ title: "No practice-area pages found", category: "Legal Marketing" }))).toBe("safe");
  });

  it("rates rendering, CTA, contact, and team findings as verify manually", () => {
    expect(classifyAuditNote(issue({ title: "Consultation call to action", category: "Legal Marketing" }))).toBe("verify");
    expect(classifyAuditNote(issue({ title: "Contact form / direct contact", category: "Legal Marketing" }))).toBe("verify");
    expect(classifyAuditNote(issue({ title: "No clear contact path", category: "Legal Marketing" }))).toBe("verify");
    expect(classifyAuditNote(issue({ title: "No attorney / team page found", category: "AI Visibility" }))).toBe("verify");
    expect(classifyAuditNote(issue({ title: "JavaScript app-shell dependency", category: "Technical & Security" }))).toBe("verify");
    expect(classifyAuditNote(issue({ title: "Server-rendered content", category: "Technical & Security" }))).toBe("verify");
  });

  it("rates on-page cosmetic findings as low-priority hygiene", () => {
    expect(classifyAuditNote(issue({ title: "Image alt text", category: "On-Page SEO" }))).toBe("hygiene");
    expect(classifyAuditNote(issue({ title: "Meta description", category: "On-Page SEO" }))).toBe("hygiene");
    expect(classifyAuditNote(issue({ title: "H1 heading", category: "On-Page SEO" }))).toBe("hygiene");
    expect(classifyAuditNote(issue({ title: "Content-to-HTML ratio", category: "Links & Content" }))).toBe("hygiene");
  });

  it("falls back to hygiene for any low or info severity finding regardless of label", () => {
    expect(classifyAuditNote(issue({ title: "Third-party scripts", category: "Performance", severity: "low" }))).toBe("hygiene");
    expect(classifyAuditNote(issue({ title: "llms.txt file", category: "AI Visibility", severity: "info" }))).toBe("hygiene");
  });

  it("rates low-confidence findings as a crawler limitation regardless of label", () => {
    expect(classifyAuditNote(issue({ title: "Business / LegalService schema", category: "Schema & Structured Data", confidence: "low" }))).toBe("crawler_limitation");
  });

  it("rates content-extraction findings as a crawler limitation (raw-HTML dependent)", () => {
    expect(classifyAuditNote(issue({ title: "Semantic HTML structure", category: "AI Visibility" }))).toBe("crawler_limitation");
    expect(classifyAuditNote(issue({ title: "Direct-answer sentences", category: "AI Visibility" }))).toBe("crawler_limitation");
    expect(classifyAuditNote(issue({ title: "Question-format headings", category: "AI Visibility" }))).toBe("crawler_limitation");
  });

  it("rates findings whose affected pages are policy-only as a crawler limitation", () => {
    expect(classifyAuditNote(issue({
      title: "Page title", category: "On-Page SEO", pageTypeImpact: ["policy"],
    }))).toBe("crawler_limitation");
    // Mixed impact (policy + commercial) does not qualify as policy-only.
    expect(classifyAuditNote(issue({
      title: "Page title", category: "On-Page SEO", pageTypeImpact: ["policy", "practice"],
    }))).not.toBe("crawler_limitation");
  });

  it("crawler-limitation checks take priority over hygiene and verify buckets", () => {
    // Low confidence + a hygiene label still reads as a crawler limitation, since
    // an operator should distrust the finding before worrying about its priority.
    expect(classifyAuditNote(issue({ title: "Image alt text", category: "On-Page SEO", confidence: "low" }))).toBe("crawler_limitation");
  });
});

describe("classifyActionTier", () => {
  it("rates AI training bot control as a policy decision regardless of severity (task: blocking is a policy choice, not a defect)", () => {
    expect(classifyActionTier(issue({ title: "AI training bot control", category: "AI Visibility", severity: "high", confidence: "high" }))).toBe("policy_decision");
    expect(classifyActionTier(issue({ title: "AI training bot control", category: "AI Visibility", severity: "low", confidence: "high" }))).toBe("policy_decision");
  });

  it("rates content-extraction and low-confidence findings as needing verification", () => {
    expect(classifyActionTier(issue({ title: "Direct-answer sentences", category: "AI Visibility" }))).toBe("verify");
    expect(classifyActionTier(issue({ title: "Question-format headings", category: "AI Visibility" }))).toBe("verify");
    expect(classifyActionTier(issue({ title: "Business / LegalService schema", category: "Schema & Structured Data", confidence: "low" }))).toBe("verify");
  });

  it("rates static-analysis-proxy diagnostics as needing verification, not a confirmed problem", () => {
    // Render-blocking-resource counts and content-to-HTML ratio are measured
    // from raw HTML, not actual page-load performance; they need
    // corroborating evidence before being treated as a problem.
    expect(classifyActionTier(issue({ title: "Render-blocking resources", category: "Performance", severity: "info" }))).toBe("verify");
    expect(classifyActionTier(issue({ title: "Content-to-HTML ratio", category: "Links & Content", severity: "low" }))).toBe("verify");
  });

  it("rates a single-sample TTFB reading as needing verification even at fail severity", () => {
    expect(classifyActionTier(issue({
      title: "Time to first byte", category: "Performance", severity: "high", confidence: "medium",
      detail: "1176ms on a single-sample measurement. A single reading can be skewed by network noise.",
    }))).toBe("verify");
  });

  it("does not require single-sample verification once corroborated by a multi-sample median", () => {
    expect(classifyActionTier(issue({
      title: "Time to first byte", category: "Performance", severity: "high", confidence: "medium",
      detail: "Slow (median 950ms; range 900-1000ms, 3 samples).",
    }))).not.toBe("verify");
  });

  it("rates high-confidence critical/high findings as action required", () => {
    expect(classifyActionTier(issue({ title: "Indexable", category: "Indexability", severity: "critical", confidence: "high" }))).toBe("action_required");
    expect(classifyActionTier(issue({ title: "Trust signals", category: "Legal Marketing", severity: "high", confidence: "high" }))).toBe("action_required");
  });

  it("does not rate a low-confidence critical/high finding as action required", () => {
    expect(classifyActionTier(issue({ title: "Trust signals", category: "Legal Marketing", severity: "high", confidence: "low" }))).not.toBe("action_required");
  });

  it("rates info-severity findings as informational", () => {
    expect(classifyActionTier(issue({ title: "HTML document size", category: "Performance", severity: "info" }))).toBe("informational");
  });

  it("rates report-only CSP as an optimization opportunity, not informational (a concrete next action exists: promote to enforced)", () => {
    expect(classifyActionTier(issue({
      title: "Content-Security-Policy", category: "Technical & Security", severity: "low", confidence: "high",
      detail: "Monitoring enabled (Content-Security-Policy-Report-Only); enforcement still pending.",
    }))).toBe("optimization");
  });

  it("falls back to optimization for medium/low severity findings that are not policy, verify, or informational", () => {
    expect(classifyActionTier(issue({ title: "Meta description", category: "On-Page SEO", severity: "low", confidence: "high" }))).toBe("optimization");
    expect(classifyActionTier(issue({ title: "Practice-area intent", category: "Legal Marketing", severity: "medium", confidence: "high" }))).toBe("optimization");
  });
});
