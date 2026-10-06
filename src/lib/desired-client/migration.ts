import { emptyAnswers } from "./brief";
import { validateDraftAnswers, validateLegacyV22DraftAnswers, validateLegacyV30DraftAnswers, validateLegacyV31DraftAnswers, validateLegacyV32DraftAnswers } from "./validation";
import type { DesiredClientAnswers } from "./types";

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: unknown, keys: readonly string[]) => isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const V21_KEYS = ["schema_version", "revision", "focus", "situation", "client", "value", "delivery", "direction", "clarifications"] as const;
const V21_CLARIFICATIONS = ["FOCUS_UNCLEAR", "CLIENT_GOAL_UNCLEAR", "CURRENT_CAPACITY_CONFLICT", "FEE_EFFORT_CONFLICT", "EXPERIENCE_DIRECTION_CONFLICT"] as const;
const OLD_WRITE_INS = ["timing", "contact", "goals", "concerns", "reasons", "fee_effort", "conditions", "capacity", "limit", "aim", "evidence"] as const;

/** Strict validation of the supported v2.1 draft before filling fields introduced in v2.2. */
export function migrateV21Answers(value: unknown): DesiredClientAnswers | null {
  if (!isRecord(value) || (!exactKeys(value, V21_KEYS) && !exactKeys(value, [...V21_KEYS, "write_ins"]))) return null;
  if (value.schema_version !== "dcm-v2.1" || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || (value.revision as number) >= Number.MAX_SAFE_INTEGER) return null;
  if (!exactKeys(value.focus, ["area", "work", "work_other", "service_area", "certainty", "route", "comparison"]) ||
    !exactKeys(value.situation, ["timing", "role", "role_other", "contact"]) || !exactKeys(value.client, ["goals", "concerns"]) ||
    !exactKeys(value.value, ["reasons", "fee_effort", "collected_fee", "team_hours", "payment"]) ||
    !exactKeys(value.delivery, ["conditions", "capacity", "limit"]) || !exactKeys(value.direction, ["aim", "evidence", "less", "less_note"]) ||
    !exactKeys(value.clarifications, V21_CLARIFICATIONS)) return null;
  const writeIns = value.write_ins;
  if (writeIns !== undefined && (!isRecord(writeIns) || Object.keys(writeIns).some((key) =>
    !OLD_WRITE_INS.includes(key as typeof OLD_WRITE_INS[number]) || typeof writeIns[key] !== "string" || (writeIns[key] as string).length > 180))) return null;

  const old = structuredClone(value) as RecordValue;
  const oldV22 = {
    ...old,
    schema_version: "dcm-v2.2",
    revision: (old.revision as number) + 1,
    situation: { ...(old.situation as RecordValue), trigger: null },
    client: { ...(old.client as RecordValue), decision_needs: [] },
    delivery: { ...(old.delivery as RecordValue), fit_signals: [] },
  };
  return migrateV22Answers(oldV22);
}

