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
  ContentPeriod,
  ContentPlanSettings,
  DeliverableVersion,
  DeliverableComment,
  ApprovalRecord,
  ContentKind,
  DeliverableActorRole,
  DeliverableAnnotation,
  ApprovalDecision,
} from "@/lib/types";
import {
  statusAfterNewVersion,
  statusAfterDecision,
  type PlanDeliverable,
} from "@/lib/deliverables-pure";

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

// ─── Content plan (weekly periods + format grouping) ─────────────────────────

export interface ContentPlanData {
  periods: ContentPeriod[];        // newest week first
  deliverables: PlanDeliverable[]; // light rows for grouping client-side
  settings: ContentPlanSettings | null; // operator batch note + custom deadline
}

export async function getContentPlan(
  firmId: string,
  options: { includeArchived?: boolean } = {},
): Promise<ContentPlanData> {
  let dq = supabase
    .from("content_deliverables")
    .select("id, title, kicker, status, content_kind, format, period_id, publish_date")
    .eq("firm_id", firmId);
  if (!options.includeArchived) dq = dq.neq("status", "archived");

  const [periodsRes, delivRes, settingsRes] = await Promise.all([
    supabase
      .from("content_periods")
      .select("*")
      .eq("firm_id", firmId)
      .order("starts_on", { ascending: false })
      .order("sort_index", { ascending: false }),
    dq,
    supabase.from("content_plan_settings").select("*").eq("firm_id", firmId).maybeSingle(),
  ]);
  if (periodsRes.error) throw new Error(`periods load failed: ${periodsRes.error.message}`);
  if (delivRes.error) throw new Error(`plan deliverables load failed: ${delivRes.error.message}`);

  return {
    periods: (periodsRes.data ?? []) as ContentPeriod[],
    deliverables: (delivRes.data ?? []) as PlanDeliverable[],
    settings: (settingsRes.data ?? null) as ContentPlanSettings | null,
  };
}

export async function upsertContentPlanSettings(input: {
  firmId: string;
  ask: string | null;
  reviewBy: string | null;
}): Promise<{ ok: true; settings: ContentPlanSettings } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("content_plan_settings")
    .upsert(
      {
        firm_id: input.firmId,
        ask: input.ask,
        review_by: input.reviewBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "firm_id" },
    )
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, settings: data as ContentPlanSettings };
}

export async function createPeriod(input: {
  firmId: string;
  startsOn: string;
  endsOn: string;
  theme: string | null;
  details: string | null;
  rationale: string | null;
  actor: DeliverableActor;
}): Promise<{ ok: true; period: ContentPeriod } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("content_periods")
    .insert({
      firm_id: input.firmId,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      theme: input.theme,
      details: input.details,
      rationale: input.rationale,
      created_by_role: input.actor.role,
      created_by_id: input.actor.id ?? null,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: `create period failed: ${error.message}` };
  return { ok: true, period: data as ContentPeriod };
}

export async function updatePeriod(input: {
  periodId: string;
  firmId: string;
  patch: Partial<
    Pick<ContentPeriod, "starts_on" | "ends_on" | "theme" | "details" | "rationale" | "sort_index">
  >;
}): Promise<{ ok: true; period: ContentPeriod } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("content_periods")
    .update({ ...input.patch, updated_at: new Date().toISOString() })
    .eq("id", input.periodId)
    .eq("firm_id", input.firmId)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "period not found for this firm" };
  return { ok: true, period: data as ContentPeriod };
}

