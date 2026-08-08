/**
 * Repoint a checklist deliverable's client-facing download at a newly approved PDF.
 *
 * THE FOUR-LAYER CHAIN this closes (see docs/runbooks in drg-content-skills for the full
 * picture): a checklist PDF reaches the client through (1) the source JSON that builds it,
 * (2) a `deliverable_versions` bind (bind-checklist-pdf-artifact.ts) that attaches the PDF
 * bytes as that version's own asset columns, (3) a `firm_files` object + a portal download
 * link embedded in the CURRENT version's `body_html`, and (4) a Publishing Kit slot that
 * mirrors the artifact's identity. Binding a new version at layer 2 does NOT touch layers
 * 3-4 -- the client's download link keeps pointing at whatever `firm_files` object it always
 * pointed at. This script is layer 3+4.
 *
 * Discovered 2026-08-07 (W32 checklist v3.1): the approved PDF sat bound in
 * `deliverable_versions` for a full review cycle while the client-facing download link still
 * served the pre-round-9 defective file, because this layer had no sanctioned script and was
 * silently skipped. See [[feedback_verify-through-consumer-read-path]] /
 * [[drg-checklist-publish-chain]] in the operator's memory for the incident record.
 *
 * What it does, per locale, in order:
 *   1. upload the approved PDF bytes to a new firm_files object
 *   2. insert a new publication_artifacts pdf row for the current bound version; supersede
 *      the stale non-superseded pdf artifact row(s) for this deliverable (there should be
 *      exactly one live one before AND after -- see verify-checklist-chain.ts)
 *   3. insert a new deliverable_versions row whose ONLY change is the download link inside
 *      body_html (old fileId -> new fileId); every other column is carried forward verbatim
 *      from the current version, then repoint content_deliverables.current_version_id
 *   4. archive the superseded firm_files row
 *   5. update the matching Publishing Kit slot (publishing_package_assets) to the new
 *      sha256/filename/byte_size/deliverable_id/source_version_id/storage_key
 *
 * Refuses if: the deliverable does not exist or is `approved` (never silently replace an
 * approved artifact -- that requires a new change-request loop, same rule
 * bind-checklist-pdf-artifact.ts already enforces); the local PDF's sha256 does not match
 * --expect-sha256; the CURRENT version's body_html does not contain --old-file-id (the
 * staleness guard -- if this fails, either the swap already happened or --old-file-id/
 * --deliverable are wrong, and writing anyway would silently double-swap or corrupt the link).
 *
 * Usage:
 *   npx tsx scripts/swap-checklist-download-artifact.ts \
 *     --deliverable <uuid> --pdf <path> --expect-sha256 <hex> \
 *     --display-name <string> --old-file-id <uuid> --locale <en-CA|pt-BR> \
 *     [--kit-package <uuid> --kit-slot <string>] \
 *     [--apply]
 *
 * Default is a dry run (prints the audit block, writes nothing). Pass --apply to write.
 * Re-running after a successful --apply refuses at the staleness guard (old-file-id is no
 * longer in the current body_html) -- this is the idempotency proof, not a bug to work around.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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

function optionalArgument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

loadDotEnv();
const APPLY = process.argv.includes("--apply");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("Missing Supabase URL or service role key");

const deliverableId = argument("deliverable");
const pdfPath = argument("pdf");
const expectSha256 = argument("expect-sha256");
const displayName = argument("display-name");
const oldFileId = argument("old-file-id");
const locale = argument("locale");
const kitPackageId = optionalArgument("kit-package");
const kitSlotId = optionalArgument("kit-slot");
if ((kitPackageId && !kitSlotId) || (!kitPackageId && kitSlotId)) {
  throw new Error("--kit-package and --kit-slot must both be supplied or both omitted");
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function run() {
  console.log(APPLY ? "=== APPLY ===" : "=== DRY RUN (no writes) ===");

  const bytes = readFileSync(pdfPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expectSha256) {
    throw new Error(`Local PDF sha256 (${sha256}) does not match --expect-sha256 (${expectSha256})`);
  }

  const { data: deliverable, error: deliverableError } = await supabase
    .from("content_deliverables")
    .select("id, firm_id, title, status, current_version_id")
    .eq("id", deliverableId)
    .maybeSingle();
  if (deliverableError) throw new Error(`Deliverable lookup failed: ${deliverableError.message}`);
  if (!deliverable) throw new Error("Deliverable not found");
  if (deliverable.status === "approved") {
    throw new Error("Refusing to swap the download artifact on an approved deliverable without a new change-request loop");
  }

  const { data: currentVersion, error: versionError } = await supabase
    .from("deliverable_versions")
    .select("*")
    .eq("id", deliverable.current_version_id)
    .maybeSingle();
  if (versionError) throw new Error(`Current version lookup failed: ${versionError.message}`);
  if (!currentVersion) throw new Error("Current version not found");

  const html = String(currentVersion.body_html ?? "");
  if (!html.includes(oldFileId)) {
    throw new Error(
      `Current version's body_html does not reference --old-file-id ${oldFileId}. ` +
      `Either this swap already happened, or --deliverable/--old-file-id do not match. Refusing.`
    );
  }

  const { data: oldFile, error: oldFileError } = await supabase
    .from("firm_files")
    .select("id, display_name, size_bytes, category, kind, section, uploaded_by_role, uploaded_by_id, description, archived")
    .eq("id", oldFileId)
    .maybeSingle();
  if (oldFileError) throw new Error(`Old firm_files lookup failed: ${oldFileError.message}`);
  if (!oldFile) throw new Error(`firm_files row ${oldFileId} not found`);
  if (oldFile.archived) throw new Error(`firm_files row ${oldFileId} is already archived -- refusing to re-swap`);

  const { data: staleArtifacts, error: staleErr } = await supabase
    .from("publication_artifacts")
    .select("id, sha256")
    .eq("deliverable_id", deliverableId)
    .eq("artifact_type", "pdf")
    .is("superseded_at", null);
  if (staleErr) throw new Error(`publication_artifacts lookup failed: ${staleErr.message}`);

  const newFileId = randomUUID();
  const newPath = `firms/${deliverable.firm_id}/${newFileId}/${displayName}`;
  const newHtml = html.split(oldFileId).join(newFileId);
  const nextVersionNumber = (currentVersion.version_number as number) + 1;

  console.log(`\ndeliverable        ${deliverable.title} (${deliverableId}), status=${deliverable.status}`);
  console.log(`firm_files NEW      ${newFileId}  ${displayName}  ${bytes.length}B`);
  console.log(`firm_files ARCHIVE  ${oldFileId}  ${oldFile.display_name} (${oldFile.size_bytes}B)`);
  console.log(`version             v${currentVersion.version_number} -> v${nextVersionNumber} (download link swap only, PDF asset columns carried forward)`);
  console.log(`pub_artifact NEW    version_id=${currentVersion.id} sha=${sha256.slice(0, 12)}`);
  console.log(`pub_artifact SUPERSEDE  ${(staleArtifacts ?? []).length} existing non-superseded pdf row(s): ${(staleArtifacts ?? []).map((a) => a.id.slice(0, 8)).join(", ") || "(none)"}`);
  if (kitPackageId) console.log(`kit slot            ${kitSlotId} -> sha ${sha256.slice(0, 12)}, filename ${displayName}`);

  if (!APPLY) {
    console.log("\n(dry run only; re-run with --apply)");
    return;
  }

  const upload = await supabase.storage.from("firm-files").upload(newPath, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upload.error) throw new Error(`Upload failed: ${upload.error.message}`);

  const ffInsert = await supabase.from("firm_files").insert({
    id: newFileId,
    firm_id: deliverable.firm_id,
    uploaded_by_role: oldFile.uploaded_by_role ?? "operator",
    uploaded_by_id: oldFile.uploaded_by_id ?? null,
    category: oldFile.category,
    display_name: displayName,
    storage_path: newPath,
    size_bytes: bytes.length,
    mime_type: "application/pdf",
    description: oldFile.description,
    archived: false,
    kind: oldFile.kind,
    section: oldFile.section,
  });
  if (ffInsert.error) throw new Error(`firm_files insert failed: ${ffInsert.error.message}`);

  const paInsert = await supabase.from("publication_artifacts").insert({
    firm_id: deliverable.firm_id,
    deliverable_id: deliverableId,
    version_id: currentVersion.id,
    artifact_type: "pdf",
    locale,
    destination: "firm_website",
    storage_bucket: "firm-files",
    storage_path: newPath,
    mime_type: "application/pdf",
    size_bytes: bytes.length,
    sha256,
    created_by_role: "operator",
    created_by_id: null,
  });
  if (paInsert.error) throw new Error(`publication_artifacts insert failed: ${paInsert.error.message}`);

  for (const stale of staleArtifacts ?? []) {
    const supersede = await supabase
      .from("publication_artifacts")
      .update({ superseded_at: new Date().toISOString() })
      .eq("id", stale.id)
      .is("superseded_at", null);
    if (supersede.error) throw new Error(`Supersede ${stale.id} failed: ${supersede.error.message}`);
  }

  const newVersionId = randomUUID();
  const dvInsert = await supabase.from("deliverable_versions").insert({
    id: newVersionId,
    deliverable_id: deliverableId,
    firm_id: deliverable.firm_id,
    version_number: nextVersionNumber,
    body_html: newHtml,
    storage_path: currentVersion.storage_path,
    asset_mime: currentVersion.asset_mime,
    asset_size_bytes: currentVersion.asset_size_bytes,
    asset_name: currentVersion.asset_name,
    asset_sha256: currentVersion.asset_sha256,
    asset_validation: currentVersion.asset_validation,
    note: `Download link repointed to the approved checklist file ${newFileId}. PDF asset columns carried forward from v${currentVersion.version_number}.`,
    created_by_role: "operator",
    created_by_id: null,
  });
  if (dvInsert.error) throw new Error(`deliverable_versions insert failed: ${dvInsert.error.message}`);

  const pointer = await supabase
    .from("content_deliverables")
    .update({ current_version_id: newVersionId, updated_at: new Date().toISOString() })
    .eq("id", deliverableId)
    .eq("current_version_id", deliverable.current_version_id);
  if (pointer.error) throw new Error(`Pointer update failed: ${pointer.error.message}`);

  const archive = await supabase
    .from("firm_files")
    .update({ archived: true, archived_at: new Date().toISOString(), archived_by_role: "operator" })
    .eq("id", oldFileId);
  if (archive.error) throw new Error(`Archive failed: ${archive.error.message}`);

  if (kitPackageId && kitSlotId) {
    const kit = await supabase
      .from("publishing_package_assets")
      .update({
        sha256, filename: displayName, byte_size: bytes.length,
        deliverable_id: deliverableId, source_version_id: newVersionId,
        storage_key: newPath, updated_at: new Date().toISOString(),
      })
      .eq("package_id", kitPackageId)
      .eq("content_slot_id", kitSlotId);
    if (kit.error) throw new Error(`Kit slot update failed: ${kit.error.message}`);
  }

  console.log(JSON.stringify({
    ok: true, deliverableId, newVersionId, newFileId, versionNumber: nextVersionNumber,
    bytes: bytes.length, sha256, status: deliverable.status,
  }, null, 2));
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
