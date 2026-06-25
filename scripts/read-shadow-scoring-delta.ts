/**
 * Read-shadow / parity report for the screened_leads scoring-delta columns
 * (C3 dual-run runbook section 6). READ ONLY: it only SELECTs, never writes.
 *
 * It fetches the live rows, recomputes the expected scoring-delta columns from
 * each row's slot_answers via the pure buildShadowReport (src/lib/scoring-shadow.ts),
 * and prints coverage, drift, distributions, and anomalies. Run this after the
 * backfill and require it green before any surface reads the new columns.
 *
 * SAFETY:
 *   - No writes at all (no --commit flag exists).
 *   - Refuses to run against any project other than prod (ssxryjxifwiivghglqer),
 *     guarding the trap that .env.local points at the OLD project.
 *
 * Usage:
 *   SUPABASE_URL=https://ssxryjxifwiivghglqer.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<prod service role key> \
 *   npx tsx scripts/read-shadow-scoring-delta.ts
 */
import { readFileSync } from 'fs';

// Inline dotenv (matches scripts/regen-brief-html.ts). Real env vars win.
try {
  const raw = readFileSync('.env.local', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
} catch {
  /* no .env.local; rely on real env vars */
}

import { createClient } from '@supabase/supabase-js';
import { buildShadowReport, SHADOW_COLUMNS, type ShadowRow } from '../src/lib/scoring-shadow';

const PROD_REF = 'ssxryjxifwiivghglqer';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}
if (!url.includes(PROD_REF)) {
  console.error(`Refusing to run: resolved Supabase URL does not target prod (${PROD_REF}).`);
  console.error(`  resolved: ${url}`);
  console.error('  .env.local is known to point at the OLD project. Export the prod URL + key explicitly.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  const rows: ShadowRow[] = [];
  let from = 0;
  const page = 500;
  for (;;) {
    const { data, error } = await supabase
      .from('screened_leads')
      .select(
        'id, firm_id, matter_type, band, slot_answers, score_confidence, score_completeness, ' +
          'score_explanation, score_missing_fields, field_provenance, score_version, calibration_version',
      )
      .order('id', { ascending: true })
      .range(from, from + page - 1);
    if (error) {
      console.error('Fetch failed:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as ShadowRow[]));
    if (data.length < page) break;
    from += page;
  }

  const r = buildShadowReport(rows);

  console.log(`\n=== Scoring-delta read-shadow (prod ${PROD_REF}) ===`);
  console.log(`Total rows: ${r.totalRows}   Scanned (in-scope, banded, parseable): ${r.scanned}`);

  console.log(`\nSkipped / quarantined: ${r.skipped.length}`);
  for (const [reason, n] of Object.entries(r.skippedByReason)) console.log(`  ${reason}: ${n}`);

  console.log('\nColumn population (over all rows):');
  for (const col of SHADOW_COLUMNS) {
    const p = r.columnPopulation[col];
    console.log(`  ${col.padEnd(22)} populated=${p.populated}  null=${p.nulls}`);
  }

  console.log(`\nConfidence distribution (freshly computed): ${JSON.stringify(r.confidenceDistribution)}`);
  console.log(`Completeness (freshly computed): ${r.completeness ? JSON.stringify(r.completeness) : 'n/a'}`);
  console.log(`Missing-field count distribution: ${JSON.stringify(r.missingFieldDistribution)}`);

  console.log(`\nVersion anomalies (score_version not in {null,1} or calibration_version not null): ${r.versionAnomalies.length}`);
  for (const a of r.versionAnomalies) console.log(`  ${a.id}: score_version=${a.score_version} calibration_version=${a.calibration_version}`);

  console.log(`\nParity mismatches (persisted differs from freshly computed): ${r.mismatches.length}`);
  for (const m of r.mismatches) {
    console.log(`  ${m.id}  ${m.field}:  persisted=${JSON.stringify(m.persisted)}  expected=${JSON.stringify(m.expected)}`);
  }

  const green = r.mismatches.length === 0 && r.versionAnomalies.length === 0;
  console.log(`\nREAD-SHADOW: ${green ? 'GREEN (no drift, no version anomalies)' : 'NOT GREEN (investigate above before any surface reads these columns)'}`);
  if (!green) process.exit(2);
})();
