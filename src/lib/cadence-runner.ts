/**
 * Cadence engine runner (I/O shell). SHADOW MODE.
 *
 * Reads the DB, drives the pure evaluator (cadence-rules-pure.ts), evaluates
 * the CASL send gate (comms-gate.ts, H5), and writes what it WOULD send into
 * outbound_messages with shadow = true. It dispatches NOTHING: no Resend call,
 * no GHL change. GHL keeps running the real cadences for DRG. This exists so an
 * operator can later diff the shadow ledger against GHL's actual sends before
 * any cutover is discussed (CaseLoad_CRM_Migration_Plan_v1.md Phase 2).
 *
 * Two passes each tick:
 *   1. ENROLL  scan matter_stage_events; each transition that maps to a
 *              cadence_trigger (journeyTriggerForTransition) enrolls its matter
 *              into the matching rule. Idempotent via uq_cadence_runs_key_matter.
 *   2. ADVANCE for each active run, log every due step's would-be send (shadow),
 *              record the consent verdict, and advance the run. Idempotent via
 *              uq_outbound_messages_run_step.
 *
 * Fail-closed on consent: a matter with no resolvable screened_lead consent
 * state is treated as blocked, not allowed. Over-logging in shadow is harmless
 * (nothing dispatches); under-recording a block would be the real hazard.
 *
 * Deliberately NO stage-based early exit in this first brick. In shadow mode an
 * extra logged touch dispatches nothing, and the shadow-vs-GHL diff is what
 * surfaces missing exit conditions. Per-journey exit rules (e.g. J6 exits when
 * the retainer is signed) are a typed followup, not a place to risk suppressing
 * a real touch on a wrong guess.
 *
 * No `import 'server-only'`: the route that calls this has its own vitest test,
 * and server-only throws when the test loads the module (repo gotcha).
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { journeyTriggerForTransition } from '@/lib/matter-stage-pure';
import type { MatterStage } from '@/lib/types';
import { isConsentGated, consentBlockReason, type LeadConsentState } from '@/lib/comms-gate';
import { isRealSendEnabledForFirm } from '@/lib/cadence-dispatch';
import {
  resolveRuleForFirm,
  matchesFieldChangeTrigger,
  computeStepScheduledAt,
  dueSteps,
  lastStepNumber,
  interpolateTemplate,
  shouldExitRun,
  type CadenceRule,
  type CadenceStep,
  type CadenceRun,
} from '@/lib/cadence-rules-pure';

export interface CadenceRunSummary {
  ok: boolean;
  applied: boolean; // false when the cadence tables do not exist yet (pre-migration)
  reason?: string;
  enrolled: number;
  runs_advanced: number;
  shadow_logged: number;
  suppressed: number;
  completed: number;
  exited: number;
}

interface StageEventRow {
  matter_id: string;
  firm_id: string;
  from_stage: string | null;
  to_stage: string;
  created_at: string;
}

interface MatterRow {
  id: string;
  firm_id: string;
  matter_stage: string;
  primary_name: string | null;
  primary_email: string | null;
  matter_type: string | null;
  source_screened_lead_id: string | null;
}

interface LeadRow {
  id: string;
  firm_id: string;
  status: string;
  contact_email: string | null;
  contact_name: string | null;
  matter_type: string | null;
  email_consent_status: string | null;
  sms_consent_status: string | null;
  six_month_expiry_date: string | null;
  updated_at: string;
}

const NO_SUMMARY: CadenceRunSummary = {
  ok: true, applied: false, enrolled: 0, runs_advanced: 0,
  shadow_logged: 0, suppressed: 0, completed: 0, exited: 0,
};

function isUndefinedTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01') return true;
  return /relation .* does not exist|does not exist/i.test(err.message ?? '');
}

function firstName(fullName: string | null): string {
  if (!fullName) return 'there';
  const token = fullName.trim().split(/\s+/)[0];
  return token || 'there';
}

function cleanFirmName(name: string | null): string {
  if (!name) return 'the firm';
  return name.replace(/\s+Professional Corporation\s*$/i, '').replace(/\s+Test$/i, '').trim() || 'the firm';
}

function humanizeMatterType(matterType: string | null): string {
  if (!matterType) return 'matter';
  return matterType.replace(/_/g, ' ');
}

/**
 * Run one tick of the shadow cadence engine.
 *
 * @param opts.now     Reference time (inject in tests). Defaults to now.
 * @param opts.firmId  Optional firm scope. Omit to run all firms.
 */
