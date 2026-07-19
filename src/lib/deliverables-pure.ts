/**
 * Pure helpers for the content approval system. No I/O, no Supabase. These
 * are the validators, label maps, status-machine rules, and the frozen
 * attestation copy. Unit-tested in deliverables-pure.test.ts.
 */

import type {
  ContentKind,
  DeliverableStatus,
  DeliverableActorRole,
  DeliverableAnnotation,
  DeliverableAttachment,
  DeliverableVersion,
  ApprovalRecord,
} from "./types";

export const CONTENT_KINDS: ContentKind[] = ["text", "image", "pdf"];

/**
 * Whether a deliverable-version or deliverable-comment action should also
 * email the firm's lawyers (the "client" from the operator's side of this
 * surface). Silent is the only safe default: missing, malformed, stale, or
 * legacy values must never be interpreted as consent to send.
 */
export type ClientNotificationChoice = "silent" | "notify_now";

/**
 * Fail-safe normaliser: anything other than the literal string "notify_now"
 * resolves to "silent", including undefined, null, "", "true", a stale enum
 * value from an older client build, or a client bug that omits the field
 * entirely. There is no other way to opt in to a client-facing email.
 */
export function normalizeClientNotificationChoice(value: unknown): ClientNotificationChoice {
  return value === "notify_now" ? "notify_now" : "silent";
}

export const DELIVERABLE_STATUSES: DeliverableStatus[] = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "archived",
];

export const CONTENT_KIND_LABELS: Record<ContentKind, string> = {
  text: "Text",
  image: "Image",
  pdf: "PDF",
};

export const STATUS_LABELS: Record<DeliverableStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  archived: "Archived",
};

/**
 * The statement a lawyer agrees to when approving. Frozen at sign-off time
 * into approval_records.attestation so the exact wording the signer saw is
 * preserved even if this copy later changes. Calibrated to LSO Rule 4.2-1:
 * the lawyer takes responsibility for the marketing content; no outcome
 * promises or superlatives are introduced here.
 */
export const APPROVAL_ATTESTATION =
  "I have reviewed this version. As the responsible licensee, I approve it " +
  "for use in the firm's marketing and confirm it meets my professional " +
  "obligations, including Law Society of Ontario Rule 4.2-1. This approval " +
  "applies to this version only.";

export const CHANGES_ATTESTATION =
  "I have reviewed this version and am requesting changes before it is used. " +
  "My comments describe what needs to change.";

// ─── Status machine ──────────────────────────────────────────────────────────

/**
 * Posting a new version always moves the deliverable into review. A prior
 * approval does not carry forward to a new version (version-drift guard): the
 * approval_records row for the old version remains as history, but the
 * deliverable status returns to in_review.
 */
export function statusAfterNewVersion(): DeliverableStatus {
  return "in_review";
}

export function statusAfterDecision(decision: "approved" | "changes_requested"): DeliverableStatus {
  return decision === "approved" ? "approved" : "changes_requested";
}

/**
 * Only the firm's lawyer can sign the compliance approval. An operator
 * viewing the firm portal (cross-firm session) must not be able to attest on
 * the licensee's behalf, which would defeat the purpose of the record.
 */
export function canSignOff(role: DeliverableActorRole | "operator" | "lawyer" | "client"): boolean {
  return role === "lawyer";
}

/** Anyone firm-side (operator or lawyer) may post versions and comment. */
export function canPostVersion(role: string): boolean {
  return role === "operator" || role === "lawyer";
}

// ─── Delegated publishing (Amendment No. 1 to CLS-2026-DRG-001) ───────────────

/**
 * The statement recorded when the operator publishes under a delegation grant.
 * It is deliberately NOT the licensee's first-person attestation: it says, in
 * the operator's voice, that the item was published under authority the lawyer
 * delegated, and that the lawyer retains final LSO Rule 4.2-1 responsibility.
 * Frozen into approval_records.attestation so the basis the operator acted on
 * is preserved even if this copy later changes.
 */
export const DELEGATED_PUBLISH_ATTESTATION =
  "Published by the operator under publishing authority delegated by the " +
  "firm's lawyer (Amendment No. 1 to CLS-2026-DRG-001). The content was " +
  "produced under the firm's approved content strategy and passed the Law " +
  "Society of Ontario Rule 4.2-1 compliance checks. The firm's lawyer retains " +
  "final compliance responsibility and may revoke this authority at any time.";

