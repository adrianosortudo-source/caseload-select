import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { getDeliverableDetail, uploadDeliverableAsset } from "@/lib/deliverables";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const PDF_MIME = "application/pdf";

function sniffPdf(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "operator access required" }, { status: 403 });
  }

  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (detail.deliverable.deliverable_role !== "lead_magnet_pdf") {
    return NextResponse.json({ error: "PDF attachment is only available for checklist PDF deliverables" }, { status: 400 });
  }

  const currentVersionId = detail.deliverable.current_version_id;
  if (!currentVersionId || !detail.versions.some((version) => version.id === currentVersionId)) {
    return NextResponse.json({ error: "a current deliverable version is required" }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart body" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: 'field "file" is required' }, { status: 400 });
  if (file.size > MAX_PDF_BYTES) return NextResponse.json({ error: "file too large (max 50 MB)" }, { status: 413 });
  if (file.type !== PDF_MIME) return NextResponse.json({ error: "only application/pdf files are allowed" }, { status: 415 });

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sniffPdf(buffer)) return NextResponse.json({ error: "file content is not a valid PDF" }, { status: 415 });

  const { data: existing, error: existingError } = await supabase
    .from("publication_artifacts")
    .select("id")
    .eq("firm_id", firmId)
    .eq("deliverable_id", deliverableId)
    .eq("version_id", currentVersionId)
    .eq("artifact_type", "pdf")
    .is("superseded_at", null)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
  if (existing) {
    return NextResponse.json({ error: "a PDF is already attached to the current version", code: "PDF_ALREADY_ATTACHED" }, { status: 409 });
  }

  const uploaded = await uploadDeliverableAsset({
    firmId,
    deliverableId,
    buffer,
    contentType: PDF_MIME,
    filename: file.name,
  });
  if (!uploaded.ok) return NextResponse.json({ error: uploaded.error }, { status: 500 });

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const { data: artifact, error: insertError } = await supabase
    .from("publication_artifacts")
    .insert({
      firm_id: firmId,
      deliverable_id: deliverableId,
      version_id: currentVersionId,
      artifact_type: "pdf",
      asset_role: null,
      locale: detail.deliverable.locale,
      destination: detail.deliverable.publication_destination,
      storage_bucket: "firm-files",
      storage_path: uploaded.storagePath,
      mime_type: PDF_MIME,
      size_bytes: buffer.length,
      sha256,
      created_by_role: "operator",
      created_by_id: resolved.actor.id ?? null,
    })
    .select("id")
    .single();

  if (insertError) {
    await supabase.storage.from("firm-files").remove([uploaded.storagePath]);
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "a PDF is already attached to the current version", code: "PDF_ALREADY_ATTACHED" }, { status: 409 });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, artifactId: artifact.id });
}
