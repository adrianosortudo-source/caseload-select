import { createHash } from "node:crypto";
import { isWithinAgencyFollowupWindow, type AgencyFollowupSchedulePolicy } from "./agency-followup-schedule";

export type AgencyContactability =
  | "allowed"
  | "hold"
  | "dnd"
  | "unsubscribed"
  | "bounced"
  | "complaint"
  | "unknown";

export type AgencyConversationStatus =
  | "not_contacted"
  | "awaiting_reply"
  | "replied"
  | "unreachable"
  | "declined"
  | "meeting_scheduled"
  | "completed";

export interface AgencyFollowupRecipientSnapshot {
  prospectId: string;
  firmName: string;
  contactName: string | null;
  contactEmail: string;
}

export interface AgencyFollowupMessageContent {
  channel: "email";
  subject: string;
  body: string;
}

export interface AgencyFollowupApprovalSnapshot {
  approvedContentHash: string;
  approvedRecipientHash: string;
  reviewerId: string;
  reviewedAt: string;
}

export interface AgencyFollowupSendContext {
  prospectId: string;
  prospectStage: string;
  recipient: AgencyFollowupRecipientSnapshot;
  contactability: AgencyContactability;
  conversationStatus: AgencyConversationStatus;
  eligibility: "eligible" | "ineligible" | "pending" | "unknown";
  eligibilityEvidenceRef: string | null;
  sequenceReleased: boolean;
  messageApproved: boolean;
  approval: AgencyFollowupApprovalSnapshot | null;
  content: AgencyFollowupMessageContent;
  dueAt: string;
  now: string;
  previousAcceptedAt: string | null;
  minimumSpacingMs: number;
  schedulePolicy?: AgencyFollowupSchedulePolicy;
  cancelled: boolean;
};

export type AgencyFollowupBlockReason =
  | "prospect_mismatch"
  | "recipient_identity_missing"
  | "recipient_email_invalid"
  | "eligibility_pending"
  | "eligibility_unknown"
  | "eligibility_not_approved"
  | "eligibility_evidence_missing"
  | "contactability_unknown"
  | "contactability_blocked"
  | "conversation_stopped"
  | "prospect_status_stopped"
  | "sequence_not_released"
  | "message_not_approved"
  | "approval_missing"
  | "approval_invalid_reviewer_or_time"
  | "approval_stale_content"
  | "approval_stale_recipient"
  | "cancelled"
  | "invalid_schedule"
  | "not_due"
  | "minimum_spacing_not_elapsed"
  | "outside_send_window";

const STOPPED_CONVERSATION_STATUSES = new Set<AgencyConversationStatus>([
  "replied",
  "unreachable",
  "declined",
  "meeting_scheduled",
  "completed",
]);
const STOPPED_PROSPECT_STAGES = new Set(["won", "lost"]);
const SHA256_RE = /^[a-f0-9]{64}$/;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function agencyFollowupContentHash(content: AgencyFollowupMessageContent): string {
  return sha256({
    channel: content.channel,
    subject: normalizeWhitespace(content.subject),
    body: content.body.replace(/\r\n/g, "\n").trim(),
  });
}

export function agencyFollowupRecipientHash(recipient: AgencyFollowupRecipientSnapshot): string {
  return sha256({
    prospectId: recipient.prospectId.trim().toLowerCase(),
    firmName: normalizeWhitespace(recipient.firmName).toLowerCase(),
    contactName: recipient.contactName ? normalizeWhitespace(recipient.contactName).toLowerCase() : null,
    contactEmail: recipient.contactEmail.trim().toLowerCase(),
  });
}

export function agencyFollowupStepsHaveApprovedTemplates(
  stepTemplateVersionIds: readonly string[],
  approvedTemplateVersionIds: readonly string[],
): boolean {
  const approved = new Set(approvedTemplateVersionIds);
  return stepTemplateVersionIds.every((templateVersionId) => approved.has(templateVersionId));
}

export function agencyFollowupApprovalIsCurrent(
  approval: AgencyFollowupApprovalSnapshot | null,
  content: AgencyFollowupMessageContent,
  recipient: AgencyFollowupRecipientSnapshot,
): boolean {
  if (!approval || !approval.reviewerId.trim() || !Number.isFinite(Date.parse(approval.reviewedAt))) {
    return false;
  }
  return (
    SHA256_RE.test(approval.approvedContentHash) &&
    SHA256_RE.test(approval.approvedRecipientHash) &&
    approval.approvedContentHash === agencyFollowupContentHash(content) &&
    approval.approvedRecipientHash === agencyFollowupRecipientHash(recipient)
  );
}