export async function runCadenceEngine(
  opts: { now?: Date; firmId?: string } = {},
): Promise<CadenceRunSummary> {
  const now = opts.now ?? new Date();
  const firmScope = opts.firmId ?? null;

  // ── Load the rule library (guards table existence) ───────────────────────
  // exit_config MUST be in this select: the audit (2026-07-05) found it
  // missing, which made shouldExitRun always see undefined and the J6 exit
  // condition never fire. A test pins this column list now.
  const { data: ruleRows, error: ruleErr } = await supabase
    .from('cadence_rules')
    .select('id, firm_id, cadence_key, name, trigger_type, trigger_config, exit_config, channel, enabled');
  if (ruleErr) {
    if (isUndefinedTable(ruleErr)) return { ...NO_SUMMARY, reason: 'cadence tables not applied' };
    return { ...NO_SUMMARY, applied: true, ok: false, reason: ruleErr.message };
  }
  const rules = (ruleRows ?? []) as CadenceRule[];

  const { data: stepRows, error: stepErr } = await supabase
    .from('cadence_steps')
    .select('id, cadence_rule_id, step_number, delay_hours, channel, subject_template, body_template, active');
  if (stepErr) return { ...NO_SUMMARY, applied: true, ok: false, reason: stepErr.message };
  const steps = (stepRows ?? []) as CadenceStep[];

  const summary: CadenceRunSummary = {
    ok: true, applied: true, enrolled: 0, runs_advanced: 0,
    shadow_logged: 0, suppressed: 0, completed: 0, exited: 0,
  };

  // ── Pass 1: ENROLL from stage events ─────────────────────────────────────
  // DESCENDING order (audit fix 2026-07-05): with ascending order and a 2000
  // row cap, the scan would return the 2000 OLDEST events forever once the
  // table outgrew the cap, so exactly the new transitions that still need
  // enrollment would become invisible. Newest-first keeps every fresh
  // transition in the window; re-scanning already-enrolled events is a no-op
  // via the enrollment unique constraints.
  let eventQuery = supabase
    .from('matter_stage_events')
    .select('matter_id, firm_id, from_stage, to_stage, created_at')
    .order('created_at', { ascending: false })
    .limit(2000);
  if (firmScope) eventQuery = eventQuery.eq('firm_id', firmScope);
  const { data: eventRows } = await eventQuery;
  const events = (eventRows ?? []) as StageEventRow[];

  // Resolve the source screened_lead per matter for enrollment (best-effort).
  const enrollMatterIds = Array.from(new Set(events.map((e) => e.matter_id)));
  const matterById = new Map<string, MatterRow>();
  if (enrollMatterIds.length > 0) {
    const { data: matterRows } = await supabase
      .from('client_matters')
      .select('id, firm_id, matter_stage, primary_name, primary_email, matter_type, source_screened_lead_id')
      .in('id', enrollMatterIds);
    for (const m of (matterRows ?? []) as MatterRow[]) matterById.set(m.id, m);
  }

  const enrollRows: Array<{
    firm_id: string; cadence_rule_id: string; cadence_key: string;
    matter_id: string; screened_lead_id: string | null; anchor_at: string;
  }> = [];

  for (const ev of events) {
    const trigger = journeyTriggerForTransition(
      (ev.from_stage ?? 'intake') as MatterStage,
      ev.to_stage as MatterStage,
    );
    if (!trigger) continue;
    // Fan out to every DISTINCT cadence_key whose trigger matches this event
    // (e.g. J7 and J8 both fire on the retainer_pending -> active transition).
    // resolveRuleForFirm still applies firm-override-over-global per key.
    const matchingCadenceKeys = new Set(
      rules
        .filter((r) => matchesFieldChangeTrigger(r, trigger) && (r.firm_id === ev.firm_id || r.firm_id === null))
        .map((r) => r.cadence_key),
    );
    if (matchingCadenceKeys.size === 0) continue;
    const matter = matterById.get(ev.matter_id);
    for (const cadenceKey of matchingCadenceKeys) {
      const resolved = resolveRuleForFirm(rules, ev.firm_id, cadenceKey);
      if (!resolved) continue;
      // Audit fix (2026-07-05): the key set above can be satisfied by the
      // GLOBAL rule while resolveRuleForFirm swaps in a firm override whose
      // own trigger differs. Enroll only when the RESOLVED rule's trigger
      // matches this event; a firm that overrode a cadence onto a different
      // trigger must not be enrolled on the global's trigger.
      if (!matchesFieldChangeTrigger(resolved, trigger)) continue;
      enrollRows.push({
        firm_id: ev.firm_id,
        cadence_rule_id: resolved.id,
        cadence_key: resolved.cadence_key,
        matter_id: ev.matter_id,
        screened_lead_id: matter?.source_screened_lead_id ?? null,
        anchor_at: ev.created_at,
      });
    }
  }

  if (enrollRows.length > 0) {
    // ignoreDuplicates: uq_cadence_runs_key_matter makes re-enrollment a no-op.
    const { data: inserted, error: enrollErr } = await supabase
      .from('cadence_runs')
      .upsert(enrollRows, { onConflict: 'cadence_key,matter_id', ignoreDuplicates: true })
      .select('id');
    if (enrollErr) {
      // Audit fix (2026-07-05): this error was previously swallowed, which is
      // exactly how the 42P10 partial-index defect stayed invisible (the tick
      // reported ok:true while enrolling nothing). Surface it.
      console.error('[cadence-runner] matter enrollment upsert failed', { error: enrollErr.message });
      summary.ok = false;
      summary.reason = `matter enrollment failed: ${enrollErr.message}`;
    } else if (inserted) {
      summary.enrolled += inserted.length;
    }
  }

  // ── Pass 1b: ENROLL from screened_leads status flips (lead-only cadences) ─
  // A rule can be sourced from screened_leads instead of matter_stage_events
  // when trigger_config.source === 'screened_leads_status' (e.g. J10
  // re-engagement: a passed lead never becomes a client_matters row, so there
  // is no stage event to enroll off).
  const leadSourcedRules = rules.filter(
    (r) => r.enabled
      && r.trigger_type === 'field_change'
      && r.trigger_config['source'] === 'screened_leads_status'
      && typeof r.trigger_config['status'] === 'string',
  );
  if (leadSourcedRules.length > 0) {
    const statuses = Array.from(new Set(leadSourcedRules.map((r) => r.trigger_config['status'] as string)));
    let leadQuery = supabase
      .from('screened_leads')
      .select('id, firm_id, status, updated_at')
      .in('status', statuses)
      .limit(2000);
    if (firmScope) leadQuery = leadQuery.eq('firm_id', firmScope);
    const { data: statusLeadRows } = await leadQuery;
    const statusLeads = (statusLeadRows ?? []) as Array<{ id: string; firm_id: string; status: string; updated_at: string }>;

    const leadEnrollRows: Array<{
      firm_id: string; cadence_rule_id: string; cadence_key: string;
      matter_id: null; screened_lead_id: string; anchor_at: string;
    }> = [];

    for (const lead of statusLeads) {
      const matchingCadenceKeys = new Set(
        leadSourcedRules
          .filter((r) => r.trigger_config['status'] === lead.status && (r.firm_id === lead.firm_id || r.firm_id === null))
          .map((r) => r.cadence_key),
      );
      for (const cadenceKey of matchingCadenceKeys) {
        const resolved = resolveRuleForFirm(rules, lead.firm_id, cadenceKey);
        if (!resolved) continue;
        // Audit fix (2026-07-05), same shape as the stage pass: the resolved
        // rule (possibly a firm override) must itself be lead-status-sourced
        // with a matching status, not merely share a cadence_key with a
        // global rule that matched.
        if (resolved.trigger_config['source'] !== 'screened_leads_status'
          || resolved.trigger_config['status'] !== lead.status) continue;
        leadEnrollRows.push({
          firm_id: lead.firm_id,
          cadence_rule_id: resolved.id,
          cadence_key: resolved.cadence_key,
          matter_id: null,
          screened_lead_id: lead.id,
          anchor_at: lead.updated_at,
        });
      }
    }

    if (leadEnrollRows.length > 0) {
      // ignoreDuplicates: uq_cadence_runs_key_lead makes re-enrollment a no-op.
      const { data: inserted, error: leadEnrollErr } = await supabase
        .from('cadence_runs')
        .upsert(leadEnrollRows, { onConflict: 'cadence_key,screened_lead_id', ignoreDuplicates: true })
        .select('id');
      if (leadEnrollErr) {
        console.error('[cadence-runner] lead enrollment upsert failed', { error: leadEnrollErr.message });
        summary.ok = false;
        summary.reason = `lead enrollment failed: ${leadEnrollErr.message}`;
      } else if (inserted) {
        summary.enrolled += inserted.length;
      }
    }
  }

  // ── Pass 2: ADVANCE active runs ──────────────────────────────────────────
  let runQuery = supabase
    .from('cadence_runs')
    .select('id, firm_id, cadence_rule_id, cadence_key, matter_id, screened_lead_id, anchor_at, status, next_step_number')
    .eq('status', 'active')
    .limit(2000);
  if (firmScope) runQuery = runQuery.eq('firm_id', firmScope);
  const { data: runRows } = await runQuery;
  const runs = (runRows ?? []) as CadenceRun[];
  if (runs.length === 0) return summary;

  // Batch-load the matters + leads + firms these runs reference.
  const runMatterIds = Array.from(new Set(runs.map((r) => r.matter_id).filter((x): x is string => !!x)));
  for (const id of runMatterIds) {
    if (!matterById.has(id)) {
      const { data: m } = await supabase
        .from('client_matters')
        .select('id, firm_id, matter_stage, primary_name, primary_email, matter_type, source_screened_lead_id')
        .eq('id', id)
        .maybeSingle();
      if (m) matterById.set(id, m as MatterRow);
    }
  }

  const leadIds = Array.from(new Set(runs.map((r) => r.screened_lead_id).filter((x): x is string => !!x)));
  const leadById = new Map<string, LeadRow>();
  if (leadIds.length > 0) {
    const { data: leadRows } = await supabase
      .from('screened_leads')
      .select('id, firm_id, status, contact_email, contact_name, matter_type, email_consent_status, sms_consent_status, six_month_expiry_date, updated_at')
      .in('id', leadIds);
    for (const l of (leadRows ?? []) as LeadRow[]) leadById.set(l.id, l);
  }

  const firmIds = Array.from(new Set(runs.map((r) => r.firm_id)));
  const firmNameById = new Map<string, string>();
  const firmRealSendById = new Map<string, boolean>();
  const firmReviewUrlById = new Map<string, string>();
  if (firmIds.length > 0) {
    const { data: firmRows } = await supabase.from('intake_firms').select('id, name, cadence_real_send, gbp_review_url').in('id', firmIds);
    for (const f of (firmRows ?? []) as Array<{ id: string; name: string | null; cadence_real_send: boolean | null; gbp_review_url: string | null }>) {
      firmNameById.set(f.id, cleanFirmName(f.name));
      firmRealSendById.set(f.id, f.cadence_real_send === true);
      firmReviewUrlById.set(f.id, f.gbp_review_url ?? '');
    }
  }

  const ruleById = new Map<string, CadenceRule>(rules.map((r) => [r.id, r]));

  for (const run of runs) {
    const matter = run.matter_id ? matterById.get(run.matter_id) : undefined;
    const lead = run.screened_lead_id ? leadById.get(run.screened_lead_id) : undefined;

    // Evaluate exit condition before touching this run's steps. Only
    // matter-anchored runs can exit on stage; lead-only runs (no matter_id)
    // never exit via this mechanism.
    const rule = ruleById.get(run.cadence_rule_id);
    const exitVerdict = shouldExitRun(rule?.exit_config, matter?.matter_stage ?? null);
    if (exitVerdict.exit) {
      summary.exited += 1;
      await supabase
        .from('cadence_runs')
        .update({ status: 'exited', exit_reason: exitVerdict.reason, updated_at: now.toISOString() })
        .eq('id', run.id);
      continue;
    }

    const runSteps = steps.filter((s) => s.cadence_rule_id === run.cadence_rule_id);
    const due = dueSteps(run, runSteps, now);
    if (due.length === 0) continue;
    summary.runs_advanced += 1;

    const firmName = firmNameById.get(run.firm_id) ?? 'the firm';
    const recipient = matter?.primary_email ?? lead?.contact_email ?? null;

    const consentState: LeadConsentState = {
      email_consent_status: (lead?.email_consent_status ?? null) as LeadConsentState['email_consent_status'],
      sms_consent_status: (lead?.sms_consent_status ?? null) as LeadConsentState['sms_consent_status'],
      six_month_expiry_date: lead?.six_month_expiry_date ?? null,
    };

    const vars = {
      first_name: firstName(matter?.primary_name ?? lead?.contact_name ?? null),
      firm_name: firmName,
      matter_type: humanizeMatterType(matter?.matter_type ?? lead?.matter_type ?? null),
      gbp_review_url: firmReviewUrlById.get(run.firm_id) ?? '',
    };

    // Real-send eligibility: both the firm flag AND the global env kill
    // switch must be open. Neither is ever true in this sprint, so this is
    // always false today; every row below is written shadow=true exactly as
    // before. See cadence-dispatch.ts for the (also inert) send-side gate.
    const realSendEligible = isRealSendEnabledForFirm(firmRealSendById.get(run.firm_id) ?? false);

    const ledgerRows: Array<Record<string, unknown>> = [];
    let maxStep = run.next_step_number - 1;
    for (const step of due) {
      // step.channel supports 'sms' for a future SMS cadence (WP-7 adapter,
      // gated on 10DLC); every seeded cadence today is 'email', so this
      // branch is plumbing-complete but never actually takes the sms path.
      const allowed = isConsentGated(consentState, step.channel, now);
      const blockReason = allowed ? null : consentBlockReason(consentState, step.channel, now);
      ledgerRows.push({
        firm_id: run.firm_id,
        cadence_run_id: run.id,
        cadence_key: run.cadence_key,
        step_number: step.step_number,
        matter_id: run.matter_id,
        screened_lead_id: run.screened_lead_id,
        channel: step.channel,
        recipient_email: recipient,
        subject: interpolateTemplate(step.subject_template, vars),
        body: interpolateTemplate(step.body_template, vars),
        shadow: !realSendEligible,
        consent_verdict: allowed ? 'allowed' : 'blocked',
        consent_block_reason: blockReason,
        scheduled_for: computeStepScheduledAt(run.anchor_at, step.delay_hours).toISOString(),
        status: allowed ? (realSendEligible ? 'scheduled' : 'shadow_logged') : 'suppressed',
      });
      if (step.step_number > maxStep) maxStep = step.step_number;
    }

    if (ledgerRows.length > 0) {
      // ignoreDuplicates: uq_outbound_messages_run_step prevents double-logging.
      // Audit fix (2026-07-05): the write's error was previously unchecked and
      // the run advanced regardless, permanently skipping any touch whose
      // ledger row failed to land. Now: on a failed write, log loudly, leave
      // next_step_number untouched, and let the next tick retry. Counts only
      // increment after the write succeeds.
      const { error: ledgerErr } = await supabase
        .from('outbound_messages')
        .upsert(ledgerRows, { onConflict: 'cadence_run_id,step_number', ignoreDuplicates: true });
      if (ledgerErr) {
        console.error('[cadence-runner] shadow ledger write failed; run not advanced', {
          run_id: run.id, cadence_key: run.cadence_key, error: ledgerErr.message,
        });
        summary.ok = false;
        summary.reason = `ledger write failed: ${ledgerErr.message}`;
        continue;
      }
      for (const row of ledgerRows) {
        if (row.status === 'suppressed') summary.suppressed += 1;
        else summary.shadow_logged += 1;
      }
    }

    const last = lastStepNumber(runSteps, run.cadence_rule_id);
    const nextStep = maxStep + 1;
    const completed = nextStep > last;
    if (completed) summary.completed += 1;
    await supabase
      .from('cadence_runs')
      .update({
        next_step_number: nextStep,
        status: completed ? 'completed' : 'active',
        updated_at: now.toISOString(),
      })
      .eq('id', run.id);
  }

  return summary;
}

