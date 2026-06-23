/**
 * I/O wrapper for the content approval system.
 *
 * Owns content_deliverables + deliverable_versions + deliverable_comments +
 * approval_records, plus the firm-files storage objects for image/pdf assets
 * (stored under a deliverables/ prefix, signed at read time). Routes call into
 * here; the UI never touches Supabase directly.
 *
 * Every approval writes an append-only approval_records row (the LSO 4.2-1
 * compliance artifact). Comments anchor to a specific version_id so a sign-off
 * can never be mistaken for approval of a later revision.
 */

import "server-only";
import { randomUUID } from "crypto";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import type {
  ContentDeliverable,
  DeliverableVersion,
  DeliverableComment,
  ApprovalRecord,
  ContentKind,
  DeliverableActorRole,
  DeliverableAnnotation,
  ApprovalDecision,
} from "@/lib/types";
import { statusAfterNewVersion, statusAfterDecision } from "@/lib/deliverables-pure";

const ASSET_BUCKET = "firm-files";
const SIGNED_URL_TTL = 3600; // 1 hour; review pages stay open a while
const APP_BASE = "https://app.caseloadselect.ca";
const OPERATOR_EMAIL =
  process.env.OPERATOR_NOTIFICATION_EMAIL || "adriano@caseloadselect.ca";

