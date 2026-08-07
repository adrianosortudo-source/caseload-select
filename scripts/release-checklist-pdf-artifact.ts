/**
 * Release an already approved PDF artifact by copying the exact private bytes
 * to the website's public resource path. The command is intentionally
 * approval-first: it refuses drafts, unapproved versions, missing hashes, or
 * bytes that no longer match the Content Studio record.
 *
 * "Approved" has TWO independent, equally valid paths in this system (fixed
 * 2026-08-07 -- see [[standing-authorization-is-real-approval]] in the
 * operator's memory and the DR-107 comments in src/lib/deliverables-pure.ts):
 *
 *   1. individual_approval  -- content_deliverables.approved_version_id
 *      equals the requested --version.
 *   2. standing_authorization -- the firm's latest row in
 *      standing_publishing_authorizations has event = 'enabled', the
 *      requested version has requires_individual_review = false, AND the
 *      requested version is the deliverable's current_version_id (releasing
 *      a non-current version is never allowed on this path -- there is no
 *      per-version approval record to anchor it to).
 *
 * A prior version of this script tested ONLY path 1, which made it refuse
 * every DRG Law release forever: DRG operates under standing authorization
 * (enabled by Damaris Guimaraes 2026-07-21, scope all_future_content), so
 * approved_version_id is null BY DESIGN for that firm. Treating null as
 * "unapproved" is the exact mistake the memory above warns has been made
 * repeatedly. Both paths are checked; the one that cleared is reported back
 * as `release_path` so the caller always knows which rule actually fired.
 *
 * Usage:
 *   npx tsx scripts/release-checklist-pdf-artifact.ts \
 *     --deliverable <uuid> --version <uuid> --output <absolute-path>
 */

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { readFileSync as readTextFile } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadDotEnv() {
  try {
    const raw = readTextFile(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 0) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // Direct environment variables are also supported.
  }
}

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

loadDotEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("Missing Supabase URL or service role key");

const deliverableId = argument("deliverable");
const versionId = argument("version");
const outputPath = argument("output");
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function run() {
  const { data: deliverable, error: deliverableError } = await supabase
    .from("content_deliverables")
    .select("id, firm_id, status, approved_version_id, current_version_id")
    .eq("id", deliverableId)
    .maybeSingle();
  if (deliverableError) throw new Error(`Deliverable lookup failed: ${deliverableError.message}`);
  if (!deliverable) throw new Error("Deliverable not found");

  const { data: version, error: versionError } = await supabase
    .from("deliverable_versions")
    .select("id, storage_path, asset_mime, asset_sha256, asset_validation, requires_individual_review")
    .eq("id", versionId)
    .eq("deliverable_id", deliverableId)
    .maybeSingle();
  if (versionError) throw new Error(`Version lookup failed: ${versionError.message}`);
  if (!version || !version.storage_path || version.asset_mime !== "application/pdf" || !version.asset_sha256) {
    throw new Error("Release blocked: approved version has no complete PDF artifact binding");
  }

  let releasePath: "individual_approval" | "standing_authorization" | null = null;

  if (deliverable.approved_version_id === versionId) {
    releasePath = "individual_approval";
  } else {
    const { data: standingAuth, error: standingAuthError } = await supabase
      .from("standing_publishing_authorizations")
      .select("event")
      .eq("firm_id", deliverable.firm_id)
      .order("event_seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (standingAuthError) throw new Error(`Standing authorization lookup failed: ${standingAuthError.message}`);
    const standingAuthActive = standingAuth?.event === "enabled";
    const isCurrentVersion = deliverable.current_version_id === versionId;
    if (standingAuthActive && isCurrentVersion && version.requires_individual_review === false) {
      releasePath = "standing_authorization";
    }
  }

  if (!releasePath) {
    throw new Error(
      "Release blocked: the requested version is not cleared under either approval path -- " +
      "not the deliverable's approved_version_id, AND not (current_version_id + " +
      "requires_individual_review=false + an active standing_publishing_authorizations row)"
    );
  }
  if ((version.asset_validation as Record<string, unknown> | null)?.status !== "machine_passed") {
    throw new Error("Release blocked: artifact validation is not machine_passed");
  }

  const { data: file, error: downloadError } = await supabase.storage.from("firm-files").download(version.storage_path);
  if (downloadError || !file) throw new Error(`Artifact download failed: ${downloadError?.message ?? "empty file"}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== version.asset_sha256) throw new Error("Release blocked: downloaded bytes do not match recorded SHA-256");
  await writeFile(outputPath, bytes);
  console.log(JSON.stringify({ ok: true, outputPath, versionId, bytes: bytes.length, sha256, approved: true, release_path: releasePath }, null, 2));
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
