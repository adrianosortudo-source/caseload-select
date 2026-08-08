/**
 * Phase 2.2 (Appendix B): register this week's publishing_package_assets
 * candidates. Ported from ToDelete/kit-register-assets.mjs (Standing Rule
 * 4): mirrors registerCandidate() exactly -- pure input-shape checks, find
 * the matching manifest piece + requirement (role + destination + locale),
 * insert at status "candidate" / is_selected false (the true, honest,
 * sanctioned status for "registered, not yet operator-reviewed" -- no
 * function in this codebase ever produces "uploaded"/"hash_verified" as a
 * post-insert status; only selectCandidate(), a distinct operator action,
 * moves a row past "candidate"), then append one event per row.
 *
 * Two adaptations for reuse (both required by Standing Rule 8, absent from
 * the one-off script, which was never meant to run twice):
 *  1. Idempotency guard added: skip a slot/role/locale/destination that
 *     already has a registered row, instead of always inserting.
 *  2. PDF rows now genuinely re-verify sha256 by downloading the storage
 *     object and hashing the real bytes, instead of trusting a
 *     pre-supplied hash the one-off script had already confirmed earlier
 *     in the same session ("PDF bytes verified in Phase 0/1.3; not re-read
 *     here"). That shortcut is correct for a single run against known-good
 *     state but silently stops verifying anything for a future week --
 *     this closes the gap so the header's own claim ("recomputes each
 *     file's sha256 immediately before insert") is true for every row.
 */
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KitAssetRowConfig, WeekConfig } from "../config";
import type { RawManifest } from "./manifest";

const BUCKET = "firm-files";
const SHA_RE = /^[a-f0-9]{64}$/;

function pngDims(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export interface KitAssetRowResult {
  contentSlotId: string;
  assetRole: string;
  status: "registered" | "skipped";
  assetId?: string;
  reason?: string;
}

export interface RegisterKitAssetsResult {
  registered: number;
  skipped: number;
  rows: KitAssetRowResult[];
}

async function registerOne(
  supabase: SupabaseClient,
  weekConfig: WeekConfig,
  packageId: string,
  manifest: RawManifest,
  root: string,
  row: KitAssetRowConfig,
): Promise<KitAssetRowResult> {
  // Idempotency: any existing candidate for this exact slot/role/locale/
  // destination means this evidence is already registered (Standing Rule 8;
  // absent from the one-off script, added here).
  const { data: existing, error: exErr } = await supabase
    .from("publishing_package_assets")
    .select("id")
    .eq("package_id", packageId)
    .eq("content_slot_id", row.contentSlotId)
    .eq("asset_role", row.assetRole)
    .eq("locale", row.locale)
    .eq("destination", row.destination);
  if (exErr) throw new Error(`${row.contentSlotId}/${row.assetRole}: existing-row check failed: ${exErr.message}`);
  if (existing && existing.length > 0) {
    return { contentSlotId: row.contentSlotId, assetRole: row.assetRole, status: "skipped", reason: "already registered" };
  }

  let actualSha: string;
  let byteSize: number;
  let width = 0;
  let height = 0;
  let mimeType: string;
  let filename: string;

  if (row.storagePath) {
    // PDF rows: bytes live in Supabase Storage (already bound via
    // bind-checklist-pdf-artifact.ts), never on local disk.
    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(row.storagePath);
    if (dlErr || !blob) throw new Error(`${row.contentSlotId}: PDF download failed: ${dlErr?.message ?? "no blob"}`);
    const buf = Buffer.from(await blob.arrayBuffer());
    actualSha = createHash("sha256").update(buf).digest("hex");
    byteSize = buf.length;
    mimeType = "application/pdf";
    filename = row.storagePath.split("/").pop()!;
  } else if (row.file) {
    const filePath = path.join(root, row.file);
    const buf = readFileSync(filePath);
    actualSha = createHash("sha256").update(buf).digest("hex");
    byteSize = buf.length;
    const dims = pngDims(buf);
    width = dims.width;
    height = dims.height;
    mimeType = "image/png";
    filename = path.basename(filePath);
  } else {
    throw new Error(`${row.contentSlotId}: config row has neither file nor storagePath`);
  }

  if (!SHA_RE.test(actualSha) || actualSha !== row.sha256) {
    throw new Error(`${row.contentSlotId}: sha256 mismatch -- expected ${row.sha256}, got ${actualSha}`);
  }

  const piece = manifest.pieces.find((p) => p.content_slot_id === row.contentSlotId);
  if (!piece) throw new Error(`${row.contentSlotId}: no manifest piece for this slot`);
  const requirement = piece.required_assets.find(
    (r) => r.asset_role === row.assetRole && r.destination === row.destination,
  );
  if (!requirement) throw new Error(`${row.contentSlotId}: no manifest requirement for role ${row.assetRole} / destination ${row.destination}`);
  if (row.locale !== requirement.locale) {
    throw new Error(`${row.contentSlotId}: locale mismatch -- row ${row.locale} != requirement ${requirement.locale}`);
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("publishing_package_assets")
    .insert({
      package_id: packageId,
      firm_id: weekConfig.firmId,
      period_id: weekConfig.periodId,
      content_slot_id: row.contentSlotId,
      asset_role: row.assetRole,
      locale: row.locale,
      destination: row.destination,
      filename,
      mime_type: mimeType,
      byte_size: byteSize,
      width,
      height,
      sha256: actualSha,
      alt_text: row.altText,
      text_policy: row.textPolicy,
      overlay_language: row.overlayLanguage,
      status: "candidate",
      is_selected: false,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) throw new Error(`${row.contentSlotId}: insert failed: ${insertErr?.message}`);

  const receipt = {
    operation_id: randomUUID(),
    package_id: packageId,
    period_id: weekConfig.periodId,
    firm_id: weekConfig.firmId,
    content_slot_id: row.contentSlotId,
    deliverable_id: null,
    source_version_id: null,
    asset_id: inserted.id,
    filename,
    asset_role: row.assetRole,
    destination: row.destination,
    locale: row.locale,
    expected_hash: actualSha,
    computed_hash: actualSha,
    previous_binding: null,
    resulting_binding: { filename, assetRole: row.assetRole, destination: row.destination, locale: row.locale, sha: actualSha },
    actor_type: "operator",
    timestamp: new Date().toISOString(),
    outcome: "success",
    failure_reason: null,
  };
  const { error: eventErr } = await supabase.from("publishing_package_events").insert({
    package_id: packageId,
    firm_id: weekConfig.firmId,
    period_id: weekConfig.periodId,
    content_slot_id: row.contentSlotId,
    asset_id: inserted.id,
    event_type: "candidate_registered",
    actor_type: "operator",
    operation_id: receipt.operation_id,
    receipt,
  });
  if (eventErr) throw new Error(`${row.contentSlotId}: event insert failed: ${eventErr.message}`);

  return { contentSlotId: row.contentSlotId, assetRole: row.assetRole, status: "registered", assetId: inserted.id };
}

export async function registerKitAssets(
  supabase: SupabaseClient,
  weekConfig: WeekConfig,
  packageId: string,
  manifest: RawManifest,
  root: string,
): Promise<RegisterKitAssetsResult> {
  const rows: KitAssetRowResult[] = [];
  for (const row of weekConfig.kitAssets) {
    rows.push(await registerOne(supabase, weekConfig, packageId, manifest, root, row));
  }
  return {
    registered: rows.filter((r) => r.status === "registered").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    rows,
  };
}