/** Validate and map a v2.2 snapshot. New evidence fields remain explicitly unknown. */
export function migrateV22Answers(value: unknown): DesiredClientAnswers | null {
  if (!validateLegacyV22DraftAnswers(value)) return null;
  const old = value as unknown as RecordValue;
  const focus = old.focus as RecordValue;
  const situation = old.situation as RecordValue;
  const client = old.client as RecordValue;
  const valueGroup = old.value as RecordValue;
  const direction = old.direction as RecordValue;
  const base = emptyAnswers();
  const aimMap: Record<string, DesiredClientAnswers["practice"]["direction"]> = {
    more_current: "grow_proven", narrower: "narrow_specialty", new_area: "explore_direction", new_model: "improve_delivery", unknown: "unknown",
  };
  const migrated: DesiredClientAnswers = {
    ...base,
    schema_version: "dcm-v3.3",
    revision: Number(old.revision) + 1,
    ...(old.write_ins ? { write_ins: structuredClone(old.write_ins) as DesiredClientAnswers["write_ins"] } : {}),
    focus: structuredClone(focus) as unknown as DesiredClientAnswers["focus"],
    practice: { direction: aimMap[String(direction.aim)] ?? null, firm_type: "", capability: "", enjoys: "", experience: null, development_needs: [], client_strength: null, client_strength_effect: "", client_strength_support: "" },
    client_context: {
      geography: String(focus.service_area ?? ""), relevant_circumstances: "", community_focus: "", language_service_needs: "", repeat_matter_pattern: "", discovery_behaviour: "",
    },
    situation: structuredClone(situation) as unknown as DesiredClientAnswers["situation"],
    client: { ...(structuredClone(client) as unknown as { goals: DesiredClientAnswers["client"]["goals"]; concerns: DesiredClientAnswers["client"]["concerns"]; decision_needs: DesiredClientAnswers["client"]["decision_needs"] }), goal_detail: "", decision_context: "", pathway_basis: null, choice_priorities: [], choice_detail: "", choice_basis: null },
    interview: base.interview,
    value: {
      reasons: structuredClone(valueGroup.reasons) as DesiredClientAnswers["value"]["reasons"],
      fee_effort: valueGroup.fee_effort as DesiredClientAnswers["value"]["fee_effort"],
      collected_fee: valueGroup.collected_fee as DesiredClientAnswers["value"]["collected_fee"],
      team_hours: valueGroup.team_hours as DesiredClientAnswers["value"]["team_hours"],
      payment: valueGroup.payment as DesiredClientAnswers["value"]["payment"],
      payment_context: "",
      payment_context_basis: null,
      currency: "", fee_amount: "", direct_cost_amount: "", amount_basis: null, amount_scope: null,
    },
    delivery: structuredClone(old.delivery) as unknown as DesiredClientAnswers["delivery"],
    direction: { ...(structuredClone(direction) as unknown as Omit<DesiredClientAnswers["direction"], "less_reason">), less_reason: null },
    opportunity: { sources: ["unknown"], data_basis: null, source_detail: "", period: "", enquiry_count: "", retained_count: "", conversion: "", acquisition_cost: "", uncertainty: "" },
    repeatability: { success_measure: null, success_other: "", target: "", review_period: "", additional_matters: "", staffing_constraint: "" },
    clarifications: { CLIENT_MATTER_UNCLEAR: null, VALUE_EFFORT_CONFLICT: null, CAPACITY_CONFLICT: null, REPEATABILITY_UNPROVEN: null, OPPORTUNITY_UNSUPPORTED: null },
  };
  return validateDraftAnswers(migrated) ? migrated : null;
}

/** Upgrade six-stage drafts while preserving every existing answer string. Experience is left unanswered so it is explicitly reconfirmed on resume. */
export function migrateV30Answers(value: unknown): DesiredClientAnswers | null {
  if (!validateLegacyV30DraftAnswers(value)) return null;
  const old = structuredClone(value) as RecordValue;
  const practice = old.practice as RecordValue;
  const direction = old.direction as RecordValue;
  const oldV31 = {
    ...old,
    schema_version: "dcm-v3.1" as const,
    revision: Number(old.revision) + 1,
    practice: { ...practice, experience: null, development_needs: [] },
    direction: { ...direction, less_reason: null },
  };
  return migrateV31Answers(oldV31);
}

/** Add the new client-choice and clarification fields without inferring answers or extending draft expiry. */
export function migrateV31Answers(value: unknown): DesiredClientAnswers | null {
  if (!validateLegacyV31DraftAnswers(value)) return null;
  const old = structuredClone(value) as RecordValue;
  const base = emptyAnswers();
  const practice = old.practice as RecordValue;
  const client = old.client as RecordValue;
  const context = old.client_context as RecordValue;
  const migrated: DesiredClientAnswers = {
    ...base,
    ...old,
    schema_version: "dcm-v3.3",
    revision: Number(old.revision) + 1,
    interview: base.interview,
    value: { ...(old.value as unknown as DesiredClientAnswers["value"]), payment_context: "", payment_context_basis: null },
    practice: { ...(practice as unknown as DesiredClientAnswers["practice"]), client_strength: null, client_strength_effect: "", client_strength_support: "" },
    client_context: { ...(context as unknown as DesiredClientAnswers["client_context"]), discovery_behaviour: "" },
    client: { ...(client as unknown as { goals: DesiredClientAnswers["client"]["goals"]; concerns: DesiredClientAnswers["client"]["concerns"]; decision_needs: DesiredClientAnswers["client"]["decision_needs"] }), goal_detail: "", decision_context: "", pathway_basis: null, choice_priorities: [], choice_detail: "", choice_basis: null },
  };
  return validateDraftAnswers(migrated) ? migrated : null;
}

/** Add optional payment context to a v3.2 draft without changing its meaning or answer revision. */
export function migrateV32Answers(value: unknown): DesiredClientAnswers | null {
  if (!validateLegacyV32DraftAnswers(value)) return null;
  const old = structuredClone(value) as RecordValue;
  const valueGroup = old.value as RecordValue;
  const migrated = {
    ...old,
    schema_version: "dcm-v3.3" as const,
    value: { ...valueGroup, payment_context: "", payment_context_basis: null },
  };
  return validateDraftAnswers(migrated) ? migrated : null;
}
