import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { getDeliverableDetail, notifyVersionReady } from "@/lib/deliverables";
import { cleanNote } from "@/lib/deliverables-pure";
import { applySuggestionsToHtml, validateSuggestionList } from "@/lib/suggestions-pure";
import { sanitizeExplainerHtml } from "@/lib/explainer-html-sanitize";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { postDeliverableLifecycleToChannel } from "@/lib/deliverable-channel-post";

const DRG_FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  if (firmId !== DRG_FIRM_ID) return NextResponse.json({ error: "not found" }, { status: 404 });
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") return NextResponse.json({ error: "operator required" }, { status: 403 });
  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const suggestionIds = Array.isArray(body.suggestion_ids) ? body.suggestion_ids.filter((id): id is string => typeof id === "string") : [];
  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId || detail.deliverable.content_kind !== "text") return NextResponse.json({ error: "not found" }, { status: 404 });
  const source = detail.versions.find((v) => v.id === detail.deliverable.current_version_id);
  if (!source || !source.body_html) return NextResponse.json({ error: "current text version not found" }, { status: 409 });
  const selected = detail.suggestions.filter((s) => suggestionIds.includes(s.id));
  if (selected.length !== suggestionIds.length) return NextResponse.json({ error: "unknown suggestion" }, { status: 400 });
  const sourceHash = createHash("sha256").update(source.body_html).digest("hex");
  if (selected.some((s) => s.source_body_sha256 && s.source_body_sha256 !== sourceHash)) {
    return NextResponse.json({ error: "a suggestion was anchored to a different source body" }, { status: 409 });
  }
  const valid = validateSuggestionList(selected, detail.suggestionEvents);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 409 });
  if (valid.suggestions.length !== selected.length) {
    return NextResponse.json({ error: "a selected suggestion is no longer open" }, { status: 409 });
  }
  const applied = applySuggestionsToHtml(source.body_html, valid.suggestions);
  if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: 409 });
  const bodyHtml = sanitizeExplainerHtml(applied.bodyHtml);
  const latestChangeRequest = detail.deliverable.status === "changes_requested"
    ? detail.approvals.find((a) => a.decision === "changes_requested")
    : null;
  const { data, error } = await supabaseAdmin.rpc("create_deliverable_version_from_suggestions_atomic", {
    p_deliverable_id: deliverableId,
    p_firm_id: firmId,
    p_source_version_id: source.id,
    p_body_html: bodyHtml,
    p_note: cleanNote(body.note) ?? `Applied ${selected.length} suggestion${selected.length === 1 ? "" : "s"}.`,
    p_created_by_role: resolved.actor.role,
    p_created_by_id: resolved.actor.id ?? null,
    p_suggestion_ids: suggestionIds,
    p_responds_to_approval_id: latestChangeRequest?.id ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  const version = data as { version_id?: string; version_number?: number } | null;
  if (!version?.version_id || typeof version.version_number !== "number") {
    return NextResponse.json({ error: "version was created but the result was incomplete" }, { status: 500 });
  }

  const notified = await notifyVersionReady({
    firmId,
    deliverableId,
    versionNumber: version.version_number,
    actor: resolved.actor,
  });
  if (!notified.ok) {
    console.warn("[deliverables/suggestions/apply] review notification failed:", notified.error);
  }
  await postDeliverableLifecycleToChannel({
    firmId,
    deliverableId,
    deliverableTitle: detail.deliverable.title,
    event: "new_version",
    actor: resolved.actor,
  }).catch((channelError) => {
    console.warn("[deliverables/suggestions/apply] channel post failed:", channelError);
  });

  return NextResponse.json({ ok: true, version, notification_queued: notified.ok });
}
