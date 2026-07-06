import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type {
  AgencyProspect, ProspectInput, ProspectPatch,
  AgencyDeal, DealInput, DealPatch,
  AgencyReminder, ReminderInput, ReminderPatch,
  ProspectStage,
} from '@/lib/agency-crm-types';

/**
 * Agency CRM (Layer B): the operator's own pipeline for selling CaseLoad Select.
 * Single-tenant, operator-only. Service-role access only (RLS-locked tables).
 * Schema: supabase/migrations/20260625_agency_crm.sql. Types: agency-crm-types.ts.
 */

export * from '@/lib/agency-crm-types';
// DUPLICATE_PROSPECT_MESSAGE (agency-crm-types.ts, re-exported above): thrown
// by createProspect/updateProspect on a 23505 from the dedupe_key constraint;
// the prospect routes map that exact message to a 409.
import { DUPLICATE_PROSPECT_MESSAGE } from '@/lib/agency-crm-types';

// ── Prospects ─────────────────────────────────────────────────────────────────

// The kanban surface groups EVERY prospect into stage columns, so it needs the
// full set, not a page. A bare .select() is silently capped by PostgREST at
// the project max-rows (~1000), so with 5,648 seeded prospects ~4,600 were
// invisible in the UI (Codex audit 2026-07-07, finding 4). listProspects now
// range-pages to completion up to a hard ceiling; listProspectsPage below is
// the bounded, counted, searchable variant for API consumers.
const LIST_PAGE_SIZE = 1000;
const LIST_HARD_CAP = 20000; // safety ceiling, well above the seeded workload

export async function listProspects(stage?: ProspectStage): Promise<AgencyProspect[]> {
  const all: AgencyProspect[] = [];
  for (let offset = 0; offset < LIST_HARD_CAP; offset += LIST_PAGE_SIZE) {
    let q = supabase
      .from('agency_prospects')
      .select('*')
      // Secondary sort on id gives a total order so range paging never skips
      // or duplicates rows that share updated_at at a page boundary.
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + LIST_PAGE_SIZE - 1);
    if (stage) q = q.eq('stage', stage);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as AgencyProspect[];
    all.push(...rows);
    if (rows.length < LIST_PAGE_SIZE) break; // short page => last page
  }
  return all;
}

export interface ProspectPageOptions {
  stage?: ProspectStage;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export interface ProspectPage {
  items: AgencyProspect[];
  total: number;
  limit: number;
  offset: number;
}

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;

/**
 * A single bounded, counted page of prospects with optional stage filter and
 * server-side search over firm_name, city, and practice_area. Returns the
 * exact total (via head count) so a caller can build real pagination instead
 * of guessing at PostgREST's silent window.
 */
export async function listProspectsPage(opts: ProspectPageOptions = {}): Promise<ProspectPage> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_PAGE_LIMIT), 1), MAX_PAGE_LIMIT);
  const offset = Math.max(Math.trunc(opts.offset ?? 0), 0);

  let q = supabase
    .from('agency_prospects')
    .select('*', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);

  if (opts.stage) q = q.eq('stage', opts.stage);

  const search = (opts.search ?? '').trim();
  if (search) {
    // Operator-supplied (route is operator-gated), but still neutralize the
    // PostgREST or-filter metacharacters so the term can't break out of the
    // filter grammar. Replacing with spaces keeps a sensible substring match.
    const safe = search.replace(/[%,()]/g, ' ');
    q = q.or(`firm_name.ilike.%${safe}%,city.ilike.%${safe}%,practice_area.ilike.%${safe}%`);
  }

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { items: (data ?? []) as AgencyProspect[], total: count ?? 0, limit, offset };
}

