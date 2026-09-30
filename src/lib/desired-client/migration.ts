import { emptyAnswers } from "./brief";
import { validateDraftAnswers, validateLegacyV22DraftAnswers } from "./validation";
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
    schema_version: "dcm-v3.0",
    revision: Number(old.revision) + 1,
    ...(old.write_ins ? { write_ins: structuredClone(old.write_ins) as DesiredClientAnswers["write_ins"] } : {}),
    focus: structuredClone(focus) as unknown as DesiredClientAnswers["focus"],
    practice: { direction: aimMap[String(direction.aim)] ?? null, firm_type: "", capability: "", enjoys: "" },
    client_context: {
      geography: String(focus.service_area ?? ""), relevant_circumstances: "", community_focus: "", language_service_needs: "", repeat_matter_pattern: "",
    },
    situation: structuredClone(situation) as unknown as DesiredClientAnswers["situation"],
    client: structuredClone(client) as unknown as DesiredClientAnswers["client"],
    value: {
      reasons: structuredClone(valueGroup.reasons) as DesiredClientAnswers["value"]["reasons"],
      fee_effort: valueGroup.fee_effort as DesiredClientAnswers["value"]["fee_effort"],
      collected_fee: valueGroup.collected_fee as DesiredClientAnswers["value"]["collected_fee"],
      team_hours: valueGroup.team_hours as DesiredClientAnswers["value"]["team_hours"],
      payment: valueGroup.payment as DesiredClientAnswers["value"]["payment"],
      currency: "", fee_amount: "", direct_cost_amount: "", amount_basis: null, amount_scope: null,
    },
    delivery: structuredClone(old.delivery) as unknown as DesiredClientAnswers["delivery"],
    direction: structuredClone(direction) as unknown as DesiredClientAnswers["direction"],
    opportunity: { sources: ["unknown"], data_basis: null, source_detail: "", period: "", enquiry_count: "", retained_count: "", conversion: "", acquisition_cost: "", uncertainty: "" },
    repeatability: { success_measure: null, success_other: "", target: "", review_period: "", additional_matters: "", staffing_constraint: "" },
    clarifications: { CLIENT_MATTER_UNCLEAR: null, VALUE_EFFORT_CONFLICT: null, CAPACITY_CONFLICT: null, REPEATABILITY_UNPROVEN: null, OPPORTUNITY_UNSUPPORTED: null },
  };
  return validateDraftAnswers(migrated) ? migrated : null;
}
