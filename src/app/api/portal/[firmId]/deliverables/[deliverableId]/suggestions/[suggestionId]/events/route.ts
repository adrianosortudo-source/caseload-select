import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { addSuggestionEvent, getDeliverableDetail } from "@/lib/deliverables";
import { cleanNote } from "@/lib/deliverables-pure";
import { latestSuggestionState } from "@/lib/suggestions-pure";

const DRG_FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";
const ALLOWED = new Set(["needs_discussion", "declined", "withdrawn", "superseded"] as const);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string; suggestionId: string }> },
) {
  const { firmId, deliverableId, suggestionId } = await params;
  if (firmId !== DRG_FIRM_ID) return NextResponse.json({ error: "not found" }, { status: 404 });
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const eventType = typeof body.event_type === "string" && ALLOWED.has(body.event_type as never)
    ? body.event_type as "needs_discussion" | "declined" | "withdrawn" | "superseded" : null;
  if (!eventType) return NextResponse.json({ error: "unsupported suggestion event" }, { status: 400 });
  const detail = await getDeliverableDetail(deliverableId);
  const suggestion = detail?.suggestions.find((s) => s.id === suggestionId);
  if (!detail || detail.deliverable.firm_id !== firmId || !suggestion) return NextResponse.json({ error: "not found" }, { status: 404 });
  const state = latestSuggestionState(detail.suggestionEvents, suggestionId);
  if (state !== "open" && state !== "needs_discussion") return NextResponse.json({ error: "suggestion is no longer open" }, { status: 409 });
  if (eventType === "declined" || eventType === "superseded") {
    if (resolved.actor.role !== "operator") return NextResponse.json({ error: "operator required" }, { status: 403 });
  }
  if (eventType === "withdrawn" && suggestion.author_id && suggestion.author_id !== resolved.actor.id && resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "only the author or operator may withdraw" }, { status: 403 });
  }
  const result = await addSuggestionEvent({ suggestionId, firmId, eventType, actor: resolved.actor, note: cleanNote(body.note) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, event: result.event });
}