export async function createProspect(input: ProspectInput): Promise<AgencyProspect> {
  const row = {
    firm_name: input.firm_name,
    contact_name: input.contact_name ?? null,
    contact_email: input.contact_email ?? null,
    contact_phone: input.contact_phone ?? null,
    city: input.city ?? null,
    practice_area: input.practice_area ?? null,
    source: input.source ?? null,
    stage: input.stage ?? 'new',
    fit_score: input.fit_score ?? null,
    notes: input.notes ?? null,
  };
  const { data, error } = await supabase.from('agency_prospects').insert(row).select('*').single();
  if (error) {
    // 23505 here is the dedupe_key constraint: before 2026-07-06 this path
    // silently allowed duplicates; now the DB blocks them, so surface a
    // clean message the route can 409 instead of the raw constraint error.
    if (error.code === '23505') throw new Error(DUPLICATE_PROSPECT_MESSAGE);
    throw new Error(error.message);
  }
  return data as AgencyProspect;
}

export async function updateProspect(id: string, patch: ProspectPatch): Promise<AgencyProspect | null> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fields: (keyof ProspectInput)[] = [
    'firm_name', 'contact_name', 'contact_email', 'contact_phone', 'city',
    'practice_area', 'source', 'stage', 'fit_score', 'notes',
  ];
  for (const f of fields) if (f in patch) update[f] = patch[f];
  // maybeSingle: an update that matches no row resolves to data:null (not an error),
  // so the route can return 404 instead of a generic 500.
  const { data, error } = await supabase.from('agency_prospects').update(update).eq('id', id).select('*').maybeSingle();
  if (error) {
    // Renaming a prospect's firm_name/city onto an existing prospect's key
    // now collides with the dedupe_key constraint; same clean 409 surfacing
    // as createProspect.
    if (error.code === '23505') throw new Error(DUPLICATE_PROSPECT_MESSAGE);
    throw new Error(error.message);
  }
  return (data as AgencyProspect | null) ?? null;
}

// ── Deals ───────────────────────────────────────────────────────────────────────
export async function listDeals(prospectId?: string): Promise<AgencyDeal[]> {
  let q = supabase.from('agency_deals').select('*').order('updated_at', { ascending: false });
  if (prospectId) q = q.eq('prospect_id', prospectId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as AgencyDeal[];
}

export async function createDeal(input: DealInput): Promise<AgencyDeal> {
  const row = {
    prospect_id: input.prospect_id,
    title: input.title,
    stage: input.stage ?? 'proposal',
    monthly_value: input.monthly_value ?? null,
    expected_close: input.expected_close ?? null,
    notes: input.notes ?? null,
  };
  const { data, error } = await supabase.from('agency_deals').insert(row).select('*').single();
  if (error) throw new Error(error.message);
  return data as AgencyDeal;
}

export async function updateDeal(id: string, patch: DealPatch): Promise<AgencyDeal | null> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fields: (keyof DealPatch)[] = ['title', 'stage', 'monthly_value', 'expected_close', 'notes'];
  for (const f of fields) if (f in patch) update[f] = patch[f];
  const { data, error } = await supabase.from('agency_deals').update(update).eq('id', id).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AgencyDeal | null) ?? null;
}

// ── Reminders ─────────────────────────────────────────────────────────────────
export async function listReminders(opts?: { openOnly?: boolean; prospectId?: string }): Promise<AgencyReminder[]> {
  let q = supabase.from('agency_reminders').select('*').order('due_at', { ascending: true });
  if (opts?.openOnly) q = q.eq('done', false);
  if (opts?.prospectId) q = q.eq('prospect_id', opts.prospectId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as AgencyReminder[];
}

export async function createReminder(input: ReminderInput): Promise<AgencyReminder> {
  const row = {
    prospect_id: input.prospect_id ?? null,
    deal_id: input.deal_id ?? null,
    due_at: input.due_at,
    note: input.note,
    done: false,
  };
  const { data, error } = await supabase.from('agency_reminders').insert(row).select('*').single();
  if (error) throw new Error(error.message);
  return data as AgencyReminder;
}

export async function updateReminder(id: string, patch: ReminderPatch): Promise<AgencyReminder | null> {
  const update: Record<string, unknown> = {};
  if ('due_at' in patch) update.due_at = patch.due_at;
  if ('note' in patch) update.note = patch.note;
  if ('done' in patch) update.done = patch.done;
  const { data, error } = await supabase.from('agency_reminders').update(update).eq('id', id).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AgencyReminder | null) ?? null;
}
