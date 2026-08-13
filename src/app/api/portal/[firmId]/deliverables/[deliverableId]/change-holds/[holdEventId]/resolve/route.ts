import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

/** Explicit client resolution; it does not approve or mutate content. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string; holdEventId: string }> },
) {
  const { firmId, deliverableId, holdEventId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;
  if (resolved.actor.role !== "lawyer" || !resolved.actor.id || !resolved.actor.email) {
    return NextResponse.json({ error: "only the firm's lawyer may resolve a client change hold" }, { status: 403 });
  }
  let body: { version_id?: unknown; note?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  if (typeof body.version_id !== "string") return NextResponse.json({ error: "version_id is required" }, { status: 400 });
  const { data, error } = await supabase.rpc("set_deliverable_client_change_hold", {
    p_firm_id: firmId, p_deliverable_id: deliverableId, p_version_id: body.version_id,
    p_event: "resolved", p_resolves_open_event_id: holdEventId, p_actor_role: "lawyer",
    p_actor_id: resolved.actor.id, p_actor_name: resolved.actor.name ?? "Authorised lawyer",
    p_actor_email: resolved.actor.email,
    p_reason: typeof body.note === "string" ? body.note.trim().slice(0, 2000) || null : null,
  });
  const result = (data ?? {}) as { ok?: boolean; error?: string; event_id?: string };
  if (error || !result.ok) return NextResponse.json({ error: result.error ?? error?.message ?? "could not resolve client change hold" }, { status: 400 });
  return NextResponse.json({ ok: true, eventId: result.event_id });
}