export function evaluateAgencyFollowupSend(
  context: AgencyFollowupSendContext,
): AgencyFollowupBlockReason[] {
  const blockers: AgencyFollowupBlockReason[] = [];
  if (context.prospectId.trim() !== context.recipient.prospectId.trim()) blockers.push("prospect_mismatch");
  if (!context.recipient.prospectId.trim() || !normalizeWhitespace(context.recipient.firmName)) {
    blockers.push("recipient_identity_missing");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(context.recipient.contactEmail.trim())) {
    blockers.push("recipient_email_invalid");
  }
  if (context.eligibility === "pending") blockers.push("eligibility_pending");
  else if (context.eligibility === "unknown") blockers.push("eligibility_unknown");
  else if (context.eligibility === "ineligible") blockers.push("eligibility_not_approved");
  if (context.eligibility === "eligible" && !context.eligibilityEvidenceRef?.trim()) {
    blockers.push("eligibility_evidence_missing");
  }
  if (context.contactability === "unknown") blockers.push("contactability_unknown");
  else if (context.contactability !== "allowed") blockers.push("contactability_blocked");
  if (STOPPED_CONVERSATION_STATUSES.has(context.conversationStatus)) blockers.push("conversation_stopped");
  if (STOPPED_PROSPECT_STAGES.has(context.prospectStage)) blockers.push("prospect_status_stopped");
  if (!context.sequenceReleased) blockers.push("sequence_not_released");
  if (!context.messageApproved) blockers.push("message_not_approved");
  if (!context.approval) blockers.push("approval_missing");
  else {
    if (!context.approval.reviewerId.trim() || !Number.isFinite(Date.parse(context.approval.reviewedAt))) {
      blockers.push("approval_invalid_reviewer_or_time");
    }
    if (!SHA256_RE.test(context.approval.approvedContentHash) ||
      context.approval.approvedContentHash !== agencyFollowupContentHash(context.content)) {
      blockers.push("approval_stale_content");
    }
    if (!SHA256_RE.test(context.approval.approvedRecipientHash) ||
      context.approval.approvedRecipientHash !== agencyFollowupRecipientHash(context.recipient)) {
      blockers.push("approval_stale_recipient");
    }
  }
  if (context.cancelled) blockers.push("cancelled");

  const due = Date.parse(context.dueAt);
  const now = Date.parse(context.now);
  if (!Number.isFinite(due) || !Number.isFinite(now)) blockers.push("invalid_schedule");
  else if (due > now) blockers.push("not_due");
  if (context.schedulePolicy && Number.isFinite(now) &&
    !isWithinAgencyFollowupWindow(context.now, context.schedulePolicy)) {
    blockers.push("outside_send_window");
  }

  if (context.previousAcceptedAt !== null) {
    const previous = Date.parse(context.previousAcceptedAt);
    if (!Number.isFinite(previous) || !Number.isFinite(now) || context.minimumSpacingMs < 0) {
      blockers.push("invalid_schedule");
    } else if (now - previous < context.minimumSpacingMs) {
      blockers.push("minimum_spacing_not_elapsed");
    }
  }
  return [...new Set(blockers)];
}

export function agencyFollowupLogicalMessageKey(enrollmentId: string, messageId: string): string {
  return `agency-followup:${enrollmentId.trim()}:${messageId.trim()}`;
}

export type AgencyProviderOutcome =
  | { kind: "accepted"; providerMessageId: string; acceptedAt: string }
  | { kind: "definitive_retryable_failure"; code: string }
  | { kind: "definitive_permanent_failure"; code: string }
  | { kind: "unknown"; detail: string };

export type AgencyOutboxResolution = "accepted" | "retry_same_key" | "failed" | "quarantine_unknown";

export function resolveAgencyProviderOutcome(outcome: AgencyProviderOutcome): AgencyOutboxResolution {
  switch (outcome.kind) {
    case "accepted":
      return "accepted";
    case "definitive_retryable_failure":
      return "retry_same_key";
    case "definitive_permanent_failure":
      return "failed";
    case "unknown":
      return "quarantine_unknown";
  }
}
