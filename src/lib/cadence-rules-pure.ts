/**
 * Cadence engine, pure rule evaluation (no Supabase, no I/O).
 *
 * The Trigger-Condition-Action core from CaseLoad_CRM_Migration_Plan_v1.md
 * section 6.1 note 2: a generic rule engine that replaces GHL's per-journey
 * email workflows. This module is the deterministic brain; cadence-runner.ts
 * is the I/O shell that reads the DB, calls these functions, evaluates the
 * CASL gate, and writes the shadow ledger.
 *
 * Three trigger classes, per the plan:
 *   field_change   a tracked field changed to a target value
 *                  (the launch class: matter stage change to a cadence trigger)
 *   threshold      a numeric field crossed a boundary (>=, >, <=, <, ==)
 *   time_relative  a fixed offset after a named anchor date
 *
 * Everything here is a pure function of its inputs so the whole evaluator is
 * unit-testable without a database.
 */

export type TriggerType = 'field_change' | 'threshold' | 'time_relative';

export interface CadenceRule {
  id: string;
  firm_id: string | null; // null = global default; set = per-firm override
  cadence_key: string;
  name: string;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  channel: 'email' | 'sms';
  enabled: boolean;
}

export interface CadenceStep {
  id: string;
  cadence_rule_id: string;
  step_number: number;
  delay_hours: number;
  channel: 'email' | 'sms';
  subject_template: string;
  body_template: string;
  active: boolean;
}

export interface CadenceRun {
  id: string;
  firm_id: string;
  cadence_rule_id: string;
  cadence_key: string;
  matter_id: string | null;
  screened_lead_id: string | null;
  anchor_at: string; // ISO 8601
  status: 'active' | 'completed' | 'exited';
  next_step_number: number;
}

// ── Rule resolution ────────────────────────────────────────────────────────

/**
 * Resolve the rule that applies for a firm and cadence key: a firm-scoped
 * override wins over the global (firm_id = null) default. Disabled rules are
 * excluded. Returns null when neither an enabled firm override nor an enabled
 * global default exists.
 */
export function resolveRuleForFirm(
  rules: CadenceRule[],
  firmId: string,
  cadenceKey: string,
): CadenceRule | null {
  const enabled = rules.filter((r) => r.enabled && r.cadence_key === cadenceKey);
  const firmRule = enabled.find((r) => r.firm_id === firmId);
  if (firmRule) return firmRule;
  const globalRule = enabled.find((r) => r.firm_id === null);
  return globalRule ?? null;
}

// ── Trigger matching ───────────────────────────────────────────────────────

/**
 * field_change: does a stage-change (mapped to a cadence_trigger) match this
 * rule? The runner maps a matter_stage_events row to a cadence_trigger via
 * journeyTriggerForTransition (matter-stage-pure.ts), then asks this.
 */
export function matchesFieldChangeTrigger(
  rule: CadenceRule,
  cadenceTrigger: string | null,
): boolean {
  if (rule.trigger_type !== 'field_change' || !rule.enabled) return false;
  if (!cadenceTrigger) return false;
  return rule.trigger_config['cadence_trigger'] === cadenceTrigger;
}

/**
 * threshold: does a numeric field value satisfy the rule's boundary? Config
 * shape { field, op, value } with op one of >= > <= < ==. Missing/non-numeric
 * inputs never match (fail-closed).
 */
export function matchesThresholdTrigger(
  rule: CadenceRule,
  fields: Record<string, number | null | undefined>,
): boolean {
  if (rule.trigger_type !== 'threshold' || !rule.enabled) return false;
  const cfg = rule.trigger_config;
  const field = typeof cfg['field'] === 'string' ? (cfg['field'] as string) : null;
  const op = typeof cfg['op'] === 'string' ? (cfg['op'] as string) : null;
  const bound = typeof cfg['value'] === 'number' ? (cfg['value'] as number) : null;
  if (!field || !op || bound === null) return false;
  const actual = fields[field];
  if (typeof actual !== 'number' || Number.isNaN(actual)) return false;
  switch (op) {
    case '>=': return actual >= bound;
    case '>':  return actual > bound;
    case '<=': return actual <= bound;
    case '<':  return actual < bound;
    case '==': return actual === bound;
    default:   return false;
  }
}

/**
 * time_relative: is "now" at or past (anchor + offset_days)? Config shape
 * { anchor, offset_days }; the runner supplies the resolved anchor timestamp.
 * A null/invalid anchor never matches (fail-closed).
 */
export function matchesTimeRelativeTrigger(
  rule: CadenceRule,
  anchorIso: string | null,
  now: Date,
): boolean {
  if (rule.trigger_type !== 'time_relative' || !rule.enabled) return false;
  if (!anchorIso) return false;
  const offsetDays = typeof rule.trigger_config['offset_days'] === 'number'
    ? (rule.trigger_config['offset_days'] as number)
    : null;
  if (offsetDays === null) return false;
  const anchor = new Date(anchorIso);
  if (Number.isNaN(anchor.getTime())) return false;
  const fireAt = anchor.getTime() + offsetDays * 24 * 60 * 60 * 1000;
  return now.getTime() >= fireAt;
}

// ── Step scheduling ────────────────────────────────────────────────────────

/**
 * When a run's step should fire: anchor_at + delay_hours. Pure time math.
 */
export function computeStepScheduledAt(anchorIso: string, delayHours: number): Date {
  const anchor = new Date(anchorIso);
  return new Date(anchor.getTime() + delayHours * 60 * 60 * 1000);
}

/**
 * The steps of a run that are DUE at `now` and not yet processed: active,
 * step_number >= the run's next_step_number, and scheduled_at <= now. Sorted
 * by step_number so the runner processes them in order.
 */
export function dueSteps(
  run: CadenceRun,
  steps: CadenceStep[],
  now: Date,
): CadenceStep[] {
  return steps
    .filter((s) => s.cadence_rule_id === run.cadence_rule_id)
    .filter((s) => s.active)
    .filter((s) => s.step_number >= run.next_step_number)
    .filter((s) => computeStepScheduledAt(run.anchor_at, s.delay_hours).getTime() <= now.getTime())
    .sort((a, b) => a.step_number - b.step_number);
}

/**
 * The highest step_number among a rule's active steps. When a run's
 * next_step_number exceeds this, the run has delivered every touch and is
 * complete. Returns 0 when the rule has no active steps.
 */
export function lastStepNumber(steps: CadenceStep[], cadenceRuleId: string): number {
  const nums = steps
    .filter((s) => s.cadence_rule_id === cadenceRuleId && s.active)
    .map((s) => s.step_number);
  return nums.length === 0 ? 0 : Math.max(...nums);
}

// ── Template interpolation ─────────────────────────────────────────────────

/**
 * Replace {token} placeholders with values. Unknown tokens are left as-is (not
 * blanked) so a template authoring mistake is visible in the shadow ledger
 * rather than silently producing an empty gap. Null/undefined values render as
 * the empty string.
 */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key] ?? '';
    }
    return whole;
  });
}
