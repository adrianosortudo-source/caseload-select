/* eslint-disable @typescript-eslint/no-explicit-any -- revision manifests are validated external JSON */
/** Generic exact-manifest repair for a misplaced EN/PT Checklist review pair. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createSupabaseAdmin, loadDotEnv } from "../weekly-publish/lib/env";

function flag(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validate(manifest: any): void {
  const errors: string[] = [];
  if (manifest.schemaVersion !== "drg-checklist-review-revision-v1") errors.push("unsupported schemaVersion");
  if (manifest.publicationAuthorized !== false) errors.push("publicationAuthorized must be false");
  if (manifest.notificationAuthorized !== false) errors.push("notificationAuthorized must be false");
  if (!Array.isArray(manifest.items) || manifest.items.length !== 2) errors.push("exactly two items are required");
  const locales = new Set((manifest.items ?? []).map((item: any) => item.locale));
  if (locales.size !== 2 || !locales.has("en-CA") || !locales.has("pt-BR")) errors.push("items must be the EN/PT pair");
  for (const item of manifest.items ?? []) {
    if (typeof item.bodyHtml !== "string" || item.bodyHtml.length < 5000) errors.push(`${item.locale}: incomplete bodyHtml`);
    if (sha256(item.bodyHtml ?? "") !== item.bodySha256) errors.push(`${item.locale}: bodySha256 mismatch`);
    if (item.assetMime !== "application/pdf" || !(item.assetSizeBytes > 1000)) errors.push(`${item.locale}: invalid PDF binding`);
  }
  if (errors.length) throw new Error(errors.join("; "));
}

async function main() {
  const command = process.argv[2];
  if (!['prepare', 'apply', 'prove', 'run'].includes(command)) throw new Error("Usage: checklist-revision.ts <prepare|apply|prove|run> --manifest <file>");
  const manifestPath = path.resolve(flag("manifest"));
  const raw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  validate(manifest);
  const manifestSha256 = sha256(raw);

  loadDotEnv(path.resolve(__dirname, "../../.env.local"));
  const supabase = createSupabaseAdmin();
  const { data: existing, error: lookupError } = await supabase.from("drg_checklist_review_revisions").select("manifest_sha256,result").eq("firm_id", manifest.firmId).eq("revision_key", manifest.revisionKey).maybeSingle();
  if (lookupError) throw new Error(`revision lookup failed: ${lookupError.message}`);
  if (existing && existing.manifest_sha256 !== manifestSha256) throw new Error("revision key already exists with different manifest bytes");
  if (command === "prepare") {
    console.log(JSON.stringify({ status: existing ? "existing" : "ready", manifestSha256, writesPerformed: 0 }, null, 2));
    return;
  }
  if (!existing) {
    for (const item of manifest.items) {
      const { data, error } = await supabase.from("content_deliverables").select("id,current_version_id,content_kind,status,published_at,approved_version_id,locale,deliverable_role").eq("id", item.deliverableId).eq("firm_id", manifest.firmId).maybeSingle();
      if (error || !data) throw new Error(`${item.locale}: deliverable not found`);
      if (data.current_version_id !== item.expectedCurrentVersionId || data.locale !== item.locale || data.deliverable_role !== "lead_magnet_pdf") throw new Error(`${item.locale}: deliverable identity/current-version mismatch`);
      if (data.published_at || data.approved_version_id) throw new Error(`${item.locale}: repair refuses an approved or published deliverable`);
    }
  }
  if (command === "prove") {
    if (!existing) throw new Error("revision receipt not found");
    console.log(JSON.stringify({ status: "proved", manifestSha256, writesPerformed: 0, result: existing.result }, null, 2));
    return;
  }
  const { data: applied, error: applyError } = await supabase.rpc("apply_drg_checklist_review_revision", { p_manifest: manifest, p_manifest_sha256: manifestSha256 });
  if (applyError) throw new Error(`checklist revision failed: ${applyError.message}`);
  if (command === "apply") {
    console.log(JSON.stringify({ ...applied, manifestSha256 }, null, 2));
    return;
  }
  const { data: replay, error: replayError } = await supabase.rpc("apply_drg_checklist_review_revision", { p_manifest: manifest, p_manifest_sha256: manifestSha256 });
  if (replayError || replay?.status !== "verified_noop" || Number(replay?.writesPerformed) !== 0) throw new Error("exact replay did not prove zero writes");
  console.log(JSON.stringify({ applied, replay, manifestSha256, publicationAuthorized: false, notificationAuthorized: false }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
