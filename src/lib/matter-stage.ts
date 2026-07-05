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
import { checkStageGate } from './matter-stage-gate';
import {
  buildMatterStageChangedPayload,
  type MatterStageCadenceTrigger,
} from './ghl-webhook-pure';
import { deliverWebhook } from './ghl-webhook';
import { buildWelcomeDraft } from './welcome-draft-pure';
import { resolveMatterLead, resolveMatterAssignees } from './firm-routing-pure';
import { writePrimaryParty, writeActivity } from './crm-dual-write';

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

  // M1 canonical model dual-write (best-effort, never blocks the take).
  // The primary party captures the client contact on the same row shape
  // crm-dual-read.ts already reads first when populated.
  void writePrimaryParty({
    matterId: inserted.id,
    firmId: input.firm_id,
    fullName: input.primary_name,
    email: input.primary_email,
    phone: input.primary_phone,
  });
  void writeActivity({
    matterId: inserted.id,
    firmId: input.firm_id,
    activityType: 'promotion',
    title: 'Matter created',
    actorRole: 'system',
    metadata: { event_type: 'matter_created', source_screened_lead_id: input.source_screened_lead_id },
  });

  return { ok: true, matter: inserted as ClientMatter };
}

/**
 * Webhook enqueue outcome surfaced on a successful transition. Best-effort
 * relative to the stage write: the transition stands regardless, but the
 * caller can see whether the cadence event reached the outbox.
 */
export interface StageWebhookOutcome {
  enqueued: boolean;
  delivered: boolean;
  reason: string | null;
}

