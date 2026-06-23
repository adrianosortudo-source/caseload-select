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
} from "./types";

export const CONTENT_KINDS: ContentKind[] = ["text", "image", "pdf"];

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
      const end = Math.max(start, Math.floor(a.end));
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
    default:
      return null;
  }
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
  }
}

/** Count of unresolved comments in a list. */
export function openCommentCount(
  comments: { resolved: boolean }[],
): number {
  return comments.filter((c) => !c.resolved).length;
}