export type ManualEnrollResult =
  | { ok: true; alreadyEnrolled: boolean }
  | { ok: false; error: string };

/**
 * Manually enrolls a matter into a cadence on demand, outside the automatic
 * stage-transition ENROLL pass. Used by the "Request review" action (WP-4):
 * a lawyer can ask for a review at any point, not only on the automatic
 * active -> closing transition that already fires J9.
 *
 * Idempotent via the same uq_cadence_runs_key_matter index the automatic
 * path uses: a second manual trigger for the same matter/cadence is a no-op,
 * not a duplicate enrollment.
 */
export async function enrollMatterInCadence(opts: {
  matterId: string;
  firmId: string;
  screenedLeadId: string | null;
  cadenceKey: string;
  anchorAt?: string;
}): Promise<ManualEnrollResult> {
  const { data: ruleRows, error: ruleErr } = await supabase
    .from('cadence_rules')
    .select('id, firm_id, cadence_key, name, trigger_type, trigger_config, channel, enabled')
    .eq('cadence_key', opts.cadenceKey);
  if (ruleErr) return { ok: false, error: ruleErr.message };

  const rules = (ruleRows ?? []) as CadenceRule[];
  const resolved = resolveRuleForFirm(rules, opts.firmId, opts.cadenceKey);
  if (!resolved) return { ok: false, error: `no enabled rule found for cadence_key=${opts.cadenceKey}` };

  const { data: inserted, error: enrollErr } = await supabase
    .from('cadence_runs')
    .upsert(
      [{
        firm_id: opts.firmId,
        cadence_rule_id: resolved.id,
        cadence_key: resolved.cadence_key,
        matter_id: opts.matterId,
        screened_lead_id: opts.screenedLeadId,
        anchor_at: opts.anchorAt ?? new Date().toISOString(),
      }],
      { onConflict: 'cadence_key,matter_id', ignoreDuplicates: true },
    )
    .select('id');
  if (enrollErr) return { ok: false, error: enrollErr.message };

  return { ok: true, alreadyEnrolled: (inserted ?? []).length === 0 };
}
