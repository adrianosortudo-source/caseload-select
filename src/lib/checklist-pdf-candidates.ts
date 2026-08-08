import "server-only";

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

const PDF_MIME = "application/pdf";
const PDF_BUCKET = "firm-files";

export type PdfCandidateSource = "version" | "approval" | "comment";

export interface PdfCandidate {
  sourceKind: PdfCandidateSource;
  sourceId: string;
  versionId: string | null;
  storagePath: string;
  name: string;
  size: number | null;
  mime: string;
  sourceLabel: string;
}

function isPdf(mime: unknown, name: unknown): boolean {
  return mime === PDF_MIME || (typeof name === "string" && name.toLowerCase().endsWith(".pdf"));
}

function addCandidate(map: Map<string, PdfCandidate>, candidate: PdfCandidate): void {
  if (!map.has(candidate.storagePath)) map.set(candidate.storagePath, candidate);
}

export async function listPdfCandidates(firmId: string, deliverableId: string): Promise<PdfCandidate[]> {
  const [{ data: versions, error: versionsError }, { data: approvals, error: approvalsError }, { data: comments, error: commentsError }] = await Promise.all([
    supabase
      .from("deliverable_versions")
      .select("id, version_number, storage_path, asset_name, asset_size_bytes, asset_mime")
      .eq("firm_id", firmId)
      .eq("deliverable_id", deliverableId)
      .order("version_number", { ascending: false }),
    supabase
      .from("approval_records")
      .select("id, version_id, version_number, attachments, created_at")
      .eq("firm_id", firmId)
      .eq("deliverable_id", deliverableId)
      .order("created_at", { ascending: false }),
    supabase
      .from("deliverable_comments")
      .select("id, version_id, attachments, created_at")
      .eq("firm_id", firmId)
      .eq("deliverable_id", deliverableId)
      .order("created_at", { ascending: false }),
  ]);
  if (versionsError) throw new Error(versionsError.message);
  if (approvalsError) throw new Error(approvalsError.message);
  if (commentsError) throw new Error(commentsError.message);

  const candidates = new Map<string, PdfCandidate>();
  for (const version of versions ?? []) {
    if (!version.storage_path || !isPdf(version.asset_mime, version.asset_name)) continue;
    addCandidate(candidates, {
      sourceKind: "version",
      sourceId: version.id,
      versionId: version.id,
      storagePath: version.storage_path,
      name: version.asset_name ?? version.storage_path.split("/").pop() ?? "Checklist PDF",
      size: version.asset_size_bytes ?? null,
      mime: PDF_MIME,
      sourceLabel: `Deliverable version v${version.version_number}`,
    });
  }
  for (const approval of approvals ?? []) {
    for (const attachment of Array.isArray(approval.attachments) ? approval.attachments : []) {
      if (!attachment?.storage_path || !isPdf(attachment.mime, attachment.name)) continue;
      addCandidate(candidates, {
        sourceKind: "approval",
        sourceId: approval.id,
        versionId: approval.version_id ?? null,
        storagePath: attachment.storage_path,
        name: attachment.name ?? attachment.storage_path.split("/").pop() ?? "Checklist PDF",
        size: attachment.size ?? null,
        mime: PDF_MIME,
        sourceLabel: `Approval attachment · v${approval.version_number ?? "?"}`,
      });
    }
  }
  for (const comment of comments ?? []) {
    for (const attachment of Array.isArray(comment.attachments) ? comment.attachments : []) {
      if (!attachment?.storage_path || !isPdf(attachment.mime, attachment.name)) continue;
      addCandidate(candidates, {
        sourceKind: "comment",
        sourceId: comment.id,
        versionId: comment.version_id ?? null,
        storagePath: attachment.storage_path,
        name: attachment.name ?? attachment.storage_path.split("/").pop() ?? "Checklist PDF",
        size: attachment.size ?? null,
        mime: PDF_MIME,
        sourceLabel: "Review comment attachment",
      });
    }
  }
  return [...candidates.values()];
}

export async function resolvePdfCandidate(input: {
  firmId: string;
  deliverableId: string;
  sourceKind: PdfCandidateSource;
  sourceId: string;
  storagePath: string;
}): Promise<PdfCandidate | null> {
  const candidates = await listPdfCandidates(input.firmId, input.deliverableId);
  return candidates.find(
    (candidate) =>
      candidate.sourceKind === input.sourceKind &&
      candidate.sourceId === input.sourceId &&
      candidate.storagePath === input.storagePath,
  ) ?? null;
}

export async function downloadPdf(storagePath: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(PDF_BUCKET).download(storagePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
