import { resolveAnswerReference } from "./catalog";
import type {
  AnalysisResult,
  AnswerReferencePath,
  ClarificationCode,
  DesiredClientAnswers,
  DesiredClientStatement,
} from "./types";

const SOURCE_PATHS = new Set<string>([
  "focus.area", "focus.work", "focus.work_other", "focus.service_area", "focus.certainty", "focus.route",
  "situation.timing", "situation.role", "situation.role_other", "situation.contact",
  "client.goals", "client.concerns", "value.reasons", "value.fee_effort", "value.collected_fee", "value.team_hours", "value.payment",
  "delivery.conditions", "delivery.capacity", "delivery.limit", "direction.aim", "direction.evidence", "direction.less", "direction.less_note",
  "clarifications.FOCUS_UNCLEAR", "clarifications.CLIENT_GOAL_UNCLEAR", "clarifications.CURRENT_CAPACITY_CONFLICT",
  "clarifications.FEE_EFFORT_CONFLICT", "clarifications.EXPERIENCE_DIRECTION_CONFLICT",
  ...(["a", "b"] as const).flatMap((side) => ["work", "fee_effort", "team_fit", "capacity", "evidence"].map((field) => `focus.comparison.${side}.${field}`)),
]);
const STATEMENT_KINDS = ["experience", "preference", "hypothesis", "unknown", "suggestion"] as const;
const BANNED_TEXT = [
  /<\/?[a-z][^>]*>/i,
  /https?:\/\//i,
  /\bwww\./i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\[[^\]]+\]\([^)]+\)/,
  /%|\bpercent(?:age)?\b/i,
  /\u2014/,
];
const PROFIT_CLAIM = /\b(?:profit|ROI|return on investment|net margin|hourly rate|per hour)\b/i;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is RecordValue {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function numericTokens(text: string): string[] {
  return [...text.matchAll(/(?:[$€£]\s*)?\d+(?:[\s,]\d{3})*(?:\.\d+)?/gu)]
    .map((match) => match[0].replace(/[^\d.]/g, ""));
}

function isNonExperienceSource(path: AnswerReferencePath, answers: DesiredClientAnswers): boolean {
  if (["focus.area", "focus.work", "focus.work_other", "focus.service_area", "focus.certainty", "direction.aim", "direction.less", "direction.less_note"].includes(path)) return true;
  if (path === "direction.evidence") return answers.direction.evidence.length === 1 && answers.direction.evidence[0] === "preference";
  if (path === "client.concerns") return answers.client.concerns.length === 1 && answers.client.concerns[0] === "unheard";
  if (path.startsWith("focus.comparison.")) {
    const [, , side, field] = path.split(".");
    const candidate = answers.focus.comparison?.[side as "a" | "b"];
    if (!candidate || field === "work") return true;
    if (field === "evidence") return candidate.evidence === "none";
    if (field === "team_fit") return candidate.team_fit !== "proven";
  }
  return false;
}

function hasReportedExperienceSource(paths: readonly AnswerReferencePath[], answers: DesiredClientAnswers): boolean {
  return paths.some((path) => !isNonExperienceSource(path, answers));
}

function validStatement(value: unknown, answers: DesiredClientAnswers, maxTextLength: number, allowUnknownSuggestion = false): value is DesiredClientStatement {
  if (!hasExactKeys(value, ["text", "kind", "source_answer_ids"]) || typeof value.text !== "string") return false;
  const text = value.text.trim();
  if (text.length < 1 || text.length > maxTextLength || BANNED_TEXT.some((pattern) => pattern.test(text))) return false;
  if (PROFIT_CLAIM.test(text) && numericTokens(text).length > 0) return false;
  if (typeof value.kind !== "string" || !STATEMENT_KINDS.includes(value.kind as DesiredClientStatement["kind"])) return false;
  if (!Array.isArray(value.source_answer_ids) || value.source_answer_ids.length < 1 || value.source_answer_ids.length > 6 ||
      value.source_answer_ids.some((path) => typeof path !== "string" || !SOURCE_PATHS.has(path)) ||
      new Set(value.source_answer_ids).size !== value.source_answer_ids.length) return false;
  const sourcePaths = value.source_answer_ids as AnswerReferencePath[];
  if (value.kind === "experience" &&
      (answers.focus.route !== "established" || !hasReportedExperienceSource(sourcePaths, answers))) return false;

  const sources: string[] = [];
  for (const sourcePath of sourcePaths) {
    const resolved = resolveAnswerReference(sourcePath, answers);
    if (!resolved.present || (resolved.unknown && value.kind !== "unknown" && !(allowUnknownSuggestion && value.kind === "suggestion"))) return false;
    if (resolved.value) sources.push(resolved.value);
  }
  const groundedNumbers = new Set(numericTokens(sources.join(" ")));
  if (numericTokens(text).some((token) => !groundedNumbers.has(token))) return false;
  return true;
}

function validStatements(value: unknown, answers: DesiredClientAnswers, min: number, max: number): value is DesiredClientStatement[] {
  return Array.isArray(value) && value.length >= min && value.length <= max && value.every((item) => validStatement(item, answers, 360));
}

/** Strictly validates model results and saved AI briefs before rendering. */
export function validateAnalysisResult(
  value: unknown,
  answers: DesiredClientAnswers,
  eligibleCodes: readonly ClarificationCode[],
): AnalysisResult | null {
  if (!hasExactKeys(value, ["brief", "clarification_code"])) return null;
  if (value.clarification_code !== null &&
      (typeof value.clarification_code !== "string" || !eligibleCodes.includes(value.clarification_code as ClarificationCode))) return null;
  const brief = value.brief;
  if (!hasExactKeys(brief, ["definition", "client_goals", "firm_reasons", "delivery_conditions", "evidence", "open_questions", "marketing", "work_to_promote_less"])) return null;
  if (!validStatement(brief.definition, answers, 600) ||
      !validStatements(brief.client_goals, answers, 1, 3) ||
      !validStatements(brief.firm_reasons, answers, 1, 3) ||
      !validStatements(brief.delivery_conditions, answers, 1, 4) ||
      !validStatements(brief.evidence, answers, 1, 3) ||
      !validStatements(brief.open_questions, answers, 0, 3) ||
      !validStatements(brief.work_to_promote_less, answers, 0, 1) ||
      !hasExactKeys(brief.marketing, ["topic", "inquiry_question", "validation_step"]) ||
      !validStatement(brief.marketing.topic, answers, 360) ||
      !validStatement(brief.marketing.inquiry_question, answers, 360) ||
      !validStatement(brief.marketing.validation_step, answers, 360, true)) return null;
  return value as unknown as AnalysisResult;
}
