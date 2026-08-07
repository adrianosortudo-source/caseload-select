/**
 * Bind a privately generated checklist PDF to a new immutable deliverable
 * version. This is deliberately an operator script, not a public API route.
 *
 * Usage:
 *   npx tsx scripts/bind-checklist-pdf-artifact.ts \
 *     --deliverable <uuid> \
 *     --source-version <uuid> \
 *     --pdf <absolute-or-relative-path> \
 *     --generation <path-to-generation-json> \
 *     --validation <path-to-validation-json> \
 *     --note <string>
 *
 * The script verifies that the supplied source version is still current,
 * uploads the exact PDF bytes to private firm-files storage, inserts a new
 * version carrying the artifact hash and validation report, and moves the
 * deliverable back to in_review. It never creates an approval record and it
 * never writes to a public website path.
 *
 * --note is REQUIRED (fixed 2026-08-07): this script used to hardcode every
 * bind's note as "PDF accessibility pilot artifact bound to source version
 * ...", regardless of why the bind actually happened. Every one of this
 * session's own binds -- rebuilds, depth fixes, the DOC-code stamp rollout --
 * carried that same boilerplate, which made a full day of legitimate,
 * traceable work look like unexplained writes from a third party and
 * triggered a wasted investigation. The note is the audit trail; it must
 * say what actually happened, every time.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadDotEnv() {
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 0) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // The operator may provide the variables directly in the shell.
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
const sourceVersionId = argument("source-version");
const pdfPath = path.resolve(argument("pdf"));
const generationPath = path.resolve(argument("generation"));
const validationPath = path.resolve(argument("validation"));
const note = argument("note");

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function run() {
const [pdfBytes, generationRaw, validationRaw] = await Promise.all([
  readFile(pdfPath),
  readFile(generationPath, "utf8"),
  readFile(validationPath, "utf8"),
]);
const generation = JSON.parse(generationRaw) as Record<string, unknown>;
const validation = JSON.parse(validationRaw) as Record<string, unknown>;
const sha256 = createHash("sha256").update(pdfBytes).digest("hex");
if (generation.sha256 !== sha256) throw new Error("PDF does not match its generation sidecar SHA-256");
if (validation.status !== "machine_passed") throw new Error("Validation sidecar is not machine_passed");
if (validation.sha256 !== sha256) throw new Error("PDF does not match its validation sidecar SHA-256");

const { data: deliverable, error: deliverableError } = await supabase
  .from("content_deliverables")
  .select("id, firm_id, title, current_version_id, status")
  .eq("id", deliverableId)
  .maybeSingle();
if (deliverableError) throw new Error(`Deliverable lookup failed: ${deliverableError.message}`);
if (!deliverable) throw new Error("Deliverable not found");
if (deliverable.status === "approved") throw new Error("Refusing to replace an approved deliverable without a new change-request loop");
if (deliverable.current_version_id !== sourceVersionId) {
  throw new Error(`Source version is stale: current is ${deliverable.current_version_id}`);
}

const { data: sourceVersion, error: sourceError } = await supabase
  .from("deliverable_versions")
  .select("id, firm_id, deliverable_id, version_number, body_html")
  .eq("id", sourceVersionId)
  .maybeSingle();
if (sourceError) throw new Error(`Source version lookup failed: ${sourceError.message}`);
if (!sourceVersion || sourceVersion.deliverable_id !== deliverableId || sourceVersion.firm_id !== deliverable.firm_id) {
  throw new Error("Source version does not belong to the requested deliverable and firm");
}

const { data: latest, error: latestError } = await supabase
  .from("deliverable_versions")
  .select("version_number")
  .eq("deliverable_id", deliverableId)
  .order("version_number", { ascending: false })
  .limit(1)
  .maybeSingle();
if (latestError) throw new Error(`Version sequence lookup failed: ${latestError.message}`);
const versionNumber = (latest?.version_number ?? 0) + 1;
const artifactName = `${String(generation.title ?? deliverable.title).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "checklist"}.pdf`;
const storagePath = `deliverables/${deliverable.firm_id}/${deliverableId}/artifacts/v${versionNumber}-${sha256}.pdf`;

const { error: uploadError } = await supabase.storage.from("firm-files").upload(storagePath, pdfBytes, {
  contentType: "application/pdf",
  upsert: false,
});
if (uploadError) throw new Error(`Artifact upload failed: ${uploadError.message}`);

const versionId = randomUUID();
const { data: version, error: insertError } = await supabase
  .from("deliverable_versions")
  .insert({
    id: versionId,
    deliverable_id: deliverableId,
    firm_id: deliverable.firm_id,
    version_number: versionNumber,
    body_html: sourceVersion.body_html,
    storage_path: storagePath,
    asset_mime: "application/pdf",
    asset_size_bytes: pdfBytes.length,
    asset_name: artifactName,
    asset_sha256: sha256,
    asset_validation: validation,
    note,
    created_by_role: "operator",
    created_by_id: null,
  })
  .select("id, deliverable_id, firm_id, version_number, storage_path, asset_sha256, asset_validation")
  .single();
if (insertError) {
  await supabase.storage.from("firm-files").remove([storagePath]);
  throw new Error(`Version insert failed: ${insertError.message}`);
}

const { error: pointerError } = await supabase
  .from("content_deliverables")
  .update({
    current_version_id: versionId,
    status: "in_review",
    approved_version_id: null,
    approved_at: null,
    updated_at: new Date().toISOString(),
  })
  .eq("id", deliverableId)
  .eq("current_version_id", sourceVersionId);
if (pointerError) throw new Error(`Deliverable pointer update failed: ${pointerError.message}`);

console.log(JSON.stringify({
  ok: true,
  deliverableId,
  sourceVersionId,
  versionId: version.id,
  versionNumber,
  storagePath,
  bytes: pdfBytes.length,
  sha256,
  status: "in_review",
  approved: false,
  published: false,
}, null, 2));
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
