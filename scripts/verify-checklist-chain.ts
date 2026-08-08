/**
 * Read-only reconciliation: prove a checklist deliverable's client-facing download actually
 * matches the approved PDF -- by following the exact path a client's click follows, not by
 * trusting any write script's own "ok: true".
 *
 * Walks: content_deliverables.current_version_id -> deliverable_versions.body_html -> the
 * fileId embedded in the portal download link -> firm_files row -> the actual bytes in
 * storage. Asserts:
 *   - the linked firm_files row is not archived
 *   - the downloaded bytes' sha256 matches --expect-sha256 (if supplied) or the deliverable's
 *     own asset_sha256 column
 *   - exactly ONE non-superseded `publication_artifacts` pdf row exists for the deliverable,
 *     and its sha256 matches the downloaded bytes (an ambiguous "which PDF is live" answer
 *     is itself a defect -- see the 2026-08-07 W32 incident, where 3 existed)
 *   - if --kit-package/--kit-slot supplied, the Kit slot's sha256/filename agree
 *
 * Exit 0 with a JSON summary per deliverable if everything is consistent. Exit 1 naming the
 * first violation otherwise. This is the command a weekly reconciliation runs, not something
 * that needs re-deriving by hand each time.
 *
 * Usage:
 *   npx tsx scripts/verify-checklist-chain.ts --deliverable <uuid> [--expect-sha256 <hex>]
 *     [--kit-package <uuid> --kit-slot <string>]
 *
 * --deliverable is repeatable (check several deliverables' download chains in one run), but
 * --kit-package/--kit-slot is a SINGLE pair applied to every --deliverable in that invocation.
 * Different locales map to different kit slots (checklist-en vs checklist-pt), so a run that
 * checks both the EN and PT kit slots is two separate invocations, not one with two
 * --deliverable flags -- passing both deliverables with one kit-slot will report a false
 * mismatch against whichever deliverable's locale does not match that slot.
 */
import { createHash } from "node:crypto";
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
loadDotEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("Missing Supabase URL or service role key");
const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

function allArguments(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((value, index) => {
    if (value === `--${name}`) out.push(process.argv[index + 1]);
  });
  return out;
}
function optionalArgument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const deliverableIds = allArguments("deliverable");
if (deliverableIds.length === 0) throw new Error("Pass at least one --deliverable <uuid>");
const expectSha256 = optionalArgument("expect-sha256");
const kitPackageId = optionalArgument("kit-package");
const kitSlotId = optionalArgument("kit-slot");

async function verifyOne(deliverableId: string): Promise<{ ok: boolean; violations: string[]; summary: Record<string, unknown> }> {
  const violations: string[] = [];

  const { data: deliverable, error: dErr } = await supabase
    .from("content_deliverables")
    .select("id, title, status, current_version_id, approved_version_id")
    .eq("id", deliverableId)
    .maybeSingle();
  if (dErr) throw new Error(dErr.message);
  if (!deliverable) { violations.push("deliverable not found"); return { ok: false, violations, summary: {} }; }

  const { data: version, error: vErr } = await supabase
    .from("deliverable_versions")
    .select("id, version_number, body_html, asset_sha256")
    .eq("id", deliverable.current_version_id)
    .maybeSingle();
  if (vErr) throw new Error(vErr.message);
  if (!version) { violations.push("current version not found"); return { ok: false, violations, summary: {} }; }

  const html = String(version.body_html ?? "");
  const linkMatch = html.match(/files\/([0-9a-f-]{36})\?download=1/);
  if (!linkMatch) {
    violations.push("no portal download link found in current version's body_html");
    return { ok: false, violations, summary: { title: deliverable.title } };
  }
  const linkedFileId = linkMatch[1];

  const { data: file, error: fErr } = await supabase
    .from("firm_files")
    .select("id, display_name, storage_path, size_bytes, archived")
    .eq("id", linkedFileId)
    .maybeSingle();
  if (fErr) throw new Error(fErr.message);
  if (!file) { violations.push(`linked firm_files row ${linkedFileId} not found`); return { ok: false, violations, summary: {} }; }
  if (file.archived) violations.push(`linked firm_files row ${linkedFileId} (${file.display_name}) is archived -- the download link points at a retired file`);

  const { data: downloaded, error: dlErr } = await supabase.storage.from("firm-files").download(file.storage_path);
  if (dlErr || !downloaded) { violations.push(`could not download ${file.storage_path}: ${dlErr?.message ?? "empty"}`); return { ok: false, violations, summary: {} }; }
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  const liveSha256 = createHash("sha256").update(bytes).digest("hex");

  const targetSha = expectSha256 ?? version.asset_sha256;
  if (targetSha && liveSha256 !== targetSha) {
    violations.push(`downloaded bytes sha256 (${liveSha256}) does not match expected (${targetSha})`);
  }

  const { data: liveArtifacts, error: aErr } = await supabase
    .from("publication_artifacts")
    .select("id, sha256, size_bytes")
    .eq("deliverable_id", deliverableId)
    .eq("artifact_type", "pdf")
    .is("superseded_at", null);
  if (aErr) throw new Error(aErr.message);
  if ((liveArtifacts ?? []).length !== 1) {
    violations.push(`expected exactly 1 non-superseded pdf publication_artifacts row, found ${(liveArtifacts ?? []).length}: ${(liveArtifacts ?? []).map((a) => a.id.slice(0, 8) + "/" + String(a.sha256).slice(0, 8)).join(", ")}`);
  } else if (liveArtifacts![0].sha256 !== liveSha256) {
    violations.push(`the single live publication_artifacts row's sha256 (${String(liveArtifacts![0].sha256).slice(0, 12)}) does not match the downloaded bytes (${liveSha256.slice(0, 12)})`);
  }

  let kitCheck: Record<string, unknown> | undefined;
  if (kitPackageId && kitSlotId) {
    const { data: kit, error: kErr } = await supabase
      .from("publishing_package_assets")
      .select("sha256, filename")
      .eq("package_id", kitPackageId)
      .eq("content_slot_id", kitSlotId)
      .maybeSingle();
    if (kErr) throw new Error(kErr.message);
    if (!kit) violations.push(`kit slot ${kitSlotId} not found in package ${kitPackageId}`);
    else if (kit.sha256 !== liveSha256) violations.push(`kit slot sha256 (${String(kit.sha256).slice(0, 12)}) does not match the live download (${liveSha256.slice(0, 12)})`);
    kitCheck = kit ?? undefined;
  }

  return {
    ok: violations.length === 0,
    violations,
    summary: {
      title: deliverable.title, status: deliverable.status, currentVersion: version.version_number,
      linkedFile: file.display_name, linkedFileArchived: file.archived,
      downloadedBytes: bytes.length, downloadedSha256: liveSha256,
      liveArtifactCount: (liveArtifacts ?? []).length, kit: kitCheck,
    },
  };
}

async function run() {
  let anyFailed = false;
  for (const id of deliverableIds) {
    const result = await verifyOne(id);
    console.log(JSON.stringify({ deliverableId: id, ok: result.ok, violations: result.violations, ...result.summary }, null, 2));
    if (!result.ok) anyFailed = true;
  }
  process.exitCode = anyFailed ? 1 : 0;
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