/**
 * Only the firm's lawyer can ENABLE or revoke a delegation. The operator can
 * never grant itself the authority; that would defeat the purpose of the
 * lawyer-controlled gate. Mirrors Section A5 of the amendment.
 */
export function canEnableDelegation(
  role: DeliverableActorRole | "operator" | "lawyer" | "client",
): boolean {
  return role === "lawyer";
}

export interface DelegationGrant {
  status: "active" | "revoked" | "expired";
  expires_at: string | null; // ISO timestamp
  scope_formats: string[];
}

/**
 * Whether the operator may publish a given format under a delegation grant.
 * True only when: the actor is the operator, a grant exists and is active, the
 * grant has not lapsed past expires_at, and the piece's format is in scope.
 * The lawyer's own sign-off path (canSignOff) is unchanged and is unaffected
 * by delegation.
 */
export function canPublishUnderDelegation(
  role: string,
  grant: DelegationGrant | null,
  format: string | null,
  now: Date = new Date(),
): boolean {
  if (role !== "operator") return false;
  if (!grant || grant.status !== "active") return false;
  if (grant.expires_at && new Date(grant.expires_at).getTime() <= now.getTime()) return false;
  if (!format) return false;
  return grant.scope_formats.includes(format);
}

// ─── Validators ──────────────────────────────────────────────────────────────

export function isValidContentKind(value: unknown): value is ContentKind {
  return typeof value === "string" && (CONTENT_KINDS as string[]).includes(value);
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const NOTE_MAX = 2000;
const COMMENT_MAX = 5000;

export function cleanTitle(raw: unknown): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, TITLE_MAX);
}

export function cleanDescription(raw: unknown): string | null {
  const v = String(raw ?? "").trim().slice(0, DESCRIPTION_MAX);
  return v.length > 0 ? v : null;
}

export function cleanNote(raw: unknown): string | null {
  const v = String(raw ?? "").trim().slice(0, NOTE_MAX);
  return v.length > 0 ? v : null;
}

/**
 * Comment body: collapse runaway blank lines, cap length. Returns "" when the
 * input is empty after trimming (caller rejects empty unless an annotation
 * carries the meaning).
 */
export function cleanCommentBody(raw: unknown): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, COMMENT_MAX);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Validate and normalise an annotation from an untrusted request body.
 * Returns a clean annotation or null (null = treat as a general comment).
 * Coordinates are clamped to 0..1; text offsets are coerced to non-negative
 * integers; the quote is length-capped.
 */
export function validateAnnotation(raw: unknown): DeliverableAnnotation | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;

  switch (a.type) {
    case "text": {
      if (!isFiniteNumber(a.start) || !isFiniteNumber(a.end)) return null;
      const start = Math.max(0, Math.floor(a.start));
      const end = Math.floor(a.end);
      if (end <= start) return null;
      const quote = typeof a.quote === "string" ? a.quote.slice(0, 1000) : "";
      if (!quote) return null;
      return { type: "text", start, end, quote };
    }
    case "pin": {
      if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y)) return null;
      return { type: "pin", x: clamp01(a.x), y: clamp01(a.y) };
    }
    case "region": {
      if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y) || !isFiniteNumber(a.w) || !isFiniteNumber(a.h)) {
        return null;
      }
      return {
        type: "region",
        x: clamp01(a.x),
        y: clamp01(a.y),
        w: clamp01(a.w),
        h: clamp01(a.h),
      };
    }
    case "page": {
      if (!isFiniteNumber(a.page)) return null;
      const page = Math.max(1, Math.floor(a.page));
      return { type: "page", page };
    }
    case "image": {
      if (typeof a.src !== "string") return null;
      // Only allow https: (Supabase signed URLs) or root-relative paths.
      // A javascript: URI stored and later rendered would be stored XSS.
      if (!a.src.startsWith("https://") && !a.src.startsWith("/")) return null;
      const src = a.src.slice(0, 2000);
      const alt = typeof a.alt === "string" ? a.alt.slice(0, 200) : undefined;
      return { type: "image", src, alt };
    }
    case "field": {
      if (a.field !== "title" && a.field !== "excerpt") return null;
      const quote = typeof a.quote === "string" ? a.quote.slice(0, 1000) : "";
      if (!quote) return null;
      return { type: "field", field: a.field, quote };
    }
    default:
      return null;
  }
}

