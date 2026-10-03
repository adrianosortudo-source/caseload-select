import { resolveAnswerReference } from "./catalog";
import { DESIRED_CLIENT_ANSWER_PATHS } from "./answer-paths";
import type {
  AnswerReferencePath,
  DesiredClientAnswers,
  InterviewClarificationPrompt,
  InterviewClarificationPurpose,
  InterviewStage,
} from "./types";

export const INTERVIEW_CLARIFICATION_PURPOSES: readonly InterviewClarificationPurpose[] = [
  "client_matter_specificity", "client_goal_detail", "firm_desirability", "client_choice_criteria",
  "strength_and_support", "decision_pathway_observation", "discovery_evidence",
  "economics_effort_conflict", "capacity_conflict",
];

export const INTERVIEW_CLARIFICATION_PURPOSES_BY_STAGE: Record<InterviewStage, readonly InterviewClarificationPurpose[]> = {
  1: ["firm_desirability", "strength_and_support"],
  2: ["client_matter_specificity", "client_goal_detail", "client_choice_criteria", "strength_and_support", "decision_pathway_observation"],
  3: ["firm_desirability", "economics_effort_conflict", "capacity_conflict"],
  4: ["client_choice_criteria", "strength_and_support"],
  5: ["client_matter_specificity", "decision_pathway_observation"],
  6: ["discovery_evidence", "economics_effort_conflict", "capacity_conflict", "decision_pathway_observation"],
};

const SOURCE_PREFIXES_BY_STAGE: Record<InterviewStage, readonly string[]> = {
  1: ["practice.direction", "practice.firm_type", "direction.aim", "direction.less", "direction.less_reason", "direction.less_note"],
  2: ["focus.", "situation.", "client.", "client_context.", "practice.experience", "practice.capability", "practice.development_needs", "write_ins.trigger"],
  3: ["value.", "practice.enjoys", "delivery.conditions", "write_ins.reasons", "write_ins.fee_effort"],
  4: ["client.choice_priorities", "client.choice_detail", "practice.client_strength", "practice.client_strength_effect", "practice.client_strength_support"],
  5: ["delivery.", "client_context.", "situation.", "write_ins.fit_signals"],
  6: ["opportunity.", "repeatability.", "delivery.capacity", "direction."],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASK_KEYS = ["outcome", "id", "stage", "purpose", "source_answer_ids", "question", "choices", "reflection"];

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function isInterviewClarificationSourceForStage(path: unknown, stage: InterviewStage): path is AnswerReferencePath {
  if (typeof path !== "string" || !DESIRED_CLIENT_ANSWER_PATHS.includes(path as AnswerReferencePath)) return false;
  return SOURCE_PREFIXES_BY_STAGE[stage].some((prefix) => prefix.endsWith(".") ? path.startsWith(prefix) : path === prefix);
}

export function hasUsableInterviewClarificationSource(path: AnswerReferencePath, answers: DesiredClientAnswers): boolean {
  try {
    const resolved = resolveAnswerReference(path, answers);
    return resolved.present && typeof resolved.value === "string" && resolved.value.trim().length > 0;
  } catch {
    return false;
  }
}

export function getUsableInterviewClarificationSources(stage: InterviewStage, answers: DesiredClientAnswers): AnswerReferencePath[] {
  return DESIRED_CLIENT_ANSWER_PATHS.filter((path) =>
    isInterviewClarificationSourceForStage(path, stage) && hasUsableInterviewClarificationSource(path, answers),
  );
}

export function isInterviewClarificationAskPrompt(
  value: unknown,
  stage: InterviewStage,
  answers: DesiredClientAnswers,
): value is Extract<InterviewClarificationPrompt, { outcome: "ask" }> {
  if (!record(value) || !hasExactKeys(value, ASK_KEYS) || value.outcome !== "ask" || value.stage !== stage ||
    typeof value.id !== "string" || !UUID.test(value.id) ||
    !INTERVIEW_CLARIFICATION_PURPOSES_BY_STAGE[stage].includes(value.purpose as InterviewClarificationPurpose) ||
    typeof value.question !== "string" || !value.question.trim() || value.question.length > 140 || /[\r\n]/.test(value.question) ||
    typeof value.reflection !== "string" || value.reflection.length > 240 || value.reflection.trim().split(/\s+/).filter(Boolean).length > 35 ||
    !Array.isArray(value.source_answer_ids) || value.source_answer_ids.length < 1 || value.source_answer_ids.length > 4 ||
    !Array.isArray(value.choices) || value.choices.length < 2 || value.choices.length > 4) return false;

  const sources = value.source_answer_ids as unknown[];
  if (new Set(sources).size !== sources.length || !sources.every((path) =>
    isInterviewClarificationSourceForStage(path, stage) && hasUsableInterviewClarificationSource(path, answers),
  )) return false;

  const choiceIds = new Set<string>();
  return value.choices.every((choice) => {
    if (!record(choice) || !hasExactKeys(choice, ["id", "label"]) || typeof choice.id !== "string" ||
      !/^[a-z0-9_-]{1,48}$/.test(choice.id) || choiceIds.has(choice.id) ||
      typeof choice.label !== "string" || !choice.label.trim() || choice.label.length > 100 || /[\r\n]/.test(choice.label)) return false;
    choiceIds.add(choice.id);
    return true;
  });
}

export function normalizeInterviewClarificationContinuePrompt(value: unknown): Extract<InterviewClarificationPrompt, { outcome: "continue" }> | null {
  if (!record(value) || !hasExactKeys(value, ["outcome", "reason"]) || value.outcome !== "continue" ||
    typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 180) return null;
  const reason = value.reason.trim().replace(/\s+/g, " ");
  return reason ? { outcome: "continue", reason } : null;
}

export function normalizeInterviewClarificationModelPrompt(
  value: unknown,
  stage: InterviewStage,
  answers: DesiredClientAnswers,
  createId: () => string,
): InterviewClarificationPrompt | null {
  if (!record(value) || (value.outcome !== "ask" && value.outcome !== "continue")) return null;
  if (value.outcome === "continue") return normalizeInterviewClarificationContinuePrompt(value);

  const allowedModelKeys = ["outcome", "id", "stage", "purpose", "source_answer_ids", "question", "choices", "reflection"];
  if (Object.keys(value).some((key) => !allowedModelKeys.includes(key)) ||
    (Object.hasOwn(value, "id") && typeof value.id !== "string") || value.stage !== stage ||
    typeof value.question !== "string" || !value.question.trim() || value.question.length > 140 || /[\r\n]/.test(value.question) ||
    typeof value.reflection !== "string" || value.reflection.length > 240 || value.reflection.trim().split(/\s+/).filter(Boolean).length > 35 ||
    !Array.isArray(value.choices)) return null;

  const prompt: Extract<InterviewClarificationPrompt, { outcome: "ask" }> = {
    outcome: "ask",
    id: createId(),
    stage,
    purpose: value.purpose as InterviewClarificationPurpose,
    source_answer_ids: value.source_answer_ids as AnswerReferencePath[],
    question: value.question.trim(),
    choices: value.choices as Array<{ id: string; label: string }>,
    reflection: value.reflection.trim(),
  };
  return isInterviewClarificationAskPrompt(prompt, stage, answers) ? prompt : null;
}
