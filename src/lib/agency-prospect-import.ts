import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { isProspectStage, type ProspectInput } from '@/lib/agency-crm-types';

/**
 * Agency CRM (Layer B): bulk prospect import.
 *
 * Feeds the operator's pipeline from external prospect data (the
 * `07_Prospects/toronto_law_firms_export.json` corpus, Outscraper exports, or
 * any CSV converted to rows). Service-role only, like the rest of agency-crm.ts.
 *
 * Dedupe is by (lower(firm_name), lower(city)) against existing rows AND within
 * the batch, so re-running an import is idempotent and overlapping sources do
 * not create duplicate prospects.
 */

export interface ImportResult {
  ok: boolean;        // false when any insert chunk failed (partial import)
  received: number;   // raw rows handed in
  inserted: number;   // new prospects written
  skipped: number;    // valid rows that duplicate an existing/earlier prospect
  invalid: number;    // rows dropped for a missing firm_name
  errors: string[];   // insert-chunk errors, if any
}

/** Dedupe key: a firm is the same prospect if name + city match, case-insensitively. */
export function prospectKey(firmName: string, city?: string | null): string {
  return `${firmName.trim().toLowerCase()}|${(city ?? '').trim().toLowerCase()}`;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Coerce a raw row into a clean ProspectInput, or null when it has no firm_name. */
export function sanitizeRow(raw: unknown): ProspectInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const firm_name = typeof r.firm_name === 'string' ? r.firm_name.trim() : '';
  if (!firm_name) return null;
  const fit = r.fit_score;
  const fit_score =
    typeof fit === 'number' && Number.isFinite(fit) && fit >= 0 && fit <= 100 ? Math.round(fit) : null;
  return {
    firm_name,
    contact_name: str(r.contact_name),
    contact_email: str(r.contact_email),
    contact_phone: str(r.contact_phone),
    city: str(r.city),
    practice_area: str(r.practice_area),
    source: str(r.source) ?? 'import',
    stage: isProspectStage(r.stage) ? r.stage : undefined,
    fit_score,
    notes: str(r.notes),
  };
}

const INSERT_CHUNK = 500;

export async function importProspects(rawRows: unknown[]): Promise<ImportResult> {
  const received = rawRows.length;
  const errors: string[] = [];

  const valid: ProspectInput[] = [];
  let invalid = 0;
  for (const raw of rawRows) {
    const row = sanitizeRow(raw);
    if (!row) { invalid++; continue; }
    valid.push(row);
  }

  // In-batch dedupe only. Cross-run dedupe (a re-import seeing rows already in
  // the table) is now enforced by the DB's uq_agency_prospects_dedupe_key
  // constraint via upsert+ignoreDuplicates below (Codex audit 2026-07-06,
  // finding 4): the prior approach read every existing (firm_name, city) with
  // one unpaginated select, which only sees PostgREST's first page once the
  // table passes the default max-rows cap (agency_prospects has 5648 rows in
  // prod today), so a re-import could already be inserting duplicates for any
  // key outside that first page.
  let skippedInBatch = 0;
  const seenInBatch = new Set<string>();
  const toInsert: ProspectInput[] = [];
  for (const row of valid) {
    const key = prospectKey(row.firm_name, row.city);
    if (seenInBatch.has(key)) { skippedInBatch++; continue; }
    seenInBatch.add(key);
    toInsert.push(row);
  }

  let inserted = 0;
  let skippedByConstraint = 0;
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    const slice = toInsert.slice(i, i + INSERT_CHUNK).map((r) => ({
      firm_name: r.firm_name,
      contact_name: r.contact_name ?? null,
      contact_email: r.contact_email ?? null,
      contact_phone: r.contact_phone ?? null,
      city: r.city ?? null,
      practice_area: r.practice_area ?? null,
      source: r.source ?? 'import',
      stage: r.stage ?? 'new',
      fit_score: r.fit_score ?? null,
      notes: r.notes ?? null,
    }));
    // dedupe_key is a generated column (lower/trim of firm_name + city); never
    // sent on the payload. ignoreDuplicates makes a row that collides with an
    // existing prospect a no-op instead of a 23505 error; .select('id') then
    // returns only the rows that were actually inserted, so the gap between
    // slice.length and the returned count is exactly how many the constraint
    // skipped.
    const { data, error } = await supabase
      .from('agency_prospects')
      .upsert(slice, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      .select('id');
    if (error) { errors.push(error.message); continue; }
    const returnedCount = (data ?? []).length;
    inserted += returnedCount;
    skippedByConstraint += slice.length - returnedCount;
  }

  const skipped = skippedInBatch + skippedByConstraint;
  return { ok: errors.length === 0, received, inserted, skipped, invalid, errors };
}
