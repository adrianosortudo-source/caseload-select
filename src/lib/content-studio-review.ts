// Single source of truth for the lawyer-visible Content Studio review payload
// and the approval-identity check (Codex audit F1/F3/F8, 2026-07-07 remediation).
//
// Why this file exists: before this, three places rendered the "what the lawyer
// sees" HTML independently (legal_gate deliverable creation, send-to-review, and
// nowhere for export/publish), and the release gates (export, publish-record,
// legal_gate exit) trusted only content_deliverables.status === 'approved'.
// That let a regeneration or operator edit AFTER approval ship a content version
// the lawyer never saw, and left the export-critical SEO title/meta/JSON-LD out
// of the reviewed artifact entirely.
//
// The fix binds the approved deliverable version's stored body_html to the exact
// current content by RE-RENDERING the current EN (+ PT) versions the same way the
// deliverable was rendered, and comparing. If they differ, the release is blocked
// with "send current draft to review". Because renderReviewPayload is the ONE
// renderer used by deliverable creation, send-to-review, AND this identity check,
// the comparison is exact: same inputs produce the same bytes.
//
// No I/O, no server-only: pure functions over version rows already fetched by the
// caller, so the whole identity decision is directly unit-testable.

import {
  renderServicePagePreview,
  renderMarkdownToSafeHtml,
  type ServicePageBlock,
} from "./content-studio-structured";

export interface ReviewVersionInput {
  body_markdown: string | null;
  body_structured: unknown[] | null;
  seo_metadata: Record<string, unknown> | null;
}

export interface RenderReviewPayloadInput {
  format: string;
  languageMode: string;
  en: ReviewVersionInput | null;
  pt: ReviewVersionInput | null;
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderVersionBody(format: string, v: ReviewVersionInput): string {
  if (format === "canonical_service_page") {
    return renderServicePagePreview(
      (v.body_structured as ServicePageBlock[] | null) ?? [],
      (v.seo_metadata as Record<string, unknown> | null) ?? undefined,
    ).html;
  }
  return renderMarkdownToSafeHtml(v.body_markdown);
}

/**
 * Renders the export-critical SEO fields (title, meta description, primary
 * query, answer summary) and the JSON-LD schema @types as a readable block, so
 * the lawyer reviewing the deliverable sees exactly what will ship in the
 * export bundle's <head> and <script type="application/ld+json"> tags. F8:
 * these fields affect public search surfaces and can carry legal-service
 * claims, but were previously invisible in review.
 *
 * publish_record is deliberately excluded: it is a post-approval placement
 * record, not export-critical SEO, and it is stamped onto the current version
 * AFTER the identity check runs, so including it would make the payload
 * non-deterministic across the publish-record write.
 */
export function renderSeoSummary(seoMetadata: Record<string, unknown> | null | undefined): string {
  if (!seoMetadata || typeof seoMetadata !== "object") return "";

  const rows: Array<[string, string]> = [];
  const push = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim().length > 0) {
      rows.push([label, value.trim()]);
    }
  };
  push("Title", seoMetadata.title);
  push("Meta description", seoMetadata.meta_description);
  push("Primary query", seoMetadata.primary_query);
  push("Answer summary", seoMetadata.answer_summary);

  const schema = (seoMetadata.schema as Record<string, unknown> | undefined) ?? {};
  const types: string[] = [];
  for (const value of Object.values(schema)) {
    if (value && typeof value === "object") {
      const t = (value as Record<string, unknown>)["@type"];
      if (typeof t === "string" && t.trim()) types.push(t.trim());
    }
  }

  const stale = seoMetadata.schema_stale === true;

  if (rows.length === 0 && types.length === 0 && !stale) return "";

  const dl = rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
  const schemaLine =
    types.length > 0
      ? `<dt>Structured data (JSON-LD)</dt><dd>${escapeHtml(types.join(", "))}</dd>`
      : "";
  const staleLine = stale
    ? `<p class="cls-review-seo-stale">Note: the structured data (JSON-LD/schema) was NOT recomputed after the last edit and may not match the edited body. Regenerate before export.</p>`
    : "";

  return (
    `<section class="cls-review-seo">` +
    `<h3>SEO metadata (ships in the export, not shown in the page body above)</h3>` +
    `<dl>${dl}${schemaLine}</dl>` +
    staleLine +
    `</section>`
  );
}

/**
 * The ONE renderer for the lawyer-visible review artifact. Used by:
 *   - legal_gate deliverable creation (pieces/[id]/route.ts)
 *   - send-to-review (posts a new deliverable version)
 *   - evaluateApprovalIdentity (re-renders current content to compare)
 * so a byte-for-byte comparison against the approved deliverable version's
 * body_html is meaningful.
 */
export function renderReviewPayload(input: RenderReviewPayloadInput): string {
  const parts: string[] = [];

  if (input.en) {
    parts.push(renderVersionBody(input.format, input.en));
    const summary = renderSeoSummary(input.en.seo_metadata);
    if (summary) parts.push(summary);
  }

  if (input.languageMode === "bilingual" && input.pt) {
    parts.push("<hr>");
    parts.push("<h2>Portuguese version</h2>");
    parts.push(renderVersionBody(input.format, input.pt));
    const ptSummary = renderSeoSummary(input.pt.seo_metadata);
    if (ptSummary) parts.push(ptSummary);
  }

  return parts.join("\n");
}

// Whitespace between tags is not semantically significant here and can differ
// by a newline vs a space depending on how the payload was assembled, so both
// sides are collapsed before comparison. Text content differences (the thing
// we actually care about) survive this normalization.
function normalize(html: string): string {
  return html.replace(/\s+/g, " ").trim();
}

export interface ApprovalIdentityInput {
  format: string;
  languageMode: string;
  /** deliverable_versions.body_html of the deliverable's approved_version_id. */
  approvedBodyHtml: string | null;
  en: ReviewVersionInput | null;
  pt: ReviewVersionInput | null;
}

/**
 * Pure decision: does the CURRENT content (EN + PT for bilingual) still match
 * the lawyer-approved deliverable version body? Blocks export / publish-record
 * / legal_gate exit when it does not.
 *
 * The I/O wrapper (checkApprovalIdentity in content-studio.ts) handles the
 * delegation bypass and the DB reads, then calls this with plain values.
 */
export function evaluateApprovalIdentity(
  input: ApprovalIdentityInput,
): { ok: true } | { ok: false; reason: string; code: string } {
  if (input.approvedBodyHtml == null) {
    return {
      ok: false,
      code: "approval_snapshot_missing",
      reason:
        "No lawyer-approved version is on file for this piece. Advance to legal_gate, send the current draft to review, and obtain sign-off before export or publish.",
    };
  }

  const current = renderReviewPayload({
    format: input.format,
    languageMode: input.languageMode,
    en: input.en,
    pt: input.pt,
  });

  if (normalize(current) === normalize(input.approvedBodyHtml)) {
    return { ok: true };
  }

  return {
    ok: false,
    code: "approval_stale",
    reason:
      "The current draft differs from the version the firm's lawyer approved (it was edited, regenerated, or a Portuguese version was added or changed after sign-off). Use “Send current draft to review” and obtain a fresh approval before export or publish.",
  };
}
