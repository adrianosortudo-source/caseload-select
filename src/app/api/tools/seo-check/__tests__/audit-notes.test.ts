/**
 * Tests for the operator "Audit note" classifier used in SeoReport.tsx
 * (classifyAuditNote). The function is defined in a "use client" component
 * with no JSX-transform precedent for direct import in this vitest config
 * (see signals.test.ts for the same replication pattern), so the rules are
 * replicated here verbatim to pin the classification without restructuring
 * the component.
 */

import { describe, it, expect } from "vitest";

type Severity = "critical" | "high" | "medium" | "low" | "info";
type Confidence = "high" | "medium" | "low";
type AuditNoteKind = "safe" | "verify" | "hygiene" | "crawler_limitation";

interface Issue {
  title: string;
  category: string;
  severity: Severity;
  confidence: Confidence;
  pageTypeImpact?: string[];
}

const CONTENT_EXTRACTION_LABELS = new Set([
  "Semantic HTML structure", "Direct-answer sentences", "Question-format headings",
  "Author / reviewer signals", "Entity description",
]);

const VERIFY_MANUALLY_LABELS = new Set([
  "Server-rendered content", "JavaScript app-shell dependency", "Noscript fallback",
  "Consultation call to action", "Contact form / direct contact",
  "No clear contact path", "No attorney / team page found",
]);

const HYGIENE_LABELS = new Set([
  "Image alt text", "Meta description", "H1 heading", "H2 subheadings",
  "Content-to-HTML ratio", "HTML document size", "Anchor text quality",
  "Open Graph tags", "Word count", "Heading hierarchy", "Internal links",
  "External links",
]);

function classifyAuditNote(issue: Issue): AuditNoteKind {
  const policyOnly = issue.pageTypeImpact && issue.pageTypeImpact.length > 0
    && issue.pageTypeImpact.every((t) => t === "policy");

  if (issue.confidence === "low" || policyOnly || CONTENT_EXTRACTION_LABELS.has(issue.title)) {
    return "crawler_limitation";
  }
  if (VERIFY_MANUALLY_LABELS.has(issue.title)) {
    return "verify";
  }
  if (HYGIENE_LABELS.has(issue.title) || issue.severity === "low" || issue.severity === "info") {
    return "hygiene";
  }
  return "safe";
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
