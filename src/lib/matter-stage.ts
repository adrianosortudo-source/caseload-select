/**
 * Data-access helpers for client_matters and matter_stage_events.
 *
 * Imports `supabaseAdmin` — uses the service-role key. Routes that call
 * these helpers MUST enforce role / firm gating themselves; this file
 * trusts its callers.
 */

import { supabaseAdmin as supabase } from './supabase-admin';
import type {
  ClientMatter,
  MatterStage,
  MatterStageEvent,
} from './types';
import { validateStageTransition, journeyTriggerForTransition } from './matter-stage-pure';
import { triggerSequence, type TriggerEvent } from './sequence-engine';
import { buildWelcomeDraft } from './welcome-draft-pure';
import { resolveMatterLead, resolveMatterAssignees } from './firm-routing-pure';

/**
 * Create a new client_matters row from a Band A take. Snapshots
 * routing config (default_lead + default_assignees) from the firm
 * row so subsequent config changes do not retroactively re-route the
 * matter.
 *
 * Returns the inserted row, or null with an error message on failure.
 * Idempotent: if a matter already exists for this screened_lead_id,
 * returns the existing row instead of inserting a duplicate (the DB
 * has a unique index that would reject the duplicate anyway).
 */
export async function createMatterFromBandATake(input: {
  firm_id: string;
  source_screened_lead_id: string;
  matter_type: string;
  practice_area: string;
  primary_name: string;
  primary_email: string | null;
  primary_phone: string | null;
}): Promise<{ ok: true; matter: ClientMatter } | { ok: false; error: string }> {
  // Contact-doctrine guard: a matter cannot be created without a way
  // to reach the client. This mirrors DR-038 at the matter layer.
  if (!input.primary_email && !input.primary_phone) {
    return {
      ok: false,
      error: 'contact-doctrine: matter requires primary_email or primary_phone',
    };
  }

  // Idempotency: check for an existing matter sourced from this lead.
  const { data: existing } = await supabase
    .from('client_matters')
    .select('*')
    .eq('source_screened_lead_id', input.source_screened_lead_id)
    .maybeSingle();
  if (existing) {
    return { ok: true, matter: existing as ClientMatter };
  }

  // Resolve routing snapshot from firm config.
  const { data: firm } = await supabase
    .from('intake_firms')
    .select('name, default_lead_id, default_lead_by_practice_area, default_assignees')
    .eq('id', input.firm_id)
    .maybeSingle();

  // Routing resolution shares one source of truth with the operator routing
  // admin UI (lib/firm-routing-pure.ts) so the UI's "what happens now" preview
  // matches what a real take produces.
  const leadId = resolveMatterLead(firm, input.practice_area);
  const assigneeIds = resolveMatterAssignees(firm);

  // Welcome draft (Story 8). Built at matter creation so the lawyer
  // sees a draft on the first open. Lead-lawyer identity is pulled
  // from firm_lawyers; falls back to firm name signature if unknown.
  let leadDisplayName: string | null = null;
  let leadTitle: string | null = null;
  if (leadId) {
    const { data: lawyer } = await supabase
      .from('firm_lawyers')
      .select('display_name, title, name')
      .eq('id', leadId)
      .maybeSingle();
    if (lawyer) {
      leadDisplayName = lawyer.display_name ?? lawyer.name ?? null;
      leadTitle = lawyer.title ?? null;
    }
  }
  const welcome = buildWelcomeDraft({
    primary_name: input.primary_name,
    matter_type: input.matter_type,
    practice_area: input.practice_area,
    firm_name: firm?.name ?? 'the firm',
    lead_lawyer_display_name: leadDisplayName,
    lead_lawyer_title: leadTitle,
    portal_url: null, // populated post-magic-link when Story 01 ships
  });

  const { data: inserted, error: insertErr } = await supabase
    .from('client_matters')
    .insert({
      firm_id: input.firm_id,
      source_screened_lead_id: input.source_screened_lead_id,
      lead_id: leadId,
      assignee_ids: assigneeIds,
      matter_stage: 'intake',
      matter_type: input.matter_type,
      practice_area: input.practice_area,
      primary_name: input.primary_name,
      primary_email: input.primary_email,
      primary_phone: input.primary_phone,
      welcome_draft_html: welcome.html,
      welcome_draft_plain_text: welcome.plain_text,
    })
    .select()
    .single();

  if (insertErr) {
    return { ok: false, error: `client_matters insert failed: ${insertErr.message}` };
  }

  // Initial stage event: null → intake
  await supabase.from('matter_stage_events').insert({
    matter_id: inserted.id,
    firm_id: input.firm_id,
    from_stage: null,
    to_stage: 'intake',
    actor_role: 'system',
    note: 'Matter created from Band A take',
  });

  return { ok: true, matter: inserted as ClientMatter };
}

