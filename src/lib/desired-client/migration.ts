import { emptyAnswers } from "./brief";
import { validateDraftAnswers } from "./validation";
import type { DesiredClientAnswers } from "./types";

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: unknown, keys: readonly string[]) => isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const LEGACY_CLARIFICATIONS = ["FOCUS_UNCLEAR", "CLIENT_GOAL_UNCLEAR", "CURRENT_CAPACITY_CONFLICT", "FEE_EFFORT_CONFLICT", "EXPERIENCE_DIRECTION_CONFLICT"] as const;
const OLD_WRITE_INS = ["timing", "contact", "goals", "concerns", "reasons", "fee_effort", "conditions", "capacity", "limit", "aim", "evidence"] as const;

/** Strict v2.1 validation before any fields are added; malformed legacy data remains invalid. */
export function migrateV21Answers(value: unknown): DesiredClientAnswers | null {
  if (!isRecord(value) || !exactKeys(value, ["schema_version", "revision", "focus", "situation", "client", "value", "delivery", "direction", "clarifications"]) &&
      !exactKeys(value, ["schema_version", "revision", "write_ins", "focus", "situation", "client", "value", "delivery", "direction", "clarifications"])) return null;
  if (value.schema_version !== "dcm-v2.1" || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || (value.revision as number) >= Number.MAX_SAFE_INTEGER) return null;
  if (!exactKeys(value.focus, ["area", "work", "work_other", "service_area", "certainty", "route", "comparison"]) ||
      !exactKeys(value.situation, ["timing", "role", "role_other", "contact"]) ||
      !exactKeys(value.client, ["goals", "concerns"]) ||
      !exactKeys(value.value, ["reasons", "fee_effort", "collected_fee", "team_hours", "payment"]) ||
      !exactKeys(value.delivery, ["conditions", "capacity", "limit"]) ||
      !exactKeys(value.direction, ["aim", "evidence", "less", "less_note"]) ||
      !exactKeys(value.clarifications, LEGACY_CLARIFICATIONS)) return null;
  if (value.write_ins !== undefined && (!isRecord(value.write_ins) || Object.keys(value.write_ins).some((key) => !OLD_WRITE_INS.includes(key as typeof OLD_WRITE_INS[number])))) return null;

  const old = structuredClone(value) as RecordValue;
  const defaults = emptyAnswers();
  const upgraded = {
    ...old,
    schema_version: "dcm-v2.2",
    revision: (old.revision as number) + 1,
    situation: { ...(old.situation as RecordValue), trigger: null },
    client: { ...(old.client as RecordValue), decision_needs: [] },
    delivery: { ...(old.delivery as RecordValue), fit_signals: [] },
    clarifications: { ...defaults.clarifications },
  };
  return validateDraftAnswers(upgraded) ? upgraded : null;
}