export interface DeliverableActor {
  role: DeliverableActorRole;
  id?: string | null;
  name?: string | null;
  email?: string | null;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function listDeliverables(
  firmId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Array<ContentDeliverable & { open_comments: number; version_count: number }>> {
  let query = supabase
    .from("content_deliverables")
    .select("*")
    .eq("firm_id", firmId)
    .order("updated_at", { ascending: false });

  if (!options.includeArchived) query = query.neq("status", "archived");

  const { data, error } = await query;
  if (error) throw new Error(`listDeliverables failed: ${error.message}`);
  const rows = (data ?? []) as ContentDeliverable[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);

  // Open-comment counts + version counts in two grouped reads.
  const [{ data: comments }, { data: versions }] = await Promise.all([
    supabase
      .from("deliverable_comments")
      .select("deliverable_id, resolved")
      .in("deliverable_id", ids)
      .eq("resolved", false),
    supabase
      .from("deliverable_versions")
      .select("deliverable_id")
      .in("deliverable_id", ids),
  ]);

  const openByDeliverable = new Map<string, number>();
  for (const c of comments ?? []) {
    openByDeliverable.set(c.deliverable_id, (openByDeliverable.get(c.deliverable_id) ?? 0) + 1);
  }
  const versionsByDeliverable = new Map<string, number>();
  for (const v of versions ?? []) {
    versionsByDeliverable.set(v.deliverable_id, (versionsByDeliverable.get(v.deliverable_id) ?? 0) + 1);
  }

  return rows.map((r) => ({
    ...r,
    open_comments: openByDeliverable.get(r.id) ?? 0,
    version_count: versionsByDeliverable.get(r.id) ?? 0,
  }));
}

export interface DeliverableDetail {
  deliverable: ContentDeliverable;
  versions: DeliverableVersion[]; // newest first, assets signed
  comments: DeliverableComment[]; // chronological
  approvals: ApprovalRecord[]; // newest first
}

export async function getDeliverableDetail(
  deliverableId: string,
): Promise<DeliverableDetail | null> {
  const { data: deliverable } = await supabase
    .from("content_deliverables")
    .select("*")
    .eq("id", deliverableId)
    .maybeSingle();
  if (!deliverable) return null;

  const [{ data: versions }, { data: comments }, { data: approvals }] = await Promise.all([
    supabase
      .from("deliverable_versions")
      .select("*")
      .eq("deliverable_id", deliverableId)
      .order("version_number", { ascending: false }),
    supabase
      .from("deliverable_comments")
      .select("*")
      .eq("deliverable_id", deliverableId)
      .order("created_at", { ascending: true }),
    supabase
      .from("approval_records")
      .select("*")
      .eq("deliverable_id", deliverableId)
      .order("created_at", { ascending: false }),
  ]);

  const signedVersions = await signVersionAssets((versions ?? []) as DeliverableVersion[]);

  return {
    deliverable: deliverable as ContentDeliverable,
    versions: signedVersions,
    comments: (comments ?? []) as DeliverableComment[],
    approvals: (approvals ?? []) as ApprovalRecord[],
  };
}

async function signVersionAssets(
  versions: DeliverableVersion[],
): Promise<DeliverableVersion[]> {
  return Promise.all(
    versions.map(async (v) => {
      if (!v.storage_path) return v;
      const { data } = await supabase.storage
        .from(ASSET_BUCKET)
        .createSignedUrl(v.storage_path, SIGNED_URL_TTL);
      return { ...v, signed_url: data?.signedUrl ?? undefined };
    }),
  );
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createDeliverable(input: {
  firmId: string;
  title: string;
  description: string | null;
  contentKind: ContentKind;
  actor: DeliverableActor;
}): Promise<{ ok: true; deliverable: ContentDeliverable } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("content_deliverables")
    .insert({
      firm_id: input.firmId,
      title: input.title,
      description: input.description,
      content_kind: input.contentKind,
      status: "draft",
      created_by_role: input.actor.role,
      created_by_id: input.actor.id ?? null,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: `create failed: ${error.message}` };
  return { ok: true, deliverable: data as ContentDeliverable };
}

/**
 * Upload an image/pdf asset for a version into firm-files storage. Returns the
 * storage_path. The version row is inserted separately via addVersion.
 */
export async function uploadDeliverableAsset(input: {
  firmId: string;
  deliverableId: string;
  buffer: Buffer;
  contentType: string;
  filename: string;
}): Promise<{ ok: true; storagePath: string } | { ok: false; error: string }> {
  const safe = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  const storagePath = `deliverables/${input.firmId}/${input.deliverableId}/${randomUUID()}-${safe}`;
  const { error } = await supabase.storage
    .from(ASSET_BUCKET)
    .upload(storagePath, input.buffer, { contentType: input.contentType, upsert: false });
  if (error) return { ok: false, error: `asset upload failed: ${error.message}` };
  return { ok: true, storagePath };
}

/**
 * Insert a new version, bump the version number, point the deliverable at it,
 * and return the deliverable to in_review. Best-effort notification to the
 * firm's lawyers that a version is ready for review.
 */
export async function addVersion(input: {
  deliverableId: string;
  firmId: string;
  bodyHtml: string | null;
  storagePath: string | null;
  assetMime: string | null;
  assetSizeBytes: number | null;
  assetName: string | null;
  note: string | null;
  actor: DeliverableActor;
}): Promise<{ ok: true; version: DeliverableVersion } | { ok: false; error: string }> {
  // Next version number.
  const { data: last } = await supabase
    .from("deliverable_versions")
    .select("version_number")
    .eq("deliverable_id", input.deliverableId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNumber = (last?.version_number ?? 0) + 1;

  const { data: inserted, error: insertErr } = await supabase
    .from("deliverable_versions")
    .insert({
      deliverable_id: input.deliverableId,
      firm_id: input.firmId,
      version_number: nextNumber,
      body_html: input.bodyHtml,
      storage_path: input.storagePath,
      asset_mime: input.assetMime,
      asset_size_bytes: input.assetSizeBytes,
      asset_name: input.assetName,
      note: input.note,
      created_by_role: input.actor.role,
      created_by_id: input.actor.id ?? null,
    })
    .select("*")
    .single();
  if (insertErr) return { ok: false, error: `version insert failed: ${insertErr.message}` };

  const version = inserted as DeliverableVersion;

  // Point the deliverable at the new version, return it to review, clear any
  // stale approval pointer (the prior approval stays in approval_records).
  await supabase
    .from("content_deliverables")
    .update({
      current_version_id: version.id,
      status: statusAfterNewVersion(),
      approved_version_id: null,
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.deliverableId);

  await enqueueDeliverableNotification({
    firmId: input.firmId,
    deliverableId: input.deliverableId,
    eventType: "deliverable_review_requested",
    audience: "firm",
    actor: input.actor,
    bodyPreview: `Version ${nextNumber} is ready for your review.`,
  }).catch((e) => console.warn("[deliverables] notify failed:", e));

  return { ok: true, version };
}

export async function addComment(input: {
  deliverableId: string;
  versionId: string;
  firmId: string;
  annotation: DeliverableAnnotation | null;
  body: string;
  parentCommentId: string | null;
  actor: DeliverableActor;
}): Promise<{ ok: true; comment: DeliverableComment } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("deliverable_comments")
    .insert({
      deliverable_id: input.deliverableId,
      version_id: input.versionId,
      firm_id: input.firmId,
      author_role: input.actor.role,
      author_id: input.actor.id ?? null,
      author_name: input.actor.name ?? null,
      annotation: input.annotation,
      body: input.body,
      parent_comment_id: input.parentCommentId,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: `comment insert failed: ${error.message}` };

  // A comment from the operator pings the firm; a comment from the lawyer
  // pings the operator inbox.
  await enqueueDeliverableNotification({
    firmId: input.firmId,
    deliverableId: input.deliverableId,
    eventType: "deliverable_comment_added",
    audience: input.actor.role === "operator" ? "firm" : "operator",
    actor: input.actor,
    bodyPreview: input.body.slice(0, 240),
  }).catch((e) => console.warn("[deliverables] notify failed:", e));

  return { ok: true, comment: data as DeliverableComment };
}

export async function setCommentResolved(input: {
  commentId: string;
  firmId: string;
  resolved: boolean;
  actorRole: DeliverableActorRole;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("deliverable_comments")
    .update({
      resolved: input.resolved,
      resolved_at: input.resolved ? new Date().toISOString() : null,
      resolved_by_role: input.resolved ? input.actorRole : null,
    })
    .eq("id", input.commentId)
    .eq("firm_id", input.firmId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Record a sign-off decision. Append-only: every decision writes a new
 * approval_records row, freezing the attestation copy, version number, title,
 * signer identity, IP, and user agent. Then the deliverable status is updated.
 */
export async function recordApproval(input: {
  deliverableId: string;
  versionId: string;
  versionNumber: number;
  firmId: string;
  deliverableTitle: string;
  decision: ApprovalDecision;
  attestation: string;
  signer: { id?: string | null; name: string; email: string };
  ipAddress: string | null;
  userAgent: string | null;
  note: string | null;
}): Promise<{ ok: true; record: ApprovalRecord } | { ok: false; error: string; stale?: boolean }> {
  const approved = input.decision === "approved";
  const now = new Date().toISOString();

  // Close the version-drift TOCTOU: apply the status change ONLY while the
  // signed version is still the current one. The route pre-checks this, but a
  // new version posted between that check and here would otherwise let a
  // sign-off land on a stale version. The conditional update is the real gate;
  // if zero rows match, a newer version exists and we reject as stale without
  // recording an approval against the superseded version.
  const { data: updatedRows, error: updErr } = await supabase
    .from("content_deliverables")
    .update({
      status: statusAfterDecision(input.decision),
      approved_version_id: approved ? input.versionId : null,
      approved_at: approved ? now : null,
      updated_at: now,
    })
    .eq("id", input.deliverableId)
    .eq("current_version_id", input.versionId)
    .select("id");
  if (updErr) return { ok: false, error: `approval update failed: ${updErr.message}` };
  if (!updatedRows || updatedRows.length === 0) {
    return {
      ok: false,
      stale: true,
      error: "a newer version exists; refresh and sign the current version",
    };
  }

  // Append the immutable approval record. If this fails after the status moved,
  // best-effort revert the deliverable to in_review so status and the
  // append-only log stay consistent.
  const { data, error } = await supabase
    .from("approval_records")
    .insert({
      deliverable_id: input.deliverableId,
      version_id: input.versionId,
      firm_id: input.firmId,
      decision: input.decision,
      signer_role: "lawyer",
      signer_id: input.signer.id ?? null,
      signer_name: input.signer.name,
      signer_email: input.signer.email,
      attestation: input.attestation,
      version_number: input.versionNumber,
      deliverable_title: input.deliverableTitle,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      note: input.note,
    })
    .select("*")
    .single();
  if (error) {
    await supabase
      .from("content_deliverables")
      .update({ status: "in_review", approved_version_id: null, approved_at: null, updated_at: new Date().toISOString() })
      .eq("id", input.deliverableId);
    return { ok: false, error: `approval insert failed: ${error.message}` };
  }

  await enqueueDeliverableNotification({
    firmId: input.firmId,
    deliverableId: input.deliverableId,
    eventType: approved ? "deliverable_approved" : "deliverable_changes_requested",
    audience: "operator",
    actor: { role: "lawyer", name: input.signer.name },
    bodyPreview: approved
      ? `${input.signer.name} approved version ${input.versionNumber}.`
      : `${input.signer.name} requested changes to version ${input.versionNumber}.`,
  }).catch((e) => console.warn("[deliverables] notify failed:", e));

  return { ok: true, record: data as ApprovalRecord };
}

export async function archiveDeliverable(input: {
  deliverableId: string;
  firmId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("content_deliverables")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", input.deliverableId)
    .eq("firm_id", input.firmId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ─── Notifications ───────────────────────────────────────────────────────────

async function enqueueDeliverableNotification(input: {
  firmId: string;
  deliverableId: string;
  eventType:
    | "deliverable_review_requested"
    | "deliverable_comment_added"
    | "deliverable_approved"
    | "deliverable_changes_requested";
  audience: "firm" | "operator";
  actor: DeliverableActor;
  bodyPreview: string;
}): Promise<void> {
  const recipients = new Set<string>();

  if (input.audience === "operator") {
    recipients.add(OPERATOR_EMAIL);
  } else {
    const { data: lawyers } = await supabase
      .from("firm_lawyers")
      .select("email, email_notifications_enabled, disabled")
      .eq("firm_id", input.firmId);
    for (const l of lawyers ?? []) {
      if (l.email && l.email_notifications_enabled !== false && l.disabled !== true) {
        recipients.add(l.email);
      }
    }
  }
  if (recipients.size === 0) return;

  // Title for the digest section + the deep link.
  const { data: deliverable } = await supabase
    .from("content_deliverables")
    .select("title")
    .eq("id", input.deliverableId)
    .maybeSingle();

  const url = `${APP_BASE}/portal/${input.firmId}/deliverables/${input.deliverableId}`;
  const rows = Array.from(recipients).map((email) => ({
    recipient_email: email,
    firm_id: input.firmId,
    matter_id: null,
    event_type: input.eventType,
    event_payload: {
      deliverable_id: input.deliverableId,
      deliverable_title: deliverable?.title ?? "a deliverable",
      deliverable_url: url,
      actor_role: input.actor.role,
      body: input.bodyPreview,
      body_preview: input.bodyPreview.slice(0, 240),
    },
  }));

  await supabase.from("notification_outbox").insert(rows);
}
