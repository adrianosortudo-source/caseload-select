import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { getDeliverableDetail, uploadDeliverableAsset } from "@/lib/deliverables";
import {
  downloadPdf,
  listPdfCandidates,
  resolvePdfCandidate,
  type PdfCandidateSource,
} from "@/lib/checklist-pdf-candidates";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const PDF_MIME = "application/pdf";

function sniffPdf(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "%PDF";
}

async function operatorFor(firmId: string) {
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return { response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  if (resolved.actor.role !== "operator") {
    return { response: NextResponse.json({ error: "operator access required" }, { status: 403 }) };
  }
  return { resolved };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  const auth = await operatorFor(firmId);
  if (auth.response) return auth.response;
  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId || detail.deliverable.deliverable_role !== "lead_magnet_pdf") {
    return NextResponse.json({ error: "checklist PDF not found" }, { status: 404 });
  }
  try {
    return NextResponse.json({ candidates: await listPdfCandidates(firmId, deliverableId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "could not load PDF candidates" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  const auth = await operatorFor(firmId);
  if (auth.response) return auth.response;
  const resolved = auth.resolved;
  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) return NextResponse.json({ error: "not found" }, { status: 404 });
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
  const candidateStoragePath = form.get("candidate_storage_path");
  const candidateSourceKind = form.get("candidate_source_kind");
  const candidateSourceId = form.get("candidate_source_id");
  if (file instanceof File && candidateStoragePath) {
    return NextResponse.json({ error: "choose an uploaded PDF or an existing PDF, not both" }, { status: 400 });
  }

  const { data: activeArtifact, error: activeError } = await supabase
    .from("publication_artifacts")
    .select("id")
    .eq("firm_id", firmId)
    .eq("deliverable_id", deliverableId)
    .eq("version_id", currentVersionId)
    .eq("artifact_type", "pdf")
    .is("superseded_at", null)
    .maybeSingle();
  if (activeError) return NextResponse.json({ error: activeError.message }, { status: 500 });

  const priorArtifactId = activeArtifact?.id ?? null;
  const requestedPriorId = form.get("prior_artifact_id");
  if (priorArtifactId && requestedPriorId !== priorArtifactId) {
    return NextResponse.json({ error: "the current PDF changed; reload before replacing it", code: "PDF_STALE" }, { status: 409 });
  }
  if (!priorArtifactId && requestedPriorId) {
    return NextResponse.json({ error: "no active PDF exists to replace", code: "PDF_STALE" }, { status: 409 });
  }

  const reason = String(form.get("reason") ?? "").trim();
  if (priorArtifactId && !reason) return NextResponse.json({ error: "replacement reason is required" }, { status: 400 });

  let buffer: Buffer;
  let storagePath: string;
  let uploadedNewObject = false;
  if (file instanceof File) {
    if (file.size > MAX_PDF_BYTES) return NextResponse.json({ error: "file too large (max 50 MB)" }, { status: 413 });
    if (file.type !== PDF_MIME) return NextResponse.json({ error: "only application/pdf files are allowed" }, { status: 415 });
    buffer = Buffer.from(await file.arrayBuffer());
    if (!sniffPdf(buffer)) return NextResponse.json({ error: "file content is not a valid PDF" }, { status: 415 });
    const uploaded = await uploadDeliverableAsset({ firmId, deliverableId, buffer, contentType: PDF_MIME, filename: file.name });
    if (!uploaded.ok) return NextResponse.json({ error: uploaded.error }, { status: 500 });
    storagePath = uploaded.storagePath;
    uploadedNewObject = true;
  } else if (candidateStoragePath && candidateSourceKind && candidateSourceId) {
    if (!["version", "approval", "comment"].includes(String(candidateSourceKind))) {
      return NextResponse.json({ error: "invalid PDF candidate source" }, { status: 400 });
    }
    const candidate = await resolvePdfCandidate({
      firmId,
      deliverableId,
      sourceKind: candidateSourceKind as PdfCandidateSource,
      sourceId: String(candidateSourceId),
      storagePath: String(candidateStoragePath),
    });
    if (!candidate) return NextResponse.json({ error: "PDF candidate does not belong to this deliverable" }, { status: 404 });
    const downloaded = await downloadPdf(candidate.storagePath);
    if (!downloaded || downloaded.length > MAX_PDF_BYTES || !sniffPdf(downloaded)) {
      return NextResponse.json({ error: "the selected candidate is not a valid PDF" }, { status: 415 });
    }
    buffer = downloaded;
    storagePath = candidate.storagePath;
  } else {
    return NextResponse.json({ error: 'field "file" or an existing PDF candidate is required' }, { status: 400 });
  }

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const { data: replacementId, error: replaceError } = await supabase.rpc("register_or_replace_publication_pdf_atomic", {
    p_firm_id: firmId,
    p_deliverable_id: deliverableId,
    p_version_id: currentVersionId,
    p_prior_artifact_id: priorArtifactId,
    p_storage_bucket: "firm-files",
    p_storage_path: storagePath,
    p_locale: detail.deliverable.locale,
    p_destination: detail.deliverable.publication_destination,
    p_mime_type: PDF_MIME,
    p_size_bytes: buffer.length,
    p_sha256: sha256,
    p_actor_role: "operator",
    p_actor_id: resolved!.actor.id ?? null,
    p_reason: reason || "Initial PDF attachment",
  });
  if (replaceError) {
    if (uploadedNewObject) await supabase.storage.from("firm-files").remove([storagePath]);
    const status = /active|current|prior|already exists/i.test(replaceError.message) ? 409 : 500;
    return NextResponse.json({ error: replaceError.message }, { status });
  }
  return NextResponse.json({ ok: true, artifactId: replacementId, replacedArtifactId: priorArtifactId });
}
