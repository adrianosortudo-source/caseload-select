/**
 * Supabase I/O layer for the operator-facing cadence rule editor.
 *
 * SHADOW MODE ONLY: rules created/edited here are read by cadence-runner.ts,
 * which never dispatches (writes outbound_messages with shadow=true, no
 * Resend call, no GHL change).
 *
 * Every rule this module writes is hardcoded to trigger_type='field_change'.
 * The runner (cadence-runner.ts) only ever evaluates field_change rules;
 * threshold and time_relative are pure-function stubs in cadence-rules-pure.ts
 * with zero caller in the runner and would never fire if created. There is no
 * UI choice for trigger_type: it is fixed at write time.
 *
 * No `import 'server-only'`: this module's exports are called from API routes
 * that have their own vitest tests, and server-only throws when a test loads
 * the importing module (repo gotcha, see cadence-runner.ts and CLAUDE.md
 * "Developer Gotchas + Deploy-Safety").
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

// ── List ─────────────────────────────────────────────────────────────────

export interface CadenceRuleListRow {
  id: string;
  cadence_key: string;
  name: string;
  firm_id: string | null;
  firm_name: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  enabled: boolean;
  step_count: number;
}

interface CadenceRuleRow {
  id: string;
  cadence_key: string;
  name: string;
  firm_id: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  enabled: boolean;
}

export async function listCadenceRules(): Promise<CadenceRuleListRow[]> {
  const { data, error } = await supabase
    .from('cadence_rules')
    .select('id, cadence_key, name, firm_id, trigger_type, trigger_config, enabled')
    .order('cadence_key', { ascending: true })
    .order('firm_id', { ascending: true });

  if (error) return [];
  const rules = (data ?? []) as CadenceRuleRow[];

  const firmIds = Array.from(new Set(rules.map((r) => r.firm_id).filter((id): id is string => !!id)));
  const firmNameById = new Map<string, string>();
  if (firmIds.length > 0) {
    const { data: firmRows } = await supabase
      .from('intake_firms')
      .select('id, name')
      .in('id', firmIds);
    for (const f of (firmRows ?? []) as Array<{ id: string; name: string | null }>) {
      firmNameById.set(f.id, f.name ?? 'Unnamed firm');
    }
  }

  const { data: stepRows } = await supabase.from('cadence_steps').select('cadence_rule_id');
  const stepCountByRuleId = ((stepRows ?? []) as Array<{ cadence_rule_id: string }>).reduce(
    (acc, row) => {
      acc.set(row.cadence_rule_id, (acc.get(row.cadence_rule_id) ?? 0) + 1);
      return acc;
    },
    new Map<string, number>(),
  );

  return rules.map((r) => ({
    id: r.id,
    cadence_key: r.cadence_key,
    name: r.name,
    firm_id: r.firm_id,
    firm_name: r.firm_id ? (firmNameById.get(r.firm_id) ?? 'Unnamed firm') : null,
    trigger_type: r.trigger_type,
    trigger_config: r.trigger_config,
    enabled: r.enabled,
    step_count: stepCountByRuleId.get(r.id) ?? 0,
  }));
}

// ── Detail ───────────────────────────────────────────────────────────────

export interface CadenceRuleDetail {
  id: string;
  cadence_key: string;
  name: string;
  firm_id: string | null;
  firm_name: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  exit_config: Record<string, unknown>;
  channel: string;
  enabled: boolean;
  steps: Array<{
    step_number: number;
    delay_hours: number;
    subject_template: string;
    body_template: string;
    active: boolean;
  }>;
}

interface CadenceRuleDetailRow {
  id: string;
  cadence_key: string;
  name: string;
  firm_id: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  exit_config: Record<string, unknown> | null;
  channel: string;
  enabled: boolean;
}

interface CadenceStepDetailRow {
  step_number: number;
  delay_hours: number;
  subject_template: string;
  body_template: string;
  active: boolean;
}

export async function getCadenceRuleDetail(id: string): Promise<CadenceRuleDetail | null> {
  const { data, error } = await supabase
    .from('cadence_rules')
    .select('id, cadence_key, name, firm_id, trigger_type, trigger_config, exit_config, channel, enabled')
    .eq('id', id)
    .maybeSingle<CadenceRuleDetailRow>();

  if (error || !data) return null;

  const { data: stepRows } = await supabase
    .from('cadence_steps')
    .select('step_number, delay_hours, subject_template, body_template, active')
    .eq('cadence_rule_id', id)
    .order('step_number', { ascending: true });

  let firmName: string | null = null;
  if (data.firm_id) {
    const { data: firmRow } = await supabase
      .from('intake_firms')
      .select('name')
      .eq('id', data.firm_id)
      .maybeSingle<{ name: string | null }>();
    firmName = firmRow?.name ?? 'Unnamed firm';
  }

  return {
    id: data.id,
    cadence_key: data.cadence_key,
    name: data.name,
    firm_id: data.firm_id,
    firm_name: firmName,
    trigger_type: data.trigger_type,
    trigger_config: data.trigger_config,
    exit_config: data.exit_config ?? {},
    channel: data.channel,
    enabled: data.enabled,
    steps: (stepRows ?? []) as CadenceStepDetailRow[],
  };
}

// ── Firm picker ──────────────────────────────────────────────────────────

export interface FirmOption {
  id: string;
  name: string;
}

export async function listFirmsForPicker(): Promise<FirmOption[]> {
  const { data, error } = await supabase
    .from('intake_firms')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) return [];
  return ((data ?? []) as Array<{ id: string; name: string | null }>).map((f) => ({
    id: f.id,
    name: f.name ?? 'Unnamed firm',
  }));
}

// ── Write (create / update) ──────────────────────────────────────────────

export interface RuleWritePayload {
  cadence_key: string;
  name: string;
  firm_id: string | null;
  trigger_config: Record<string, unknown>;
  exit_config: Record<string, unknown>;
  enabled: boolean;
  steps: Array<{
    step_number: number;
    delay_hours: number;
    subject_template: string;
    body_template: string;
    active: boolean;
  }>;
}

export type WriteResult = { ok: true; id: string } | { ok: false; error: string };

export async function createCadenceRule(payload: RuleWritePayload): Promise<WriteResult> {
  const { data: inserted, error: insertErr } = await supabase
    .from('cadence_rules')
    .insert({
      firm_id: payload.firm_id,
      cadence_key: payload.cadence_key,
      name: payload.name,
      trigger_type: 'field_change',
      trigger_config: payload.trigger_config,
      exit_config: payload.exit_config,
      channel: 'email',
      enabled: payload.enabled,
    })
    .select('id')
    .single<{ id: string }>();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return { ok: false, error: 'A rule for this cadence key already exists in this scope.' };
    }
    return { ok: false, error: insertErr.message };
  }

  const ruleId = inserted.id;

  const stepRows = payload.steps.map((s) => ({
    cadence_rule_id: ruleId,
    step_number: s.step_number,
    delay_hours: s.delay_hours,
    subject_template: s.subject_template,
    body_template: s.body_template,
    active: s.active,
    channel: 'email',
  }));

  if (stepRows.length > 0) {
    const { error: stepErr } = await supabase.from('cadence_steps').insert(stepRows);
    if (stepErr) {
      // Best-effort cleanup: remove the just-created rule so we don't leave a
      // stepless orphan behind. Ignore any error from this cleanup delete.
      await supabase.from('cadence_rules').delete().eq('id', ruleId);
      return { ok: false, error: stepErr.message };
    }
  }

  return { ok: true, id: ruleId };
}

export async function updateCadenceRule(id: string, payload: RuleWritePayload): Promise<WriteResult> {
  // cadence_key and firm_id are immutable after creation; payload's values for
  // those two fields are deliberately ignored here.
  const { error: updateErr } = await supabase
    .from('cadence_rules')
    .update({
      name: payload.name,
      trigger_config: payload.trigger_config,
      exit_config: payload.exit_config,
      enabled: payload.enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updateErr) return { ok: false, error: updateErr.message };

  const { error: deleteErr } = await supabase.from('cadence_steps').delete().eq('cadence_rule_id', id);
  if (deleteErr) return { ok: false, error: deleteErr.message };

  const stepRows = payload.steps.map((s) => ({
    cadence_rule_id: id,
    step_number: s.step_number,
    delay_hours: s.delay_hours,
    subject_template: s.subject_template,
    body_template: s.body_template,
    active: s.active,
    channel: 'email',
  }));

  if (stepRows.length > 0) {
    const { error: insertErr } = await supabase.from('cadence_steps').insert(stepRows);
    if (insertErr) return { ok: false, error: insertErr.message };
  }

  return { ok: true, id };
}

// ── Delete ───────────────────────────────────────────────────────────────

export type DeleteResult = { ok: true } | { ok: false; error: string };

export async function deleteCadenceRule(id: string): Promise<DeleteResult> {
  const { count, error: countErr } = await supabase
    .from('cadence_runs')
    .select('id', { count: 'exact', head: true })
    .eq('cadence_rule_id', id);

  if (countErr) return { ok: false, error: countErr.message };

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `This rule has ${count} shadow enrollment(s) already logged. Disable it instead of deleting, or wait for its runs to complete or exit.`,
    };
  }

  // cadence_steps cascades via the existing FK ON DELETE CASCADE.
  const { error: deleteErr } = await supabase.from('cadence_rules').delete().eq('id', id);
  if (deleteErr) return { ok: false, error: deleteErr.message };

  return { ok: true };
}
