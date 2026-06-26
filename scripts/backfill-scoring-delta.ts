/**
 * Backfill the screened_leads scoring-delta columns (Phase 1 expand phase,
 * migration 20260625_screened_leads_scoring_delta.sql). For each in-scope,
 * banded, firm-scoped row it computes computeScorePort from the stored
 * slot_answers (the serialized EngineState) and writes the column row produced
 * by scorePortToColumns.
 *
 * SAFETY:
 *   - DRY RUN by default. Pass --commit to actually write.
 *   - Refuses to run against any project other than prod (ssxryjxifwiivghglqer).
 *     This guards the known trap that .env.local points at the OLD project.
 *   - Idempotent (keyed on id) and forward-only (DR-059): re-running is safe.
 *   - Quarantines rows with null firm_id or null band (runbook section 7); they
 *     get no scoring delta and are reported, not written.
 *
 * Usage:
 *   # dry run (prints what it would write, changes nothing):
 *   SUPABASE_URL=https://ssxryjxifwiivghglqer.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<prod service role key> \
 *   npx tsx scripts/backfill-scoring-delta.ts
 *
 *   # commit:
 *   ... same env ... npx tsx scripts/backfill-scoring-delta.ts --commit
 *
 * After committing, run the read-shadow checks (runbook section 6) before any
 * surface reads these columns.
 */
import { readFileSync } from 'fs';

// Inline dotenv (matches scripts/regen-brief-html.ts). Real env vars win, so the
// operator can point at prod by exporting SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
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
import { computeScorePort } from '../src/lib/scoring-port';
import { scorePortToColumns } from '../src/lib/scoring-port-persistence';
import type { EngineState, Band } from '../src/lib/screen-engine/types';

const PROD_REF = 'ssxryjxifwiivghglqer';
// Prefer the operator-set SUPABASE_URL over NEXT_PUBLIC_SUPABASE_URL: .env.local
// carries a stale NEXT_PUBLIC_SUPABASE_URL pointing at the OLD project, and the
// inline dotenv above would otherwise let it win over the prod URL you export.
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const commit = process.argv.includes('--commit');

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

const SKIP_MATTER_TYPES = new Set(['out_of_scope', 'unknown']);
const supabase = createClient(url, key, { auth: { persistSession: false } });

(async () => {
  console.log(`Backfill scoring-delta (${commit ? 'COMMIT' : 'DRY RUN'}) against ${PROD_REF}`);
  let from = 0;
  const page = 500;
  let scanned = 0;
  let written = 0;
  const skipped: { id: string; reason: string }[] = [];

  for (;;) {
    const { data, error } = await supabase
      .from('screened_leads')
      .select('id, slot_answers, band, matter_type, firm_id')
      .order('id', { ascending: true })
      .range(from, from + page - 1);
    if (error) {
      console.error('Fetch failed:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      scanned += 1;
      if (!row.firm_id) {
        skipped.push({ id: row.id, reason: 'null firm_id (quarantine)' });
        continue;
      }
      if (SKIP_MATTER_TYPES.has(row.matter_type)) {
        skipped.push({ id: row.id, reason: `matter_type ${row.matter_type}` });
        continue;
      }
      if (!row.band) {
        skipped.push({ id: row.id, reason: 'null band' });
        continue;
      }

      const state = row.slot_answers as unknown as EngineState;
      const cols = scorePortToColumns(computeScorePort(state, row.band as Band));

      if (!commit) {
        console.log(
          `  ${row.id}  ${row.matter_type}  band=${row.band}  ` +
            `conf=${cols.score_confidence}  complete=${cols.score_completeness}  ` +
            `missing=${cols.score_missing_fields.length}`,
        );
        written += 1;
        continue;
      }

      const { error: updErr } = await supabase
        .from('screened_leads')
        .update({
          score_confidence: cols.score_confidence,
          score_completeness: cols.score_completeness,
          score_explanation: cols.score_explanation,
          score_missing_fields: cols.score_missing_fields,
          field_provenance: cols.field_provenance,
          score_version: cols.score_version,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (updErr) {
        console.error(`  UPDATE failed for ${row.id}:`, updErr.message);
        process.exit(1);
      }
      written += 1;
    }

    if (data.length < page) break;
    from += page;
  }

  console.log(`\nScanned ${scanned}. ${commit ? 'Wrote' : 'Would write'} ${written}. Skipped ${skipped.length}.`);
  for (const s of skipped) console.log(`  skip ${s.id}: ${s.reason}`);
  if (!commit) console.log('\nDRY RUN: nothing was written. Re-run with --commit to persist.');
})();
