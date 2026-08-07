/**
 * Phase 1.2 (EXECUTION-PLAN_weekly-publish-tool_v1.md): register one week's
 * publication_artifacts evidence rows.
 *
 * Ported from the proven, already-executed ToDelete/register-w32-evidence.mjs
 * (Standing Rule 4: port, do not rewrite the logic). Same mechanism, config-
 * driven instead of hardcoded: no uploads, no local file reads. Every target
 * deliverable already carries hero_image_url pointing at a file already in
 * the firm-files bucket (uploaded by the portal hero route); this reads that
 * path back out of the signed URL, downloads the real bytes, verifies them
 * against the expected sha256 in config (Appendix A), and registers the
 * evidence row against them.
 *
 * INSERT-only, idempotent (Standing Rule 8): re-running with the same week
 * performs zero writes once every slot is registered. sha256/asset_role are
 * left null on the row itself, matching Week 3 canon exactly (verified
 * live, Phase 0.1) -- the sha256 check below is a LOCAL integrity gate
 * against Appendix A, never written to the row.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceRowConfig, WeekConfig } from "../config";

export interface RegisterEvidenceRowResult {
  label: string;
  deliverableId: string;
  status: "inserted" | "skipped";
  artifactId?: string;
  reason?: string;
}

export interface RegisterEvidenceResult {
  week: string;
  inserted: number;
  skipped: number;
  rows: RegisterEvidenceRowResult[];
}

const BUCKET = "firm-files";

function sniffMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Pulls the in-bucket object path back out of a stored Supabase signed URL. */
function storagePathFromSignedUrl(url: string): string | null {
  const marker = `/object/sign/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const rest = url.slice(i + marker.length);
  const q = rest.indexOf("?");
  return decodeURIComponent(q === -1 ? rest : rest.slice(0, q));
}

async function registerOne(
  supabase: SupabaseClient,
  firmId: string,
  row: EvidenceRowConfig,
): Promise<RegisterEvidenceRowResult> {
  const { data: deliverable, error: dErr } = await supabase
    .from("content_deliverables")
    .select("id, firm_id, current_version_id, hero_image_url")
    .eq("id", row.deliverableId)
    .maybeSingle();
  if (dErr) throw new Error(`${row.label}: deliverable lookup failed: ${dErr.message}`);
  if (!deliverable) throw new Error(`${row.label}: deliverable ${row.deliverableId} not found`);
  if (deliverable.firm_id !== firmId) {
    throw new Error(`${row.label}: firm mismatch (expected ${firmId}, got ${deliverable.firm_id})`);
  }
  if (!deliverable.current_version_id) throw new Error(`${row.label}: no current_version_id`);
  if (!deliverable.hero_image_url) throw new Error(`${row.label}: no hero_image_url on deliverable`);

  const storagePath = storagePathFromSignedUrl(deliverable.hero_image_url);
  if (!storagePath) throw new Error(`${row.label}: could not parse storage path from hero_image_url`);

  // Idempotency: the live slot check, run immediately before every insert
  // (F7). Matches on the same columns the proven predecessor script used;
  // any existing active row for this slot -- regardless of asset_role --
  // means this evidence is already registered.
  const { data: existing, error: exErr } = await supabase
    .from("publication_artifacts")
    .select("id")
    .eq("deliverable_id", row.deliverableId)
    .eq("version_id", deliverable.current_version_id)
    .eq("artifact_type", row.artifactType)
    .eq("locale", row.locale)
    .eq("destination", row.destination)
    .is("superseded_at", null);
  if (exErr) throw new Error(`${row.label}: existing-row check failed: ${exErr.message}`);
  if (existing && existing.length > 0) {
    return { label: row.label, deliverableId: row.deliverableId, status: "skipped", reason: "already registered" };
  }

  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(storagePath);
  if (dlErr || !blob) throw new Error(`${row.label}: download failed: ${dlErr?.message ?? "no blob"}`);
  const buf = Buffer.from(await blob.arrayBuffer());

  const mime = sniffMime(buf);
  if (!mime) throw new Error(`${row.label}: downloaded bytes are not a recognized image`);

  const actualSha256 = createHash("sha256").update(buf).digest("hex");
  if (actualSha256 !== row.sha256) {
    throw new Error(
      `${row.label}: sha256 mismatch against Appendix A -- expected ${row.sha256}, storage object ${storagePath} is ${actualSha256}`,
    );
  }

  const { data: inserted, error: insErr } = await supabase
    .from("publication_artifacts")
    .insert({
      firm_id: firmId,
      deliverable_id: row.deliverableId,
      version_id: deliverable.current_version_id,
      artifact_type: row.artifactType,
      locale: row.locale,
      destination: row.destination,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      public_url: null,
      mime_type: mime,
      size_bytes: buf.length,
      sha256: null, // canon: Week 3 leaves this null on all 9 rows (Phase 0.1)
      validation_result: null,
      created_by_role: "operator",
      created_by_id: null,
    })
    .select("id")
    .single();
  if (insErr || !inserted) throw new Error(`${row.label}: insert failed: ${insErr?.message}`);

  return { label: row.label, deliverableId: row.deliverableId, status: "inserted", artifactId: inserted.id };
}

export async function registerEvidence(
  supabase: SupabaseClient,
  weekConfig: WeekConfig,
): Promise<RegisterEvidenceResult> {
  const rows: RegisterEvidenceRowResult[] = [];
  for (const row of weekConfig.evidence) {
    rows.push(await registerOne(supabase, weekConfig.firmId, row));
  }
  const inserted = rows.filter((r) => r.status === "inserted").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  return { week: weekConfig.week, inserted, skipped, rows };
}
