// Direct answer / quotable definition data model (AEO doctrine formalization).
//
// A "quotable definition" is a concise, standalone, plain-language answer to
// the central question of a content piece: 1-3 sentences, understandable if
// quoted outside the page. This module is the shared shape for that decision
// across the pipeline. It does not add a database column: the decision is
// authored on content_pieces.source_brief.direct_answer (the same
// no-new-column pattern documented in docs/CONTENT_STUDIO_SEO_AEO_SPEC.md
// Section 3 for answer_summary and its siblings), then snapshotted onto the
// generated content_piece_versions.seo_metadata.direct_answer at draft/edit
// time so the decision is bound to the exact version it describes, the same
// way every other seo_metadata field already is.
//
// No I/O, no server-only: pure shape + pure helpers, directly unit-testable.

/**
 * required        - the brief has decided a quotable definition must appear;
 *                    missing text/classification is a release-gate failure.
 * optional        - a quotable definition may help but is not mandated; if
 *                    text is supplied it is held to the same quality bar as
 *                    "required".
 * not_applicable  - a deliberate decision that no quotable definition belongs
 *                    on this asset (a real choice, not a silent omission).
 */
export type DirectAnswerApplicability = "required" | "optional" | "not_applicable";

/**
 * binding_rule    - a legal proposition presented as governing law (a
 *                    statute, regulation, or settled rule). Requires a
 *                    jurisdiction/scope note and a primary source mapping.
 * market_practice - a description of how things are commonly done, not a
 *                    legal requirement (e.g. "landlords typically ask for...").
 * firm_judgment   - the firm's own professional judgment or house position,
 *                    not a claim about the law or the market.
 * illustration    - a worked example or hypothetical used to make a concept
 *                    concrete, not a general statement of fact.
 * explanatory     - plain editorial framing (what a term means, how a process
 *                    works) that is not itself a legal proposition.
 */
export type DirectAnswerClassification =
  | "binding_rule"
  | "market_practice"
  | "firm_judgment"
  | "illustration"
  | "explanatory";

/**
 * mapped        - one or more primary-source references are on file.
 * not_required  - the classification does not call for a primary source
 *                 (market_practice / firm_judgment / illustration / explanatory).
 * exempted      - a substantive legal statement without a mapped source,
 *                 carrying an explicit operator-stated reason.
 */
export type DirectAnswerSourceStatus = "mapped" | "not_required" | "exempted";

export interface DirectAnswerMetadata {
  applicability: DirectAnswerApplicability;
  /** 1-3 sentence plain-language answer/definition. Null when not_applicable. */
  text: string | null;
  classification: DirectAnswerClassification | null;
  /** Jurisdiction or scope qualifier, e.g. "Ontario", "under a standard-form commercial lease". */
  jurisdiction_scope: string | null;
  source_status: DirectAnswerSourceStatus | null;
  /** Free-text citations/references (statute, regulation, case name, firm policy doc). */
  source_refs: string[];
  /** Required when source_status === "exempted". */
  source_exemption_reason: string | null;
  /** Rationale for a not_applicable choice on a format where a decision is normally expected. */
  not_applicable_reason: string | null;
}

export const DIRECT_ANSWER_CLASSIFICATION_LABELS: Record<DirectAnswerClassification, string> = {
  binding_rule: "Binding legal rule",
  market_practice: "Market practice",
  firm_judgment: "Firm judgment",
  illustration: "Illustration",
  explanatory: "Explanatory framing",
};

/**
 * Formats where the brief must make an intentional direct-answer decision
 * (required / optional / not_applicable) before the piece is release-ready.
 * These are the long-form, reader-orientation assets the task doctrine names:
 * Counsel Note, Clause in the Margin, decision tool, checklist / landing
 * page, counsel letter, and the flagship canonical_service_page. A
 * not_applicable choice here is valid and reviewable; it is only a silent
 * omission (no decision made at all) that fails.
 */
export const DIRECT_ANSWER_DECISION_FORMATS: ReadonlySet<string> = new Set([
  "counsel_note",
  "clause_in_the_margin",
  "decision_tool",
  "counsel_letter",
  "checklist",
  "landing_page",
  "canonical_service_page",
]);

/**
 * Short, promotional, or reactive formats exempt from the formal decision
 * requirement (GBP/LinkedIn-style short posts, ad landing pages, review
 * request/response). Mirrors the same three formats content-validators.ts's
 * validateSourceIntegrity already exempts from its decision-brief
 * requirement (NO_DECISION_BRIEF_FORMATS), for the same underlying reason:
 * these formats are not reader-orientation assets. A piece in this set that
 * never sets direct_answer is not flagged at all; one that does is validated
 * to the same quality bar as any other applicability=required/optional case.
 */
export const DIRECT_ANSWER_EXEMPT_FORMATS: ReadonlySet<string> = new Set([
  "paid_traffic_landing",
  "review_request",
  "review_response",
]);

export function isDirectAnswerDecisionExpected(format: string | null | undefined): boolean {
  return !!format && DIRECT_ANSWER_DECISION_FORMATS.has(format);
}

/**
 * Defensive parse from a JSONB value of unknown shape (source_brief or
 * seo_metadata field) into a DirectAnswerMetadata, or null when absent or
 * malformed. Never throws: a corrupted or partially-authored value degrades
 * to "no decision on file" rather than breaking validation or rendering.
 */
export function parseDirectAnswerMetadata(raw: unknown): DirectAnswerMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const applicability = obj.applicability;
  if (applicability !== "required" && applicability !== "optional" && applicability !== "not_applicable") {
    return null;
  }
  const classification = obj.classification;
  const validClassification =
    classification === "binding_rule" ||
    classification === "market_practice" ||
    classification === "firm_judgment" ||
    classification === "illustration" ||
    classification === "explanatory"
      ? classification
      : null;
  const sourceStatus = obj.source_status;
  const validSourceStatus =
    sourceStatus === "mapped" || sourceStatus === "not_required" || sourceStatus === "exempted"
      ? sourceStatus
      : null;
  const sourceRefs = Array.isArray(obj.source_refs)
    ? obj.source_refs.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    : [];

  return {
    applicability,
    text: typeof obj.text === "string" && obj.text.trim().length > 0 ? obj.text.trim() : null,
    classification: validClassification,
    jurisdiction_scope:
      typeof obj.jurisdiction_scope === "string" && obj.jurisdiction_scope.trim().length > 0
        ? obj.jurisdiction_scope.trim()
        : null,
    source_status: validSourceStatus,
    source_refs: sourceRefs,
    source_exemption_reason:
      typeof obj.source_exemption_reason === "string" && obj.source_exemption_reason.trim().length > 0
        ? obj.source_exemption_reason.trim()
        : null,
    not_applicable_reason:
      typeof obj.not_applicable_reason === "string" && obj.not_applicable_reason.trim().length > 0
        ? obj.not_applicable_reason.trim()
        : null,
  };
}

/** Rough sentence count for the "1-3 concise sentences" rule. Heuristic, not grammar-aware. */
export function countSentences(text: string): number {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}