/**
 * Transition a matter to a new stage. Validates the transition, writes
 * the row, writes the audit event, and enqueues the `matter_stage_changed`
 * GHL webhook that carries the DR-049 journey cadence trigger.
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
  | {
      ok: true;
      from: MatterStage;
      to: MatterStage;
      event: MatterStageEvent;
      webhook?: StageWebhookOutcome | null;
    }
  | { ok: false; error: string; code?: 'invalid_transition' | 'not_found' | 'db_error' | 'gate_blocked' }
> {
  const { data: matter, error: fetchErr } = await supabase
    .from('client_matters')
    .select(
      'id, firm_id, matter_stage, source_screened_lead_id, matter_type, practice_area, primary_name, primary_email, primary_phone',
    )
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

  const gate = await checkStageGate(
    {
      id: matter.id,
      firm_id: matter.firm_id,
      source_screened_lead_id: matter.source_screened_lead_id ?? null,
      primary_name: matter.primary_name ?? null,
      primary_email: matter.primary_email ?? null,
      primary_phone: matter.primary_phone ?? null,
    },
    input.to,
  );
  if (!gate.allowed) {
    return { ok: false, error: gate.reason, code: 'gate_blocked' };
  }

  const now = new Date().toISOString();
  const closedAt = input.to === 'closed' ? now : null;

  const { data: updatedRows, error: updateErr } = await supabase
    .from('client_matters')
    .update({
      matter_stage: input.to,
      matter_stage_changed_at: now,
      ...(closedAt ? { closed_at: closedAt } : {}),
    })
    .eq('id', input.matter_id)
    .eq('matter_stage', from) // guard: only advance from the stage we validated
    .select('id');

  if (updateErr) {
    return { ok: false, error: `matter update failed: ${updateErr.message}`, code: 'db_error' };
  }
  if (!updatedRows || updatedRows.length === 0) {
    // The stage moved under us between the read and this write (concurrent
    // advance). Reject rather than double-advance and double-fire the cadence.
    return {
      ok: false,
      error: `matter stage changed concurrently; expected ${from}`,
      code: 'invalid_transition',
    };
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
    // Stage update succeeded but the audit row failed. We do not roll back the
    // stage (operational continuity), but elevate to console.error so the gap
    // is greppable/alertable rather than a quiet warn.
    console.error('[matter-stage] AUDIT GAP: event log insert failed:', eventErr.message);
  }

  // M1 canonical model dual-write (best-effort, never blocks the transition).
  void writeActivity({
    matterId: input.matter_id,
    firmId: matter.firm_id,
    activityType: 'stage_change',
    title: `Stage: ${from} to ${input.to}`,
    body: input.note,
    actorRole: input.actor_role,
    metadata: { from_stage: from, to_stage: input.to, actor_id: input.actor_id },
  });

  // DR-049 cadence map, GHL-owned execution (operator decision 2026-06-09,
  // CRM Bible section 12): GoHighLevel runs the journey cadences; Supabase
  // notifies it. This block used to call triggerSequence with the
  // screened_leads UUID, which the send processor resolved against the
  // legacy leads table, so every scheduled row was skipped and the cadence
  // map silently delivered nothing. Each transition now enqueues a
  // matter_stage_changed event through the at-least-once webhook_outbox,
  // the same path the five triage actions use:
  //
  //   intake → retainer_pending : retainer_awaiting (J6)
  //   retainer_pending → active : client_won (J7)
  //   active → closing          : review_request (J9)
  //   closing → closed          : relationship_milestone (J11 + J12)
  //
  // Until the operator builds the matching GHL workflows the events queue
  // and deliver harmlessly (workflow filters ignore unknown actions).
  const cadenceTrigger = journeyTriggerForTransition(from, input.to);
  let webhook: StageWebhookOutcome | null = null;
  if (cadenceTrigger) {
    // Resolve the source lead's public id + intake language so the envelope
    // correlates with the earlier `taken` event. Best-effort: a missing
    // source row falls back to the matter UUID and 'en'.
    let sourceLeadPublicId: string | null = null;
    let intakeLanguage: string | null = null;
    if (matter.source_screened_lead_id) {
      const { data: sourceLead } = await supabase
        .from('screened_leads')
        .select('lead_id, intake_language')
        .eq('id', matter.source_screened_lead_id)
        .maybeSingle();
      sourceLeadPublicId = sourceLead?.lead_id ?? null;
      intakeLanguage = sourceLead?.intake_language ?? null;
    }

    const payload = buildMatterStageChangedPayload({
      matterId: input.matter_id,
      firmId: matter.firm_id,
      sourceScreenedLeadId: matter.source_screened_lead_id ?? null,
      sourceLeadPublicId,
      intakeLanguage,
      fromStage: from,
      toStage: input.to,
      // journeyTriggerForTransition returns the DR-049 trigger names; the
      // cast narrows its string return to the payload's literal union.
      cadenceTrigger: cadenceTrigger as MatterStageCadenceTrigger,
      matterType: matter.matter_type,
      practiceArea: matter.practice_area,
      primaryName: matter.primary_name,
      primaryEmail: matter.primary_email,
      primaryPhone: matter.primary_phone,
      transitionedAt: new Date(now),
      actorRole: input.actor_role,
    });

    try {
      const delivery = await deliverWebhook(payload);
      webhook = {
        enqueued: Boolean(delivery.outbox_id),
        delivered: delivery.fired,
        reason: delivery.reason ?? null,
      };
      // A failed POST with an outbox row is fine (the retry cron owns it).
      // A failed ENQUEUE means nothing owns delivery, so it is loud. An
      // unconfigured webhook URL is the documented skip-silently case.
      if (!delivery.fired && !delivery.outbox_id && delivery.reason !== 'ghl_webhook_url not configured') {
        console.error(
          `[matter-stage] matter_stage_changed webhook enqueue failed for matter ${input.matter_id}:`,
          delivery.reason,
        );
      }
    } catch (err) {
      webhook = {
        enqueued: false,
        delivered: false,
        reason: err instanceof Error ? err.message : String(err),
      };
      console.error(
        `[matter-stage] matter_stage_changed webhook enqueue threw for matter ${input.matter_id}:`,
        err,
      );
    }
  }

  return {
    ok: true,
    from,
    to: input.to,
    event: (event ?? {}) as MatterStageEvent,
    webhook,
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
