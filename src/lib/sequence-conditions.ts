/**
 * sequence-conditions.ts
 *
 * Pure condition evaluation for sequence steps. No Supabase dependency.
 * Imported by both sequence-engine.ts (type re-exports) and send-sequences.ts.
 */

/**
 * A single condition rule keyed on a slot answer.
 *
 * slot_id: slot registry ID (e.g. "pi_slip_fall__location_type") or extracted entity key.
 * op:      comparison operator.
 * value:   expected value(s). Use an array for "in" / "nin".
 */
export interface ConditionRule {
  slot_id: string;
  op: "eq" | "neq" | "in" | "nin" | "exists" | "not_exists";
  value?: string | string[];
}

/**
 * Step-level send condition. Stored in channels.condition.
 * The step only sends when the condition evaluates to true.
 *
 * operator: "and"  -  all rules must pass; "or"  -  any rule must pass.
 * rules:    list of ConditionRule. Empty rules = always send.
 */
export interface StepCondition {
  operator: "and" | "or";
  rules: ConditionRule[];
}

/**
 * Evaluate a StepCondition against a flat map of slot/entity answers.
 * Returns true when the step should send, false when it should be skipped.
 * A missing condition or empty rules always returns true.
 */
export function evaluateStepCondition(
  condition: StepCondition | null | undefined,
  answers: Record<string, unknown>,
): boolean {
  if (!condition || !condition.rules.length) return true;

  const evalRule = (rule: ConditionRule): boolean => {
    const actual = answers[rule.slot_id];
    switch (rule.op) {
      case "exists":
        return actual !== undefined && actual !== null && actual !== "";
      case "not_exists":
        return actual === undefined || actual === null || actual === "";
      case "eq":
        return String(actual ?? "") === String(rule.value ?? "");
      case "neq":
        return String(actual ?? "") !== String(rule.value ?? "");
      case "in": {
        const haystack = Array.isArray(rule.value) ? rule.value : [String(rule.value ?? "")];
        const actualArr = Array.isArray(actual) ? actual.map(String) : [String(actual ?? "")];
        return actualArr.some(v => haystack.includes(v));
      }
      case "nin": {
        const haystack = Array.isArray(rule.value) ? rule.value : [String(rule.value ?? "")];
        const actualArr = Array.isArray(actual) ? actual.map(String) : [String(actual ?? "")];
        return !actualArr.some(v => haystack.includes(v));
      }
      default:
        return true;
    }
  };

  return condition.operator === "and"
    ? condition.rules.every(evalRule)
    : condition.rules.some(evalRule);
}