/**
 * Transition a matter to a new stage. Validates the transition, writes
 * the row, writes the audit event, and fires the appropriate journey
 * cadence on the legacy `leads` table if there's a matching lead.
 *
 * The caller must have already enforced role permissions via
 * `canAdvanceStage`.
 */
export async function transitionMatterStage(input: {
  matter_id: string;
  to: MatterStage;
  actor_role: 'admin' | 'staff' | 'operator' | 'system';
  actor_id: string | null;
  note: string | null;
}): Promise<
  | { ok: true; from: MatterStage; to: MatterStage; event: MatterStageEvent }
  | { ok: false; error: string; code?: 'invalid_transition' | 'not_found' | 'db_error' }
> {
  const { data: matter, error: fetchErr } = await supabase
    .from('client_matters')
    .select('id, firm_id, matter_stage, source_screened_lead_id')
    .eq('id', input.matter_id)
    .maybeSingle();

  if (fetchErr) {
    return { ok: false, error: `matter fetch failed: ${fetchErr.message}`, code: 'db_error' };
  }
  if (!matter) {
    return { ok: false, error: 'matter not found', code: 'not_found' };
  }

  const from = matter.matter_stage as MatterStage;
  if (!validateStageTransition(from, input.to)) {
    return {
      ok: false,
      error: `invalid transition: ${from} → ${input.to}`,
      code: 'invalid_transition',
    };
  }

  const now = new Date().toISOString();
  const closedAt = input.to === 'closed' ? now : null;

  const { error: updateErr } = await supabase
    .from('client_matters')
    .update({
      matter_stage: input.to,
      matter_stage_changed_at: now,
      ...(closedAt ? { closed_at: closedAt } : {}),
    })
    .eq('id', input.matter_id);

  if (updateErr) {
    return { ok: false, error: `matter update failed: ${updateErr.message}`, code: 'db_error' };
  }

  const { data: event, error: eventErr } = await supabase
    .from('matter_stage_events')
    .insert({
      matter_id: input.matter_id,
      firm_id: matter.firm_id,
      from_stage: from,
      to_stage: input.to,
      actor_role: input.actor_role,
      actor_id: input.actor_id,
      note: input.note,
    })
    .select()
    .single();

  if (eventErr) {
    // Stage update succeeded but event log failed. Surface but don't
    // roll back — operational visibility is more important than
    // perfect audit trail.
    console.warn('[matter-stage] event log insert failed:', eventErr.message);
  }

  // Fire the journey cadence on the source lead, if there is one.
  const triggerEvent = journeyTriggerForTransition(from, input.to);
  if (triggerEvent && matter.source_screened_lead_id) {
    try {
      await triggerSequence(matter.source_screened_lead_id, triggerEvent as TriggerEvent);
    } catch (err) {
      console.warn('[matter-stage] journey trigger failed:', err);
    }
  }

  return {
    ok: true,
    from,
    to: input.to,
    event: (event ?? {}) as MatterStageEvent,
  };
}

/**
 * Fetch a matter by id with a service-role read. Caller enforces
 * row-level access (firm membership, role) before exposing.
 */
export async function getMatterById(matterId: string): Promise<ClientMatter | null> {
  const { data } = await supabase
    .from('client_matters')
    .select('*')
    .eq('id', matterId)
    .maybeSingle();
  return (data as ClientMatter) ?? null;
}

/**
 * List active matters for a firm, sorted by most recently updated
 * within each stage. Used by the lawyer-home active-clients panel.
 */
export async function listActiveMattersForFirm(
  firmId: string,
  options: { limit?: number } = {},
): Promise<ClientMatter[]> {
  const limit = options.limit ?? 50;
  const { data } = await supabase
    .from('client_matters')
    .select('*')
    .eq('firm_id', firmId)
    .neq('matter_stage', 'closed')
    .order('updated_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as ClientMatter[];
}
