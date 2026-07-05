/**
 * Audit notes (operator only): a deterministic read on how safe an issue is to
 * cite before a re-check, derived from category / severity / confidence /
 * evidence. Not a new signal, just a classification of signals the engine
 * already produced, so it applies to saved historical runs without a re-scan.
 *
 * Shared by the on-screen report (SeoReport.tsx) and the server-rendered PDF
 * (report-pdf.tsx) so the two never drift. Pure logic, no React or I/O, so it
 * imports cleanly into a client component, a server module, and a vitest file.
 * Lives beside the engine (not under the frozen marketing tree) so new files
 * do not trip the website-boundary hook.
 */

export type AuditNoteKind = "safe" | "verify" | "hygiene" | "crawler_limitation";

/** Only the issue fields the classifier reads. Both callers' Issue satisfies this. */
export interface AuditableIssue {
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: "high" | "medium" | "low";
  pageTypeImpact?: string[];
}

export const AUDIT_NOTE_LABEL: Record<AuditNoteKind, string> = {
  safe: "Safe to mention",
  verify: "Verify manually",
  hygiene: "Low-priority hygiene",
  crawler_limitation: "Crawler limitation",
};

// Content-extraction findings depend on parsing raw server HTML for meaning
// (definitions, Q&A patterns, authorship). A JS-rendered page can read as a
// false negative here even when the content exists after hydration.
const CONTENT_EXTRACTION_LABELS = new Set([
  "Semantic HTML structure", "Direct-answer sentences", "Question-format headings",
  "Author / reviewer signals", "Entity description",
]);

// Rendering and structure findings are prone to the same class of false
// negative the SEO tool itself has been calibrated against: CTA text, contact
// widgets, and team bios that render client-side are invisible to a raw-HTML
// crawl even though a visitor sees them. "No practice-area pages found" is
// deliberately NOT here: it is a URL/page-type inventory fact (hardened
// against the same client-render class of false positive already), so it
// falls through to the safe-to-mention default below.
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

export function classifyAuditNote(issue: AuditableIssue): AuditNoteKind {
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
