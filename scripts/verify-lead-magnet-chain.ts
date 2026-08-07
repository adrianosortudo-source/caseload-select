/**
 * Read-only, anonymous-consumer verification of the real checklist lead-magnet chain.
 *
 * Every other verifier in this repo (verify-checklist-chain.ts) checks the chain from the
 * DB outward, using a service-role key -- the operator's view. That is exactly the view that
 * missed the 2026-08-07 W32 defect: a landing CTA that resolved fine for an authenticated
 * operator and returned 401 JSON to everyone else. This script checks the chain from the
 * OTHER end -- a plain, unauthenticated `fetch()`, the same request an anonymous prospect's
 * browser makes -- because that is the only vantage point this class of bug is visible from.
 * See [[feedback_verify-through-consumer-read-path]] in the operator's memory.
 *
 * Per locale (en, pt), asserts:
 *   1. The public landing route (`{base}/resources/{slug}` or `{base}/pt/resources/{slug}`)
 *      returns 200 to an anonymous request (no cookies, no service key, no auth header).
 *   2. The page contains a real <form> and this checklist's own stage-question copy (proves
 *      the registry entry actually rendered, not a fallback or a 404 swallowed into a 200).
 *   3. The page contains the sourced consent-label text (proves the real consent-gated form
 *      is present, not a bare download link).
 *   4. Zero em/en dashes anywhere in the page (house copy rule).
 *   5. No placeholder token leaked into the page (`PENDING`, `TODO`, `TBD`, a bracketed
 *      ALL-CAPS marker, "Lorem ipsum").
 *   6. The PDF at `{base}/resources/{pdfFile}` returns 200 and its sha256 matches
 *      --expect-sha256-en/--expect-sha256-pt, when supplied.
 *   7. If --deliverable-en/--deliverable-pt is supplied: exactly ONE non-superseded pdf
 *      `publication_artifacts` row exists for that deliverable, and its sha256 matches the
 *      bytes just downloaded anonymously -- the same "ambiguous live PDF" check
 *      verify-checklist-chain.ts runs for the portal layer, applied here to the public layer.
 *
 * GHL tag verification is deliberately NOT done here (L6: that happens via the GHL MCP
 * `contacts_get-contacts` tool, against a real captured lead, not scripted against the GHL
 * API from this repo). --spot-check-email instead prints the matching
 * marketing_lead_consent_log row(s) so an operator/agent can cross-check the ghl_contact_id
 * that row references, by hand, via that MCP tool.
 *
 * Usage:
 *   npx tsx scripts/verify-lead-magnet-chain.ts --slug <slug> \
 *     [--base-url https://drglaw.ca] [--pdf-file-en <path>] [--pdf-file-pt <path>] \
 *     [--expect-sha256-en <hex>] [--expect-sha256-pt <hex>] \
 *     [--deliverable-en <uuid>] [--deliverable-pt <uuid>] \
 *     [--stage-marker-en <string>] [--stage-marker-pt <string>] \
 *     [--spot-check-email <email>]
 *
 * --stage-marker-en/-pt default to this checklist's own stage-question copy; override to
 * reuse this script for a different checklist without editing it.
 *
 * Checks whose required input was not supplied are reported as "not asserted" (not silently
 * passed and not failed) -- e.g. before an approved sha256 exists, run it without
 * --expect-sha256-* to confirm the chain resolves at all; add the hash once one is approved.
 * Exit 0 only if every check that DID run passed.
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

function optionalArgument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function requiredArgument(name: string): string {
  const value = optionalArgument(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

const slug = requiredArgument("slug");
const baseUrl = (optionalArgument("base-url") ?? "https://drglaw.ca").replace(/\/$/, "");
const pdfFileEn = optionalArgument("pdf-file-en") ?? `${slug}.pdf`;
const pdfFilePt = optionalArgument("pdf-file-pt") ?? `pt/${slug}.pdf`;
const expectSha256En = optionalArgument("expect-sha256-en");
const expectSha256Pt = optionalArgument("expect-sha256-pt");
const deliverableEn = optionalArgument("deliverable-en");
const deliverablePt = optionalArgument("deliverable-pt");
const spotCheckEmail = optionalArgument("spot-check-email");
const stageMarkerEn = optionalArgument("stage-marker-en") ?? "Where are you with this filing?";
const stageMarkerPt = optionalArgument("stage-marker-pt") ?? "Em que fase você está com esta declaração?";

const CONSENT_MARKERS: Record<"en" | "pt", string> = {
  en: "so DRG Law can follow up about this checklist",
  pt: "para que a DRG Law possa dar seguimento",
};
const DASH_PATTERN = /[–—]/; // en dash, em dash
// Case-SENSITIVE: this codebase's real placeholder convention is all-caps
// ("[FORM DESTINATION PENDING]"). A case-insensitive match on TODO/PENDING
// collides with ordinary Portuguese vocabulary ("todo" = "every/all") --
// caught by the PT positive-control run against Week 3's live page before
// this script shipped. Do not add the `i` flag back without re-checking
// against real PT copy.
const PLACEHOLDER_PATTERN = /\bPENDING\b|\bTODO\b|\bTBD\b|\[[A-Z][A-Z ]{3,}\]|Lorem ipsum/;

type LocaleResult = {
  locale: "en" | "pt";
  landingUrl: string;
  pdfUrl: string;
  violations: string[];
  notes: string[];
  summary: Record<string, unknown>;
};

async function checkLocale(locale: "en" | "pt", stageQuestionMarker: string): Promise<LocaleResult> {
  const violations: string[] = [];
  const notes: string[] = [];
  const landingUrl = locale === "en" ? `${baseUrl}/resources/${slug}` : `${baseUrl}/pt/resources/${slug}`;
  const pdfFile = locale === "en" ? pdfFileEn : pdfFilePt;
  const pdfUrl = `${baseUrl}/resources/${pdfFile}`;
  const expectSha256 = locale === "en" ? expectSha256En : expectSha256Pt;
  const deliverableId = locale === "en" ? deliverableEn : deliverablePt;

  const landingRes = await fetch(landingUrl, { redirect: "manual" });
  if (landingRes.status !== 200) {
    violations.push(`landing route returned ${landingRes.status}, expected 200 (anonymous request)`);
    return { locale, landingUrl, pdfUrl, violations, notes, summary: { landingStatus: landingRes.status } };
  }
  const html = await landingRes.text();

  if (!html.includes("<form")) violations.push("no <form> element found on the landing page");
  if (!html.includes(stageQuestionMarker)) {
    violations.push(`stage-question marker "${stageQuestionMarker}" not found -- registry entry may not be rendering`);
  }
  if (!html.includes(CONSENT_MARKERS[locale])) {
    violations.push(`consent-label marker not found -- expected substring "${CONSENT_MARKERS[locale]}"`);
  }
  if (DASH_PATTERN.test(html)) violations.push("em or en dash found on the landing page");
  const placeholderMatch = html.match(PLACEHOLDER_PATTERN);
  if (placeholderMatch) violations.push(`placeholder token found on the landing page: "${placeholderMatch[0]}"`);

  let pdfBytes = 0;
  let pdfSha256: string | undefined;
  const pdfRes = await fetch(pdfUrl, { redirect: "manual" });
  if (pdfRes.status !== 200) {
    violations.push(`PDF route returned ${pdfRes.status}, expected 200 (anonymous request)`);
  } else {
    const buffer = Buffer.from(await pdfRes.arrayBuffer());
    pdfBytes = buffer.length;
    pdfSha256 = createHash("sha256").update(buffer).digest("hex");
    if (expectSha256) {
      if (pdfSha256 !== expectSha256) {
        violations.push(`PDF sha256 (${pdfSha256}) does not match --expect-sha256-${locale} (${expectSha256})`);
      }
    } else {
      notes.push("PDF sha256 not asserted -- no --expect-sha256-" + locale + " supplied");
    }
  }

  let liveArtifactCount: number | undefined;
  if (deliverableId) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) throw new Error("Missing Supabase URL or service role key");
    const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: liveArtifacts, error } = await supabase
      .from("publication_artifacts")
      .select("id, sha256")
      .eq("deliverable_id", deliverableId)
      .eq("artifact_type", "pdf")
      .is("superseded_at", null);
    if (error) throw new Error(error.message);
    liveArtifactCount = (liveArtifacts ?? []).length;
    if (liveArtifactCount !== 1) {
      violations.push(`expected exactly 1 non-superseded pdf publication_artifacts row for ${deliverableId}, found ${liveArtifactCount}`);
    } else if (pdfSha256 && liveArtifacts![0].sha256 !== pdfSha256) {
      violations.push(`the single live publication_artifacts row's sha256 does not match the anonymously-downloaded PDF bytes`);
    }
  } else {
    notes.push("exactly-one-live-artifact not asserted -- no --deliverable-" + locale + " supplied");
  }

  return {
    locale, landingUrl, pdfUrl, violations, notes,
    summary: { landingStatus: landingRes.status, pdfStatus: pdfRes.status, pdfBytes, pdfSha256, liveArtifactCount },
  };
}

async function spotCheckConsentLog(email: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Missing Supabase URL or service role key");
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase
    .from("marketing_lead_consent_log")
    .select("id, email, asset, locale, ghl_contact_id, captured_at")
    .eq("email", email)
    .eq("asset", slug)
    .order("captured_at", { ascending: false })
    .limit(3);
  if (error) throw new Error(error.message);
  console.log(`\nspot-check: marketing_lead_consent_log rows for ${email} / asset=${slug}`);
  console.log("(cross-check ghl_contact_id via the GHL MCP contacts_get-contacts tool -- not called from this script)");
  console.log(JSON.stringify(data ?? [], null, 2));
}

async function run() {
  const results = await Promise.all([
    checkLocale("en", stageMarkerEn),
    checkLocale("pt", stageMarkerPt),
  ]);
  for (const result of results) {
    console.log(JSON.stringify({
      locale: result.locale, ok: result.violations.length === 0,
      violations: result.violations, notes: result.notes,
      landingUrl: result.landingUrl, pdfUrl: result.pdfUrl, ...result.summary,
    }, null, 2));
  }
  if (spotCheckEmail) await spotCheckConsentLog(spotCheckEmail);
  process.exitCode = results.some((r) => r.violations.length > 0) ? 1 : 0;
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