export async function deletePeriod(input: {
  periodId: string;
  firmId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Deliverables in this week unassign automatically (FK ON DELETE SET NULL).
  const { error } = await supabase
    .from("content_periods")
    .delete()
    .eq("id", input.periodId)
    .eq("firm_id", input.firmId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Operator: assign a deliverable to a week and/or set its format label. */
export async function setDeliverablePlacement(input: {
  deliverableId: string;
  firmId: string;
  periodId: string | null;
  format: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.periodId) {
    const { data: p } = await supabase
      .from("content_periods")
      .select("id")
      .eq("id", input.periodId)
      .eq("firm_id", input.firmId)
      .maybeSingle();
    if (!p) return { ok: false, error: "period not found for this firm" };
  }
  const { error } = await supabase
    .from("content_deliverables")
    .update({
      period_id: input.periodId,
      format: input.format,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.deliverableId)
    .eq("firm_id", input.firmId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
  /**
   * When true, do NOT enqueue the firm-side review notification and do NOT
   * stamp review_notified_at. Used for bulk seed flows where the operator
   * wants to verify placement in the portal before announcing.
   * `notifyPendingReviews` then fires one consolidated digest later.
   */
  silent?: boolean;
}): Promise<{ ok: true; version: DeliverableVersion } | { ok: false; error: string }> {
  // Compute the next version number and insert. Two concurrent posts can read
  // the same MAX and collide on UNIQUE(deliverable_id, version_number); the DB
  // protects integrity (the second insert is rejected with 23505), and we
  // re-read and retry once so the loser is re-sequenced instead of surfacing an
  // opaque 500.
  let inserted: DeliverableVersion | null = null;
  let lastErr = "";
  for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
    const { data: last } = await supabase
      .from("deliverable_versions")
      .select("version_number")
      .eq("deliverable_id", input.deliverableId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextNumber = (last?.version_number ?? 0) + 1;

    const { data, error: insertErr } = await supabase
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
    if (!insertErr) {
      inserted = data as DeliverableVersion;
      break;
    }
    lastErr = insertErr.message;
    // 23505 = unique_violation: another post took this number; retry once.
    if (insertErr.code !== "23505") break;
  }
  if (!inserted) return { ok: false, error: `version insert failed: ${lastErr}` };

  const version = inserted;

  // Point the deliverable at the new version, return it to review, clear any
  // stale approval pointer (the prior approval stays in approval_records).
  const { error: updateErr } = await supabase
    .from("content_deliverables")
    .update({
      current_version_id: version.id,
      status: statusAfterNewVersion(),
      approved_version_id: null,
      approved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.deliverableId);
  if (updateErr) {
    return { ok: false, error: `deliverable update failed: ${updateErr.message}` };
  }

  if (input.silent !== true) {
    // Enqueue FIRST; stamp review_notified_at only after the outbox insert
    // succeeds. If the enqueue throws (e.g. CHECK constraint violation),
    // the stamp is skipped and notifyPendingReviews can pick up the row later.
    try {
      await enqueueDeliverableNotification({
        firmId: input.firmId,
        deliverableId: input.deliverableId,
        eventType: "deliverable_review_requested",
        audience: "firm",
        actor: input.actor,
        bodyPreview: `Version ${version.version_number} is ready for your review.`,
      });
      await supabase
        .from("content_deliverables")
        .update({ review_notified_at: new Date().toISOString() })
        .eq("id", input.deliverableId);
    } catch (e) {
      console.warn("[deliverables] notify failed (review_notified_at NOT stamped):", e);
    }
  }

  return { ok: true, version };
}

/**
 * Operator action: announce every in_review deliverable for this firm that
 * has not yet been announced (review_notified_at IS NULL), in one batch.
 * Each deliverable enqueues a notification_outbox row; the existing 5-minute
 * digest cron groups them into ONE digest email per recipient. Idempotent:
 * re-running picks up only the still-unannounced rows.
 */
export async function notifyPendingReviews(input: {
  firmId: string;
  actor: DeliverableActor;
}): Promise<{ ok: true; notified: number } | { ok: false; error: string }> {
  const { data: pending, error } = await supabase
    .from("content_deliverables")
    .select("id, title, current_version_id")
    .eq("firm_id", input.firmId)
    .eq("status", "in_review")
    .is("review_notified_at", null)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: `query failed: ${error.message}` };

  const rows = (pending ?? []) as Array<{ id: string; title: string; current_version_id: string | null }>;
  if (rows.length === 0) return { ok: true, notified: 0 };

  const now = new Date().toISOString();
  let notified = 0;
  for (const r of rows) {
    try {
      await enqueueDeliverableNotification({
        firmId: input.firmId,
        deliverableId: r.id,
        eventType: "deliverable_review_requested",
        audience: "firm",
        actor: input.actor,
        bodyPreview: "Ready for your review.",
      });
      await supabase
        .from("content_deliverables")
        .update({ review_notified_at: now })
        .eq("id", r.id);
      notified++;
    } catch (e) {
      console.warn("[deliverables] notifyPendingReviews: enqueue failed for", r.id, e);
    }
  }

  return { ok: true, notified };
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
  void approved; // unused after the RPC took over; kept for future telemetry

  // Codex re-audit follow-up: the previous app-layer reorder created a crash
  // window where status='approved' could land WITHOUT the append-only record.
  // Delegate to a SECURITY DEFINER Postgres function that does the version
  // drift check + the immutable insert + the status update inside ONE
  // transaction. Either both land or neither does. SELECT FOR UPDATE
  // serializes concurrent sign-offs on the same deliverable.
  const { data: rpcData, error: rpcErr } = await supabase.rpc("record_approval_atomic", {
    p_deliverable_id:    input.deliverableId,
    p_version_id:        input.versionId,
    p_firm_id:           input.firmId,
    p_decision:          input.decision,
    p_signer_role:       "lawyer",
    p_signer_id:         input.signer.id ?? null,
    p_signer_name:       input.signer.name,
    p_signer_email:      input.signer.email,
    p_attestation:       input.attestation,
    p_version_number:    input.versionNumber,
    p_deliverable_title: input.deliverableTitle,
    p_ip_address:        input.ipAddress,
    p_user_agent:        input.userAgent,
    p_note:              input.note,
  });
  if (rpcErr) {
    return { ok: false, error: `approval rpc failed: ${rpcErr.message}` };
  }
  const result = (rpcData ?? {}) as { ok?: boolean; stale?: boolean; error?: string; record_id?: string };
  if (!result.ok) {
    return { ok: false, error: result.error ?? "approval failed", stale: result.stale };
  }

  // Fetch the full record to return to the caller (the RPC only returns the id
  // so we can serve a consistent ApprovalRecord shape upstream).
  const { data, error } = await supabase
    .from("approval_records")
    .select("*")
    .eq("id", result.record_id!)
    .single();
  if (error || !data) {
    return { ok: false, error: `approval record fetch failed: ${error?.message ?? "missing"}` };
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

  const { error: insertErr } = await supabase.from("notification_outbox").insert(rows);
  if (insertErr) throw new Error(`notification_outbox insert failed: ${insertErr.message}`);
}
