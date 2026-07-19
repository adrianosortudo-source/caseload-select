/**
 * POST /api/portal/[firmId]/deliverables/[deliverableId]/comments
 *
 * Add a comment anchored to a specific version. The annotation (text passage,
 * image pin/region, or PDF page) is optional; a null annotation is a general
 * comment on the version. Operator or firm-lawyer session.
 *
 * When approval_record_id is set, this is a reply on a change-request thread
 * rather than a passage comment: version_id and annotation are forced
 * server-side (never trusted from the client) to the record's own version and
 * null respectively.
 *
 * Body: { version_id, body, annotation?, parent_comment_id?, approval_record_id?, attachments?, client_notification_choice? }
 *
 * client_notification_choice ("silent" | "notify_now") only applies when the
 * poster is an operator (the comment then emails the firm's lawyers).
 * Missing, invalid, or omitted resolves to "silent" (fail-safe). A
 * lawyer/client-authored comment always notifies the operator, unchanged,
 * regardless of this field.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { getDeliverableDetail, addComment } from "@/lib/deliverables";
import {
  cleanCommentBody,
  validateAnnotation,
  validateDeliverableAttachments,
  normalizeClientNotificationChoice,
} from "@/lib/deliverables-pure";
import { postDeliverableCommentToChannel } from "@/lib/deliverable-channel-post";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  let body: {
    version_id?: unknown;
    body?: unknown;
    annotation?: unknown;
    parent_comment_id?: unknown;
    approval_record_id?: unknown;
    attachments?: unknown;
    client_notification_choice?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // A reply on an approval record: resolve the record first so version_id and
  // annotation can be forced to its own values rather than trusted from the
  // client.
  const approvalRecordId =
    typeof body.approval_record_id === "string" ? body.approval_record_id : null;
  const approvalRecord = approvalRecordId
    ? (detail.approvals.find((a) => a.id === approvalRecordId) ?? null)
    : null;
  if (approvalRecordId && !approvalRecord) {
    return NextResponse.json(
      { error: "approval_record_id not found in this deliverable" },
      { status: 400 },
    );
  }

  const versionId = approvalRecord
    ? approvalRecord.version_id
    : typeof body.version_id === "string"
      ? body.version_id
      : null;
  if (!versionId || !detail.versions.some((v) => v.id === versionId)) {
    return NextResponse.json({ error: "valid version_id is required" }, { status: 400 });
  }

  const cleanBody = cleanCommentBody(body.body);
  if (!cleanBody) {
    return NextResponse.json({ error: "comment body is required" }, { status: 400 });
  }

  const annotation = approvalRecord ? null : validateAnnotation(body.annotation);
  const parentId =
    typeof body.parent_comment_id === "string" ? body.parent_comment_id : null;
  if (parentId && !detail.comments.some((c) => c.id === parentId)) {
    return NextResponse.json(
      { error: "parent_comment_id not found in this deliverable" },
      { status: 400 },
    );
  }

  const attachments = validateDeliverableAttachments(body.attachments, firmId, deliverableId);
  if (attachments === null) {
    return NextResponse.json({ error: "invalid attachments" }, { status: 400 });
  }

  const clientNotificationChoice = normalizeClientNotificationChoice(body.client_notification_choice);

  const result = await addComment({
    deliverableId,
    versionId,
    firmId,
    annotation,
    body: cleanBody,
    parentCommentId: parentId,
    actor: resolved.actor,
    approvalRecordId,
    attachments,
    clientNotificationChoice,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  // Fan the comment into the CaseLoad Connect channel (best-effort, never
  // blocks the comment). Carries a deep-link context back to this comment.
  // Always fires regardless of the client-notification choice: it sets
  // suppressNotification internally, so it never independently emails
  // anyone, it only makes the activity visible in the portal.
  await postDeliverableCommentToChannel({
    firmId,
    deliverableId,
    deliverableTitle: detail.deliverable.title ?? "a deliverable",
    comment: result.comment,
    actor: resolved.actor,
  }).catch((e) => console.warn("[deliverables/comments] channel post failed:", e));

  return NextResponse.json({ ok: true, comment: result.comment, notification: result.notification });
}
