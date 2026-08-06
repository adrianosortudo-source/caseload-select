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
  detail?: string;
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
  // Trust-fix pass WI-2: fires on presence (review markup ineligible for
  // Google review stars). Whether it is misleading depends on comparing the
  // markup to reviews actually visible on the page, a human judgment call.
  "Review / Rating schema",
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

/* ────────────────────────────────────────────────────────
   Action tiers: the report-level grouping (top of report-pdf.tsx /
   SeoReport.tsx). classifyAuditNote above answers "how much do I trust this
   finding"; classifyActionTier answers "what kind of thing is this and what,
   if anything, should the reader DO about it" so the report can stop
   headlining every warning as an undifferentiated "issue" and instead group
   by what response it actually calls for.
   ──────────────────────────────────────────────────────── */

export type ActionTier = "action_required" | "optimization" | "policy_decision" | "verify" | "informational";

export const ACTION_TIER_LABEL: Record<ActionTier, string> = {
  action_required: "Action required",
  optimization: "Optimization opportunity",
  policy_decision: "Policy / business decision",
  verify: "Diagnostic requiring verification",
  informational: "Informational",
};

export const ACTION_TIER_ORDER: ActionTier[] = ["action_required", "optimization", "policy_decision", "verify", "informational"];

// Findings that describe a legitimate business/policy choice, not a defect.
// Blocking AI-training crawlers is opting OUT of having content used to
// train models, a decision a firm might deliberately make either way; it is
// not evidence the site is broken or unmaintained.
const POLICY_DECISION_LABELS = new Set<string>(["AI training bot control"]);

// Findings that are a static-analysis PROXY for a real-world outcome (actual
// page-load performance, actual AI citation) rather than a direct
// observation of it, so they need corroborating evidence before being acted
// on as a confirmed problem.
const DIAGNOSTIC_LABELS = new Set<string>(["Render-blocking resources", "Content-to-HTML ratio"]);

/**
 * Classify an issue into one of five report-level buckets. Order matters:
 * a policy choice is never "action required" regardless of severity, and a
 * diagnostic that only proxies for a real outcome (or a single-sample
 * measurement, or anything classifyAuditNote already flagged as unreliable
 * or needing a manual look) is "verify" before severity is even considered.
 */
export function classifyActionTier(issue: AuditableIssue): ActionTier {
  if (POLICY_DECISION_LABELS.has(issue.title)) return "policy_decision";

  const note = classifyAuditNote(issue);
  if (note === "crawler_limitation" || note === "verify") return "verify";
  if (DIAGNOSTIC_LABELS.has(issue.title)) return "verify";
  if (issue.detail && /single-sample/i.test(issue.detail)) return "verify";

  if (issue.severity === "info") return "informational";
  if ((issue.severity === "critical" || issue.severity === "high") && issue.confidence !== "low") return "action_required";
  return "optimization";
}
