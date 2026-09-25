import { CONTACT_ROLE_IDS, AREA_CATALOG, WRITE_IN_KEYS, isKnownArea, isKnownWork } from "./catalog";
import type {
  AnalysisRequestEnvelope,
  AreaId,
  ClarificationAnswer,
  ClarificationCode,
  ComparisonCandidate,
  DesiredClientAnswers,
  GoalId,
  WorkComparison,
} from "./types";

const ANSWER_KEYS = ["schema_version", "revision", "focus", "situation", "client", "value", "delivery", "direction", "clarifications"] as const;
const CLARIFICATION_CODES: readonly ClarificationCode[] = [
  "FOCUS_UNCLEAR", "CLIENT_GOAL_UNCLEAR", "CURRENT_CAPACITY_CONFLICT", "FEE_EFFORT_CONFLICT", "EXPERIENCE_DIRECTION_CONFLICT",
];
const GOALS: readonly GoalId[] = ["understand", "complete", "resolve", "protect", "prepare", "respond", "unknown"];
const CONTACT_ROLE_SET: ReadonlySet<string> = new Set(CONTACT_ROLE_IDS);
const TEXT_MAX = 180;

const ENUMS = {
  route: ["established", "new", "exploring"],
  timing: ["planning", "emerging", "underway", "deadline", "varies", "unknown"],
  contact: ["owner", "manager", "adviser", "other", "unknown"],
  goals: GOALS,
  concerns: ["next", "cost", "consequences", "time", "worse", "unheard"],
  reasons: ["client_benefit", "fees", "skills", "enjoyment", "repeatable", "further", "direction", "undecided"],
  feeEffort: ["worthwhile", "scoped", "difficult", "unknown"],
  collectedFee: ["under2", "2to5", "5to15", "15to50", "50plus", "unknown", "private"],
  teamHours: ["upto5", "6to15", "16to40", "41to100", "over100", "unknown"],
  payment: ["predictable", "varies", "uncertain", "unknown"],
  conditions: ["time", "scope", "information", "decision", "communication", "support", "unknown"],
  capacity: ["room", "limited", "change", "unknown"],
  limit: ["time", "scope", "support", "communication", "fees", "none"],
  aim: ["more_current", "narrower", "new_area", "new_model", "unknown"],
  evidence: ["repeated", "few", "feedback", "records", "team", "preference"],
  less: ["within", "outside", "model", "none"],
  candidateTeam: ["proven", "stretch", "unknown"],
  candidateEvidence: ["repeated", "few", "none"],
} as const;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is RecordValue {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isEnum(value: unknown, choices: readonly string[], nullable = false): boolean {
  return (nullable && value === null) || (typeof value === "string" && choices.includes(value));
}

function isOptionalText(value: unknown): value is string {
  return typeof value === "string" && value.length <= TEXT_MAX && !/[\r\n]/.test(value);
}

function isUniqueChoiceArray(value: unknown, choices: readonly string[], max: number, min = 0): value is string[] {
  return Array.isArray(value) && value.length >= min && value.length <= max &&
    value.every((item) => typeof item === "string" && choices.includes(item)) && new Set(value).size === value.length;
}

function exclusive(value: readonly string[], exclusiveId: string): boolean {
  return !value.includes(exclusiveId) || value.length === 1;
}

function validCandidate(value: unknown, area: AreaId): value is ComparisonCandidate {
  if (!hasExactKeys(value, ["work", "fee_effort", "team_fit", "capacity", "evidence"])) return false;
  return isKnownWork(area, value.work) && isEnum(value.fee_effort, ENUMS.feeEffort) &&
    isEnum(value.team_fit, ENUMS.candidateTeam) && isEnum(value.capacity, ENUMS.capacity) &&
    isEnum(value.evidence, ENUMS.candidateEvidence);
}

function validClarificationAnswer(code: ClarificationCode, answer: unknown): answer is ClarificationAnswer {
  switch (code) {
    case "FOCUS_UNCLEAR": return answer === "keep_broad";
    case "CLIENT_GOAL_UNCLEAR": return typeof answer === "string" && GOALS.includes(answer as GoalId) && answer !== "unknown";
    case "CURRENT_CAPACITY_CONFLICT": return answer === "limited_now" || answer === "build_first";
    case "FEE_EFFORT_CONFLICT": return answer === "improve_model" || answer === "reconsider_work";
    case "EXPERIENCE_DIRECTION_CONFLICT": return answer === "current_evidence" || answer === "future_direction";
  }
}

function validateAnswers(value: unknown, answerRevision: number, requireComplete: boolean): value is DesiredClientAnswers {
  if (!hasExactKeys(value, ANSWER_KEYS) && !hasExactKeys(value, [...ANSWER_KEYS, "write_ins"])) return false;
  const answers = value;
  if (answers.schema_version !== "dcm-v2.1" || answers.revision !== answerRevision ||
      !Number.isSafeInteger(answers.revision) || answers.revision < 0) return false;
  const writeIns = answers.write_ins;
  if (writeIns !== undefined) {
    if (!isRecord(writeIns)) return false;
    if (Object.keys(writeIns).some((key) => !WRITE_IN_KEYS.includes(key as typeof WRITE_IN_KEYS[number]) || !isOptionalText(writeIns[key]))) return false;
  }
  const own = (key: typeof WRITE_IN_KEYS[number]) => isRecord(writeIns) && typeof writeIns[key] === "string" && (writeIns[key] as string).trim().length > 0;

  if (!hasExactKeys(answers.focus, ["area", "work", "work_other", "service_area", "certainty", "route", "comparison"])) return false;
  const focus = answers.focus;
  if (!(focus.area === null || isKnownArea(focus.area)) || !isOptionalText(focus.work_other) ||
      !isOptionalText(focus.service_area) || !isEnum(focus.certainty, ["chosen", "provisional"], true) ||
      !isEnum(focus.route, ENUMS.route, true)) return false;
  if (focus.work !== null && focus.work !== "other" && (!focus.area || !isKnownWork(focus.area, focus.work))) return false;
  if (focus.work === "other" && !focus.area) return false;
  if (focus.work !== "other" && focus.work_other.trim() !== "") return false;
  if (focus.work === null && (focus.certainty !== null || focus.comparison !== null)) return false;
  if (focus.work === null && !focus.area && (focus.route !== null || focus.service_area.trim() !== "")) return false;
  if (focus.work !== null && focus.certainty === null) return false;
  if (focus.work === null && focus.certainty !== null) return false;
  if (focus.certainty === "provisional" && !focus.comparison) return false;
  if (requireComplete && focus.route !== null && focus.work === null) return false;
  if (focus.comparison !== null) {
    if (!focus.area || !hasExactKeys(focus.comparison, ["a", "b", "selected"])) return false;
    const comparison = focus.comparison as unknown as WorkComparison;
    if (!validCandidate(comparison.a, focus.area) || !validCandidate(comparison.b, focus.area) ||
        comparison.a.work === comparison.b.work || !["a", "b"].includes(comparison.selected)) return false;
    const selected = comparison[comparison.selected];
    if (focus.work !== selected.work || (focus.certainty !== "chosen" && focus.certainty !== "provisional")) return false;
  }

  if (!hasExactKeys(answers.situation, ["timing", "role", "role_other", "contact"])) return false;
  const situation = answers.situation;
  if (!isEnum(situation.timing, ENUMS.timing, true) || !isOptionalText(situation.role_other) ||
      !isEnum(situation.contact, ENUMS.contact, true)) return false;
  if (situation.role !== null && !focus.area) return false;
  if (situation.role !== null && situation.role !== "other" && situation.role !== "unknown" &&
      (!focus.area || typeof situation.role !== "string" || !Object.hasOwn(AREA_CATALOG[focus.area].roles, situation.role))) return false;
  if (situation.role === null && (situation.role_other.trim() !== "" || situation.contact !== null)) return false;
  if (situation.role !== "other" && situation.role_other.trim() !== "") return false;
  if (!CONTACT_ROLE_SET.has(String(situation.role)) && situation.contact !== null) return false;

  if (!hasExactKeys(answers.client, ["goals", "concerns"]) ||
      !isUniqueChoiceArray(answers.client.goals, ENUMS.goals, 2) || !exclusive(answers.client.goals, "unknown") ||
      !isUniqueChoiceArray(answers.client.concerns, ENUMS.concerns, 2) || !exclusive(answers.client.concerns, "unheard")) return false;

  if (!hasExactKeys(answers.value, ["reasons", "fee_effort", "collected_fee", "team_hours", "payment"])) return false;
  const valueGroup = answers.value;
  if (!isUniqueChoiceArray(valueGroup.reasons, ENUMS.reasons, 3) || (requireComplete && valueGroup.reasons.length === 0 && !own("reasons")) ||
      !exclusive(valueGroup.reasons, "undecided") || !isEnum(valueGroup.fee_effort, ENUMS.feeEffort, true) ||
      !isEnum(valueGroup.collected_fee, ENUMS.collectedFee, true) || !isEnum(valueGroup.team_hours, ENUMS.teamHours, true) ||
      !isEnum(valueGroup.payment, ENUMS.payment, true)) return false;

  if (!hasExactKeys(answers.delivery, ["conditions", "capacity", "limit"])) return false;
  const delivery = answers.delivery;
  if (!isUniqueChoiceArray(delivery.conditions, ENUMS.conditions, 3) || !exclusive(delivery.conditions, "unknown") ||
      !isEnum(delivery.capacity, ENUMS.capacity, true) || !isEnum(delivery.limit, ENUMS.limit, true)) return false;

  if (!hasExactKeys(answers.direction, ["aim", "evidence", "less", "less_note"])) return false;
  const direction = answers.direction;
  if (!isEnum(direction.aim, ENUMS.aim, true) || !isUniqueChoiceArray(direction.evidence, ENUMS.evidence, 6) ||
      !exclusive(direction.evidence, "preference") ||
      (direction.evidence.includes("repeated") && direction.evidence.includes("few")) ||
      !isEnum(direction.less, ENUMS.less, true) || !isOptionalText(direction.less_note)) return false;
  if (direction.less_note.trim() !== "" && !["within", "outside", "model"].includes(String(direction.less))) return false;

  if (!hasExactKeys(answers.clarifications, CLARIFICATION_CODES)) return false;
  for (const code of CLARIFICATION_CODES) {
    const answer = answers.clarifications[code];
    if (answer !== null && !validClarificationAnswer(code, answer)) return false;
  }
  // Clarification answers carry their required canonical updates into the next
  // same-run snapshot, so the submitted history and current fields cannot drift.
  if (answers.clarifications.CLIENT_GOAL_UNCLEAR !== null &&
      (answers.client.goals.length !== 1 || answers.client.goals[0] !== answers.clarifications.CLIENT_GOAL_UNCLEAR)) return false;
  if (answers.clarifications.CURRENT_CAPACITY_CONFLICT === "limited_now" && delivery.capacity !== "limited") return false;
  if (answers.clarifications.CURRENT_CAPACITY_CONFLICT === "build_first" && delivery.capacity !== "change") return false;
  if (answers.clarifications.EXPERIENCE_DIRECTION_CONFLICT === "current_evidence" && focus.route !== "established") return false;
  if (answers.clarifications.EXPERIENCE_DIRECTION_CONFLICT === "future_direction" && direction.aim !== "new_area") return false;

  if (!requireComplete) return true;
  // Review cannot be prepared until every required stage choice is present.
  return !!focus.area && focus.work !== null && focus.route !== null && (situation.timing !== null || own("timing")) &&
    situation.role !== null && (answers.client.goals.length > 0 || own("goals")) && (valueGroup.fee_effort !== null || own("fee_effort")) &&
    (delivery.capacity !== null || own("capacity")) && (direction.aim !== null || own("aim")) && (direction.evidence.length > 0 || own("evidence"));
}

/** Validates an incomplete saved draft without rejecting a normal mid-edit state. */
export function validateDraftAnswers(value: unknown): value is DesiredClientAnswers {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false;
  return validateAnswers(value, value.revision as number, false);
}

export type AnalysisRequestValidation =
  | { valid: true; value: AnalysisRequestEnvelope }
  | { valid: false; reason: string };

export function validateAnalysisRequest(input: unknown): AnalysisRequestValidation {
  const keys = ["schemaVersion", "requestId", "answerRevision", "reviewRunId", "analysisIndex", "aiConsent", "answers", "clarifications"];
  if (!hasExactKeys(input, keys)) return { valid: false, reason: "invalid envelope keys" };
  if (input.schemaVersion !== 2 || input.aiConsent !== true || !Number.isSafeInteger(input.answerRevision) ||
      (input.answerRevision as number) < 0 || ![0, 1, 2].includes(input.analysisIndex as number)) {
    return { valid: false, reason: "invalid envelope values" };
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof input.requestId !== "string" || input.requestId.length > 64 || !uuid.test(input.requestId) ||
      typeof input.reviewRunId !== "string" || input.reviewRunId.length > 64 || !uuid.test(input.reviewRunId)) {
    return { valid: false, reason: "invalid request identifiers" };
  }
  if (!validateAnswers(input.answers, input.answerRevision as number, true)) return { valid: false, reason: "invalid answers" };
  const answers = input.answers as DesiredClientAnswers;
  const clarificationHistory = input.clarifications as AnalysisRequestEnvelope["clarifications"];
  if (!Array.isArray(input.clarifications) || input.clarifications.length > 2) return { valid: false, reason: "invalid clarification history" };
  const seen = new Set<string>();
  for (const item of input.clarifications) {
    if (!hasExactKeys(item, ["code", "answer"]) || !CLARIFICATION_CODES.includes(item.code as ClarificationCode) ||
        seen.has(String(item.code)) || !validClarificationAnswer(item.code as ClarificationCode, item.answer)) {
      return { valid: false, reason: "invalid clarification history" };
    }
    seen.add(item.code as string);
    if (answers.clarifications[item.code as ClarificationCode] !== item.answer) {
      return { valid: false, reason: "clarification history mismatch" };
    }
  }
  const answered = CLARIFICATION_CODES.filter((code) => answers.clarifications[code] !== null);
  if (answered.length !== clarificationHistory.length || answered.some((code) => !seen.has(code))) {
    return { valid: false, reason: "clarification history incomplete" };
  }
  if (input.analysisIndex === 0 && clarificationHistory.length !== 0) return { valid: false, reason: "initial request has history" };

  const value = input as unknown as AnalysisRequestEnvelope;
  return { valid: true, value };
}