const ATTACHMENT_MAX_COUNT = 5;
const ATTACHMENT_NAME_MAX = 200;

/**
 * Validate and normalise a list of feedback attachments from an untrusted
 * request body (a change-request note or a reply on the record). Returns
 * null when the input is malformed (caller responds 400); an empty array is
 * valid (no attachments). Each storage_path must live under this
 * deliverable's own feedback prefix so a request cannot reference another
 * deliverable's, or another firm's, uploaded file.
 */
export function validateDeliverableAttachments(
  raw: unknown,
  firmId: string,
  deliverableId: string,
): DeliverableAttachment[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  if (raw.length > ATTACHMENT_MAX_COUNT) return null;

  const prefix = `deliverables/${firmId}/${deliverableId}/feedback/`;
  const cleaned: DeliverableAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const a = item as Record<string, unknown>;
    if (typeof a.storage_path !== "string" || !a.storage_path.startsWith(prefix)) return null;
    if (typeof a.name !== "string" || a.name.trim().length === 0) return null;
    const size = isFiniteNumber(a.size) ? a.size : undefined;
    const mime = typeof a.mime === "string" ? a.mime.slice(0, 100) : undefined;
    cleaned.push({
      storage_path: a.storage_path,
      name: a.name.trim().slice(0, ATTACHMENT_NAME_MAX),
      ...(size !== undefined ? { size } : {}),
      ...(mime !== undefined ? { mime } : {}),
    });
  }
  return cleaned;
}

/** Short human label for an annotation, used in lists + the comment card. */
export function annotationLabel(annotation: DeliverableAnnotation | null): string {
  if (!annotation) return "General comment";
  switch (annotation.type) {
    case "text":
      return "On a passage";
    case "pin":
      return "Pinned on the image";
    case "region":
      return "On a region";
    case "page":
      return `On page ${annotation.page}`;
    case "image":
      return annotation.alt ? `On image: ${annotation.alt.slice(0, 40)}` : "On an inline image";
    case "field":
      return annotation.field === "title" ? "On the title" : "On the lead";
  }
}

/** Count of unresolved comments in a list. */
export function openCommentCount(
  comments: { resolved: boolean }[],
): number {
  return comments.filter((c) => !c.resolved).length;
}

// ─── Version state labels ────────────────────────────────────────────────────

export type VersionOptionTag = "awaiting_review" | "approved" | "changes_requested" | null;

export interface VersionOptionState {
  isCurrent: boolean;
  tag: VersionOptionTag;
  /** ISO timestamp of the matching approval record; present when tag is approved/changes_requested. */
  approvalCreatedAt: string | null;
}

/**
 * State for one entry in the version picker. A version can carry at most one
 * approval_records row (sign-off targets only the current version, so once a
 * version is superseded it can never receive a later decision). The caller
 * formats approvalCreatedAt (e.g. via formatTimestamp) and builds the final
 * label string; this stays pure so it is cheaply unit-testable.
 */
export function versionOptionLabel(
  version: Pick<DeliverableVersion, "id">,
  deliverable: { current_version_id: string | null; status: DeliverableStatus },
  approvals: Pick<ApprovalRecord, "version_id" | "decision" | "created_at">[],
): VersionOptionState {
  const isCurrent = version.id === deliverable.current_version_id;
  const matching = approvals.find((a) => a.version_id === version.id) ?? null;

  if (isCurrent && deliverable.status === "in_review") {
    return { isCurrent, tag: "awaiting_review", approvalCreatedAt: null };
  }
  if (matching?.decision === "approved") {
    return { isCurrent, tag: "approved", approvalCreatedAt: matching.created_at };
  }
  if (matching?.decision === "changes_requested") {
    return { isCurrent, tag: "changes_requested", approvalCreatedAt: matching.created_at };
  }
  return { isCurrent, tag: null, approvalCreatedAt: null };
}

// ─── Content plan grouping ───────────────────────────────────────────────────

export interface PlanDeliverable {
  id: string;
  title: string;
  kicker: string | null;
  status: DeliverableStatus;
  content_kind: ContentKind;
  format: string | null;
  period_id: string | null;
  publish_date: string | null;
}

export interface FormatGroup {
  format: string | null; // null = no format set ("Unfiled")
  items: PlanDeliverable[];
}

