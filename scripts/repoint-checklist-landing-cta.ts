/**
 * Repoint a Content Studio checklist-landing deliverable's CTA at the real, live,
 * publicly-gated landing route on drglaw.ca -- instead of an authenticated portal
 * download URL that returns 401 JSON to the anonymous prospects the page is for.
 *
 * THE DEFECT THIS CLOSES (found 2026-08-07, W32 federal filing checklist): this
 * session's own earlier work pointed both Landing EN/PT CTAs at
 * `https://app.caseloadselect.ca/api/portal/{firmId}/files/{fileId}?download=1`.
 * That route is real and correctly authenticated -- for an operator with a service
 * role key. The actual audience of a public marketing landing page is an anonymous
 * visitor, who gets a 401 instead of a checklist. The REAL lead-capture chain lives
 * entirely outside this app, in a separate repo (`drg-law-website`):
 * `drglaw.ca/resources/{slug}` (a form-gated landing page, driven by the registry
 * in that repo's `src/lib/checklists.ts`) -> consent -> `/api/checklist-magnet` ->
 * `marketing-lead-intake` -> GHL contact + tags -> thanks view reveals the PDF.
 * See EXECUTION-PLAN_lead-magnet-chain_v1.md (Deliverables/2026-W32/) for the full
 * chain trace and the architecture decision this repoint script implements (L5).
 *
 * IMPORTANT: this script updates the Content Studio DOCUMENTATION of the landing
 * page (a `content_deliverables` row reviewed/approved in Content Studio) -- it does
 * NOT touch the live website. The live website is driven entirely by the separate
 * `checklists.ts` registry in the `drg-law-website` repo (already correct once that
 * repo's own registry entry is authored, released and deployed). Running this
 * script before the website route is actually live would point Content Studio's
 * own record at a URL that 404s -- run it only AFTER Phase 3's anonymous
 * verification confirms the route is live and serving the approved PDF.
 *
 * What it does: an exact string swap of the CTA anchor's href (and, optionally,
 * its visible text) inside the CURRENT version's body_html, then an
 * insert-plus-repoint of a new deliverable_versions row -- the same pattern as
 * swap-checklist-download-artifact.ts. It never mutates a row in place.
 *
 * Refuses if: the deliverable does not exist or is `approved` (an approved
 * deliverable requires a new change-request loop, not a silent content swap --
 * same rule bind-checklist-pdf-artifact.ts and swap-checklist-download-artifact.ts
 * already enforce); the CURRENT version's body_html does not contain --old-href
 * inside an anchor tag (the staleness guard -- either the repoint already
 * happened, or --deliverable/--old-href do not match); the href does not appear
 * exactly once (ambiguous target -- refuse rather than guess).
 *
 * Usage:
 *   npx tsx scripts/repoint-checklist-landing-cta.ts \
 *     --deliverable <uuid> --old-href <url> --new-href <url> \
 *     [--old-text <string> --new-text <string>] \
 *     [--apply]
 *
 * Default is a dry run (prints the audit block, writes nothing). Pass --apply to write.
 * Re-running after a successful --apply refuses at the staleness guard (old-href is
 * no longer in the current body_html) -- this is the idempotency proof, not a bug.
 */
import { randomUUID } from "node:crypto";
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
const oldHref = argument("old-href");
const newHref = argument("new-href");
const oldText = optionalArgument("old-text");
const newText = optionalArgument("new-text");
if ((oldText && !newText) || (!oldText && newText)) {
  throw new Error("--old-text and --new-text must both be supplied or both omitted");
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function run() {
  console.log(APPLY ? "=== APPLY ===" : "=== DRY RUN (no writes) ===");

  const { data: deliverable, error: deliverableError } = await supabase
    .from("content_deliverables")
    .select("id, firm_id, title, status, current_version_id")
    .eq("id", deliverableId)
    .maybeSingle();
  if (deliverableError) throw new Error(`Deliverable lookup failed: ${deliverableError.message}`);
  if (!deliverable) throw new Error("Deliverable not found");
  if (deliverable.status === "approved") {
    throw new Error("Refusing to repoint the CTA on an approved deliverable without a new change-request loop");
  }

  const { data: currentVersion, error: versionError } = await supabase
    .from("deliverable_versions")
    .select("*")
    .eq("id", deliverable.current_version_id)
    .maybeSingle();
  if (versionError) throw new Error(`Current version lookup failed: ${versionError.message}`);
  if (!currentVersion) throw new Error("Current version not found");

  const html = String(currentVersion.body_html ?? "");
  const hrefAnchor = `href="${oldHref}"`;
  const hrefCount = html.split(hrefAnchor).length - 1;
  if (hrefCount === 0) {
    throw new Error(
      `Current version's body_html does not contain an anchor with href="${oldHref}". ` +
      `Either this repoint already happened, or --deliverable/--old-href do not match. Refusing.`
    );
  }
  if (hrefCount !== 1) {
    throw new Error(`Expected exactly 1 occurrence of href="${oldHref}", found ${hrefCount}. Refusing (ambiguous target).`);
  }

  let newHtml = html.split(hrefAnchor).join(`href="${newHref}"`);

  if (oldText && newText) {
    const textCount = newHtml.split(oldText).length - 1;
    if (textCount === 0) {
      throw new Error(`--old-text "${oldText}" not found in body_html. Refusing.`);
    }
    if (textCount !== 1) {
      throw new Error(`Expected exactly 1 occurrence of --old-text, found ${textCount}. Refusing (ambiguous target).`);
    }
    newHtml = newHtml.split(oldText).join(newText);
  }

  const nextVersionNumber = (currentVersion.version_number as number) + 1;

  console.log(`\ndeliverable   ${deliverable.title} (${deliverableId}), status=${deliverable.status}`);
  console.log(`href          ${oldHref}\n           ->  ${newHref}`);
  if (oldText && newText) console.log(`text          "${oldText}"\n           ->  "${newText}"`);
  console.log(`version       v${currentVersion.version_number} -> v${nextVersionNumber} (CTA repoint only, every other column carried forward)`);

  if (!APPLY) {
    console.log("\n(dry run only; re-run with --apply)");
    return;
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
    note: `CTA repointed from the authenticated portal download URL to the live public lead-magnet route (${newHref}). No other change.`,
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

  console.log(JSON.stringify({ ok: true, deliverableId, newVersionId, versionNumber: nextVersionNumber }, null, 2));
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
