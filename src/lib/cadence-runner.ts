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
import {
  resolveRuleForFirm,
  matchesFieldChangeTrigger,
  computeStepScheduledAt,
  dueSteps,
  lastStepNumber,
  interpolateTemplate,
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
  contact_email: string | null;
  email_consent_status: string | null;
  sms_consent_status: string | null;
  six_month_expiry_date: string | null;
}

const NO_SUMMARY: CadenceRunSummary = {
  ok: true, applied: false, enrolled: 0, runs_advanced: 0,
  shadow_logged: 0, suppressed: 0, completed: 0,
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
  const { data: ruleRows, error: ruleErr } = await supabase
    .from('cadence_rules')
    .select('id, firm_id, cadence_key, name, trigger_type, trigger_config, channel, enabled');
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
    shadow_logged: 0, suppressed: 0, completed: 0,
  };

  // ── Pass 1: ENROLL from stage events ─────────────────────────────────────
  let eventQuery = supabase
    .from('matter_stage_events')
    .select('matter_id, firm_id, from_stage, to_stage, created_at')
    .order('created_at', { ascending: true })
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
    const matchingRule = rules.find(
      (r) => matchesFieldChangeTrigger(r, trigger)
        && (r.firm_id === ev.firm_id || r.firm_id === null),
    );
    if (!matchingRule) continue;
    const resolved = resolveRuleForFirm(rules, ev.firm_id, matchingRule.cadence_key);
    if (!resolved) continue;
    const matter = matterById.get(ev.matter_id);
    enrollRows.push({
      firm_id: ev.firm_id,
      cadence_rule_id: resolved.id,
      cadence_key: resolved.cadence_key,
      matter_id: ev.matter_id,
      screened_lead_id: matter?.source_screened_lead_id ?? null,
      anchor_at: ev.created_at,
    });
  }

  if (enrollRows.length > 0) {
    // ignoreDuplicates: uq_cadence_runs_key_matter makes re-enrollment a no-op.
    const { data: inserted, error: enrollErr } = await supabase
      .from('cadence_runs')
      .upsert(enrollRows, { onConflict: 'cadence_key,matter_id', ignoreDuplicates: true })
      .select('id');
    if (!enrollErr && inserted) summary.enrolled = inserted.length;
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
      .select('id, contact_email, email_consent_status, sms_consent_status, six_month_expiry_date')
      .in('id', leadIds);
    for (const l of (leadRows ?? []) as LeadRow[]) leadById.set(l.id, l);
  }

  const firmIds = Array.from(new Set(runs.map((r) => r.firm_id)));
  const firmNameById = new Map<string, string>();
  if (firmIds.length > 0) {
    const { data: firmRows } = await supabase.from('intake_firms').select('id, name').in('id', firmIds);
    for (const f of (firmRows ?? []) as Array<{ id: string; name: string | null }>) {
      firmNameById.set(f.id, cleanFirmName(f.name));
    }
  }

  for (const run of runs) {
    const runSteps = steps.filter((s) => s.cadence_rule_id === run.cadence_rule_id);
    const due = dueSteps(run, runSteps, now);
    if (due.length === 0) continue;
    summary.runs_advanced += 1;

    const matter = run.matter_id ? matterById.get(run.matter_id) : undefined;
    const lead = run.screened_lead_id ? leadById.get(run.screened_lead_id) : undefined;
    const firmName = firmNameById.get(run.firm_id) ?? 'the firm';
    const recipient = matter?.primary_email ?? lead?.contact_email ?? null;

    const consentState: LeadConsentState = {
      email_consent_status: (lead?.email_consent_status ?? null) as LeadConsentState['email_consent_status'],
      sms_consent_status: (lead?.sms_consent_status ?? null) as LeadConsentState['sms_consent_status'],
      six_month_expiry_date: lead?.six_month_expiry_date ?? null,
    };

    const vars = {
      first_name: firstName(matter?.primary_name ?? null),
      firm_name: firmName,
      matter_type: humanizeMatterType(matter?.matter_type ?? null),
    };

    const ledgerRows: Array<Record<string, unknown>> = [];
    let maxStep = run.next_step_number - 1;
    for (const step of due) {
      const allowed = isConsentGated(consentState, 'email', now);
      const blockReason = allowed ? null : consentBlockReason(consentState, 'email', now);
      ledgerRows.push({
        firm_id: run.firm_id,
        cadence_run_id: run.id,
        cadence_key: run.cadence_key,
        step_number: step.step_number,
        matter_id: run.matter_id,
        screened_lead_id: run.screened_lead_id,
        channel: 'email',
        recipient_email: recipient,
        subject: interpolateTemplate(step.subject_template, vars),
        body: interpolateTemplate(step.body_template, vars),
        shadow: true,
        consent_verdict: allowed ? 'allowed' : 'blocked',
        consent_block_reason: blockReason,
        scheduled_for: computeStepScheduledAt(run.anchor_at, step.delay_hours).toISOString(),
        status: allowed ? 'shadow_logged' : 'suppressed',
      });
      if (allowed) summary.shadow_logged += 1;
      else summary.suppressed += 1;
      if (step.step_number > maxStep) maxStep = step.step_number;
    }

    if (ledgerRows.length > 0) {
      // ignoreDuplicates: uq_outbound_messages_run_step prevents double-logging.
      await supabase
        .from('outbound_messages')
        .upsert(ledgerRows, { onConflict: 'cadence_run_id,step_number', ignoreDuplicates: true });
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