function comparePublishDate(a: PlanDeliverable, b: PlanDeliverable): number {
  // Dated items first (ascending); undated items sink to the end.
  if (!a.publish_date && !b.publish_date) return 0;
  if (!a.publish_date) return 1;
  if (!b.publish_date) return -1;
  return a.publish_date < b.publish_date ? -1 : a.publish_date > b.publish_date ? 1 : 0;
}

/**
 * Fixed panel order for the weekly content-plan view, editorial complexity
 * order rather than publish-date order: the reader's own long-form piece
 * first, then its lighter derivatives, in the order Adriano reviews them
 * (locked 2026-07-06). Formats not listed here (e.g. Decision Tool, Counsel
 * Letter) sink after the named ones but before the null/unfiled group.
 *
 * "DRG Law Minute" (added with the v5.2 capacity-controlled cadence model,
 * see content-cadence.ts) is pinned last among the named formats rather than
 * left to the UNKNOWN_FORMAT_RANK fallback: it is the weekly relationship
 * email, gated to send only after every other Tuesday artifact is verified
 * live, so it is reviewed last by design, not by accident of insertion
 * order. Pinning it also protects that ordering from drifting if another
 * unnamed format is introduced later and would otherwise tie with it at the
 * fallback rank.
 */
const FORMAT_PRIORITY: Record<string, number> = {
  "Counsel Note": 0,
  "LinkedIn": 1,
  "Clause in the Margin": 2,
  "Lead Magnet": 3,
  "Google Business Profile": 4,
  "DRG Law Minute": 5,
};
const UNKNOWN_FORMAT_RANK = 999;

function formatRank(format: string | null): number {
  if (format && format in FORMAT_PRIORITY) return FORMAT_PRIORITY[format];
  return UNKNOWN_FORMAT_RANK;
}

/**
 * Group deliverables by format. Items within a group stay in publish-date
 * order (dated first, ascending; undated last). Groups themselves follow the
 * fixed editorial complexity order in FORMAT_PRIORITY; formats not in that
 * list keep their first-appearance order after the known ones. Items with no
 * format collect last under a null-format group.
 */
export function groupByFormat(items: PlanDeliverable[]): FormatGroup[] {
  const sorted = [...items].sort(comparePublishDate);
  const order: (string | null)[] = [];
  const byFormat = new Map<string | null, PlanDeliverable[]>();
  for (const it of sorted) {
    const key = it.format && it.format.trim() ? it.format : null;
    if (!byFormat.has(key)) {
      byFormat.set(key, []);
      order.push(key);
    }
    byFormat.get(key)!.push(it);
  }
  order.sort((a, b) => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return formatRank(a) - formatRank(b);
  });
  return order.map((f) => ({ format: f, items: byFormat.get(f)! }));
}

/** Approval progress for a set of deliverables. */
export function planProgress(
  items: { status: DeliverableStatus }[],
): { approved: number; total: number } {
  let approved = 0;
  for (const it of items) if (it.status === "approved") approved++;
  return { approved, total: items.length };
}

export interface PlanOverview {
  total: number;
  approved: number;
  pending: number; // in_review, waiting on the firm
  changes: number; // changes_requested, back with the operator
  draft: number;
  weeks: number; // distinct weeks that hold content
  byFormat: { format: string | null; count: number }[];
  nextPublish: { date: string; title: string } | null; // soonest publish among not-yet-approved
}

/**
 * Whole-plan summary for the review-overview panel. Live counts, a format
 * tally, and the soonest publish date among pieces not yet approved (the
 * working deadline: review before it goes out).
 */
export function computeOverview(items: PlanDeliverable[]): PlanOverview {
  let approved = 0;
  let pending = 0;
  let changes = 0;
  let draft = 0;
  const weeks = new Set<string>();
  let next: { date: string; title: string } | null = null;
  for (const it of items) {
    if (it.status === "approved") approved++;
    else if (it.status === "in_review") pending++;
    else if (it.status === "changes_requested") changes++;
    else if (it.status === "draft") draft++;
    if (it.period_id) weeks.add(it.period_id);
    if (it.status !== "approved" && it.publish_date) {
      if (!next || it.publish_date < next.date) {
        next = { date: it.publish_date, title: it.title };
      }
    }
  }
  const byFormat = groupByFormat(items).map((g) => ({
    format: g.format,
    count: g.items.length,
  }));
  return {
    total: items.length,
    approved,
    pending,
    changes,
    draft,
    weeks: weeks.size,
    byFormat,
    nextPublish: next,
  };
}
