#!/usr/bin/env node
/**
 * Import prospects into the Agency CRM (Layer B) from the toronto_law_firms
 * export JSON (or any compatible firms[] export).
 *
 * Dry run by default: maps + dedupes + prints stats and a sample, touches
 * nothing. Pass --commit to insert into Supabase via the service role.
 *
 * Usage:
 *   node scripts/import-agency-prospects.mjs                       # dry run, default source
 *   node scripts/import-agency-prospects.mjs --source path.json    # dry run, custom source
 *   node scripts/import-agency-prospects.mjs --max-lawyers 3       # ICP filter (<= N detected lawyers)
 *   node scripts/import-agency-prospects.mjs --commit              # write to Supabase
 *
 * Commit mode needs env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
 * The script refuses to write to anything other than the known prod project ref
 * unless you pass --allow-target (guards against the stale .env.local that points
 * at the retired project).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD_PROJECT_REF = "ssxryjxifwiivghglqer"; // ca-central-1 prod; see app CLAUDE.md
const SOURCE_LABEL = "toronto_law_firms_db";
const INSERT_CHUNK = 500;

function parseArgs(argv) {
  const a = { commit: false, source: null, maxLawyers: null, limit: null, allowTarget: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--commit") a.commit = true;
    else if (t === "--allow-target") a.allowTarget = true;
    else if (t === "--source") a.source = argv[++i];
    else if (t === "--max-lawyers") a.maxLawyers = Number(argv[++i]);
    else if (t === "--limit") a.limit = Number(argv[++i]);
  }
  return a;
}

function prospectKey(firmName, city) {
  return `${String(firmName).trim().toLowerCase()}|${String(city ?? "").trim().toLowerCase()}`;
}

function buildNotes(f) {
  const parts = [];
  if (f.website_url) parts.push(`Website: ${f.website_url}`);
  // lawyer_count carries sentinels (-1 / 0) for "unknown"; only surface real counts.
  if (typeof f.lawyer_count === "number" && f.lawyer_count > 0) {
    parts.push(`Lawyers (detected): ${f.lawyer_count}`);
  }
  if (f.google_rating != null) {
    const reviews = f.google_review_count != null ? ` (${f.google_review_count} reviews)` : "";
    parts.push(`Google rating: ${f.google_rating}${reviews}`);
  }
  if (f.has_ad_pixel) parts.push(`Running ads: ${f.ad_pixel_types || "pixel detected"}`);
  return parts.length ? parts.join(" · ") : null;
}

function mapFirm(f) {
  const firmName = typeof f.firm_name === "string" ? f.firm_name.trim() : "";
  if (!firmName) return null;
  const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  return {
    firm_name: firmName,
    contact_email: str(f.email),
    contact_phone: str(f.phone),
    city: str(f.city),
    practice_area: str(f.practice_areas),
    source: SOURCE_LABEL,
    notes: buildNotes(f),
  };
}

function loadFirms(sourcePath) {
  const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  if (Array.isArray(raw)) return raw;
  return raw.firms || raw.data || raw.rows || Object.values(raw).find(Array.isArray) || [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source =
    args.source || path.resolve(__dirname, "../../../07_Prospects/toronto_law_firms_export.json");

  if (!fs.existsSync(source)) {
    console.error(`Source not found: ${source}`);
    process.exit(1);
  }

  const firms = loadFirms(source);
  console.log(`Source: ${source}`);
  console.log(`Firms in export: ${firms.length}`);

  let mapped = [];
  let droppedNoName = 0;
  let droppedByLawyers = 0;
  for (const f of firms) {
    // Apply the ICP filter only when a real positive count is known (treat sentinels as unknown, keep).
    if (args.maxLawyers != null && typeof f.lawyer_count === "number" && f.lawyer_count > 0 && f.lawyer_count > args.maxLawyers) {
      droppedByLawyers++;
      continue;
    }
    const row = mapFirm(f);
    if (!row) { droppedNoName++; continue; }
    mapped.push(row);
  }

  // Dedupe within the file.
  const seen = new Set();
  const deduped = [];
  for (const row of mapped) {
    const key = prospectKey(row.firm_name, row.city);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  let rows = deduped;
  if (args.limit != null && args.limit >= 0) rows = rows.slice(0, args.limit);

  console.log(`Dropped (no firm_name): ${droppedNoName}`);
  if (args.maxLawyers != null) console.log(`Dropped (> ${args.maxLawyers} lawyers): ${droppedByLawyers}`);
  console.log(`Mapped: ${mapped.length}  Deduped (within file): ${rows.length}`);
  console.log("Sample (first 3):");
  console.log(JSON.stringify(rows.slice(0, 3), null, 2));

  if (!args.commit) {
    console.log("\nDry run. Re-run with --commit to write to Supabase.");
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("--commit needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in env.");
    process.exit(1);
  }
  const host = new URL(url).host;
  const ALLOWED_HOSTS = [`${PROD_PROJECT_REF}.supabase.co`];
  console.log(`\nTarget: ${host}`);
  if (!ALLOWED_HOSTS.includes(host) && !args.allowTarget) {
    console.error(
      `Refusing to write: ${host} is not an allowed prod host (${ALLOWED_HOSTS.join(", ")}).` +
      ` If this is intentional, re-run with --allow-target.`,
    );
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Dedupe against existing prospects.
  const { data: existing, error: exErr } = await supabase.from("agency_prospects").select("firm_name, city");
  if (exErr) { console.error(`Could not read existing prospects: ${exErr.message}`); process.exit(1); }
  const existingKeys = new Set((existing || []).map((e) => prospectKey(e.firm_name, e.city)));
  const toInsert = rows.filter((r) => !existingKeys.has(prospectKey(r.firm_name, r.city)));
  const skipped = rows.length - toInsert.length;

  let inserted = 0;
  let failedChunks = 0;
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    const slice = toInsert.slice(i, i + INSERT_CHUNK).map((r) => ({ ...r, stage: "new" }));
    const { data, error } = await supabase.from("agency_prospects").insert(slice).select("id");
    if (error) { console.error(`Chunk ${i / INSERT_CHUNK} failed: ${error.message}`); failedChunks++; continue; }
    inserted += (data || []).length;
    console.log(`Inserted ${inserted}/${toInsert.length}...`);
  }
  if (failedChunks > 0) {
    console.error(`\nImport incomplete: ${failedChunks} chunk(s) failed. Inserted ${inserted}, skipped ${skipped}. Re-run to retry (dedupe makes it safe).`);
    process.exit(1);
  }
  console.log(`\nDone. Inserted ${inserted}, skipped ${skipped} (already present).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
