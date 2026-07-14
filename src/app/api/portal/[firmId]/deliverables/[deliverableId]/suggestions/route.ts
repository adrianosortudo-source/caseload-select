import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { createSuggestion, getDeliverableDetail } from "@/lib/deliverables";
import { cleanNote, validateAnnotation } from "@/lib/deliverables-pure";
import {
  validateSuggestionAnchor,
  validateSuggestionReplacement,
} from "@/lib/suggestions-pure";

const DRG_FIRM_ID = "eec1d25e-a047-4827-8e4a-6eb96becca2b";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  if (firmId !== DRG_FIRM_ID) return NextResponse.json({ error: "not found" }, { status: 404 });
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON body" }, { status: 400 }); }
  const versionId = typeof body.version_id === "string" ? body.version_id : null;
  const operation = body.operation === "delete" ? "delete" : body.operation === "replace" ? "replace" : null;
  const annotation = validateAnnotation(body.annotation);
  if (!versionId || !operation || !annotation || annotation.type !== "text") {
    return NextResponse.json({ error: "version_id, text annotation, and operation are required" }, { status: 400 });
  }
  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId || detail.deliverable.content_kind !== "text") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const version = detail.versions.find((v) => v.id === versionId);
  if (!version || version.id !== detail.deliverable.current_version_id || !version.body_html) {
    return NextResponse.json({ error: "suggestions must target the current text version" }, { status: 409 });
  }
  const anchor = validateSuggestionAnchor({ bodyHtml: version.body_html, annotation });
  if (!anchor.ok) return NextResponse.json({ error: anchor.error }, { status: 400 });
  const replacementText = operation === "replace" && typeof body.replacement_text === "string"
    ? body.replacement_text.trim()
    : null;
  const replacement = validateSuggestionReplacement({ operation, replacementText });
  if (!replacement.ok) return NextResponse.json({ error: replacement.error }, { status: 400 });
  const originalText = annotation.quote.trim();
  const rationale = cleanNote(body.rationale);
  const result = await createSuggestion({
    deliverableId, versionId, firmId, annotation, operation,
    originalText, replacementText, rationale,
    sourceBodySha256: createHash("sha256").update(version.body_html).digest("hex"),
    actor: resolved.actor,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, suggestion: result.suggestion });
}
