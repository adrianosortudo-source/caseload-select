/**
 * Registers the publication_artifacts 'pdf' evidence row for each
 * lead_magnet_pdf deliverable. Ported from the proven, already-executed
 * ToDelete/register-w32-pdf-artifacts.mjs (Standing Rule 4).
 *
 * CORRECTS F5 of EXECUTION-PLAN_weekly-publish-tool_v1.md ("PDFs get no
 * publication_artifacts rows"), which carried forward an already-superseded
 * ruling from the predecessor kit-completion plan. FOLLOWUPS 2026-08-07 ("W32
 * checklist PDF link, asked 6 times, now delivered") is explicit: "The
 * weekly-publish tool must register a pdf artifact for every lead_magnet_pdf,
 * not just bind the version -- F5 ... is superseded and must not be carried
 * into the tool." Verified live before writing this module: both W32
 * checklist deliverables already carry an active pdf artifact row with
 * sha256 populated. Recorded in Amendments.
 *
 * deliverable_versions binding and this artifact row are BOTH required: the
 * version columns are the canonical file binding (bind-checklist-pdf-
 * artifact.ts), this row is what the operator surface renders as a download
 * link -- without it the piece reads "No artifacts registered for this
 * piece yet." Canon shape for artifact_type 'pdf' DIFFERS from the image
 * rows: sha256 IS populated, asset_role stays null (the two asset_role
 * values that exist are website-image roles only).
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PdfEvidenceRowConfig, WeekConfig } from "../config";

const BUCKET = "firm-files";

export interface RegisterPdfEvidenceRowResult {
  label: string;
  deliverableId: string;
  status: "inserted" | "skipped";
  artifactId?: string;
  reason?: string;
}

export interface RegisterPdfEvidenceResult {
  inserted: number;
  skipped: number;
  rows: RegisterPdfEvidenceRowResult[];
}

async function registerOne(
  supabase: SupabaseClient,
  firmId: string,
  row: PdfEvidenceRowConfig,
): Promise<RegisterPdfEvidenceRowResult> {
  const { data: d, error: dErr } = await supabase
    .from("content_deliverables")
    .select("id, firm_id, deliverable_role, locale, current_version_id")
    .eq("id", row.deliverableId)
    .maybeSingle();
  if (dErr || !d) throw new Error(`${row.label}: deliverable lookup failed: ${dErr?.message ?? "not found"}`);
  if (d.firm_id !== firmId) throw new Error(`${row.label}: firm mismatch`);
  if (d.deliverable_role !== "lead_magnet_pdf") throw new Error(`${row.label}: not a lead_magnet_pdf deliverable (got ${d.deliverable_role})`);
  if (d.locale !== row.locale) throw new Error(`${row.label}: locale mismatch (deliverable ${d.locale}, config ${row.locale})`);
  if (!d.current_version_id) throw new Error(`${row.label}: no current_version_id`);

  const { data: v, error: vErr } = await supabase
    .from("deliverable_versions")
    .select("id, storage_path, asset_name, asset_mime, asset_sha256")
    .eq("id", d.current_version_id)
    .maybeSingle();
  if (vErr || !v) throw new Error(`${row.label}: current version lookup failed: ${vErr?.message ?? "not found"}`);
  if (!v.storage_path || v.asset_mime !== "application/pdf") {
    throw new Error(`${row.label}: no PDF bound on current version`);
  }

  const { data: existing, error: exErr } = await supabase
    .from("publication_artifacts")
    .select("id")
    .eq("deliverable_id", row.deliverableId)
    .eq("version_id", d.current_version_id)
    .eq("artifact_type", "pdf")
    .eq("locale", row.locale)
    .eq("destination", "firm_website")
    .is("superseded_at", null);
  if (exErr) throw new Error(`${row.label}: existing-row check failed: ${exErr.message}`);
  if (existing && existing.length > 0) {
    return { label: row.label, deliverableId: row.deliverableId, status: "skipped", reason: "already registered" };
  }

  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(v.storage_path);
  if (dlErr || !blob) throw new Error(`${row.label}: download failed: ${dlErr?.message ?? "no blob"}`);
  const buf = Buffer.from(await blob.arrayBuffer());
  const sha = createHash("sha256").update(buf).digest("hex");
  if (v.asset_sha256 && sha !== v.asset_sha256) {
    throw new Error(`${row.label}: hash mismatch -- version records ${v.asset_sha256}, downloaded bytes are ${sha}`);
  }
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new Error(`${row.label}: downloaded bytes are not a PDF`);
  }

  const { data: inserted, error: insErr } = await supabase
    .from("publication_artifacts")
    .insert({
      firm_id: firmId,
      deliverable_id: row.deliverableId,
      version_id: d.current_version_id,
      artifact_type: "pdf",
      asset_role: null,
      locale: row.locale,
      destination: "firm_website",
      storage_bucket: BUCKET,
      storage_path: v.storage_path,
      public_url: null,
      mime_type: "application/pdf",
      size_bytes: buf.length,
      sha256: sha, // canon: pdf rows DO carry sha256, unlike the image rows
      validation_result: null,
      created_by_role: "operator",
      created_by_id: null,
    })
    .select("id")
    .single();
  if (insErr || !inserted) throw new Error(`${row.label}: insert failed: ${insErr?.message}`);

  return { label: row.label, deliverableId: row.deliverableId, status: "inserted", artifactId: inserted.id };
}

export async function registerPdfEvidence(
  supabase: SupabaseClient,
  weekConfig: WeekConfig,
): Promise<RegisterPdfEvidenceResult> {
  const rows: RegisterPdfEvidenceRowResult[] = [];
  for (const row of weekConfig.pdfEvidence) {
    rows.push(await registerOne(supabase, weekConfig.firmId, row));
  }
  return {
    inserted: rows.filter((r) => r.status === "inserted").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    rows,
  };
}
