import { GOAL_LABELS } from "./catalog";
import type { ClarificationCode, DesiredClientAnswers } from "./types";

export const CLARIFICATION_ORDER: readonly ClarificationCode[] = [
  "FOCUS_UNCLEAR", "CLIENT_GOAL_UNCLEAR", "CURRENT_CAPACITY_CONFLICT", "FEE_EFFORT_CONFLICT", "EXPERIENCE_DIRECTION_CONFLICT",
];
export type ClarificationOption = { id: string; label: string };
export interface ClarificationDefinition {
  reason: string;
  question: string;
  options: readonly ClarificationOption[];
}
const open: ClarificationOption = { id: "open", label: "Leave this open" };
export const CLARIFICATION_BANK: Record<ClarificationCode, ClarificationDefinition> = {
  FOCUS_UNCLEAR: {
    reason: "The type of work is still broad.",
    question: "Would you like to choose a more specific type of work?",
    options: [{ id: "choose_specific", label: "Choose a type of work" }, { id: "keep_broad", label: "Keep this broad for now" }, open],
  },
  CLIENT_GOAL_UNCLEAR: {
    reason: "The client's main goal is still open.",
    question: "Which result should this profile focus on?",
    options: ["understand", "complete", "resolve", "protect", "prepare", "respond"].map((id) => ({ id, label: GOAL_LABELS[id as keyof typeof GOAL_LABELS] })).concat(open),
  },
  CURRENT_CAPACITY_CONFLICT: {
    reason: "You want more of this work, but capacity needs to change first.",
    question: "How should the profile describe this direction?",
    options: [
      { id: "limited_now", label: "A limited amount now" },
      { id: "build_first", label: "Build capacity before increasing demand" }, open,
    ],
  },
  FEE_EFFORT_CONFLICT: {
    reason: "Your answers differ on whether the fee supports the effort.",
    question: "What should the profile make clear?",
    options: [
      { id: "improve_model", label: "The economics need to improve" },
      { id: "reconsider_work", label: "The work needs reconsideration" }, open,
    ],
  },
  EXPERIENCE_DIRECTION_CONFLICT: {
    reason: "The answers describe both new work and more of established work.",
    question: "Which description should guide this profile?",
    options: [
      { id: "current_evidence", label: "Work we already handle" },
      { id: "future_direction", label: "A direction we are building" }, open,
    ],
  },
};

export function getEligibleClarificationCodes(
  answers: DesiredClientAnswers,
  askedCodes: readonly ClarificationCode[] = [],
): ClarificationCode[] {
  const eligible: ClarificationCode[] = [];
  if (answers.focus.work === "other" && !answers.focus.work_other.trim() && answers.clarifications.FOCUS_UNCLEAR === null) eligible.push("FOCUS_UNCLEAR");
  if (answers.client.goals.length === 1 && answers.client.goals[0] === "unknown" && answers.clarifications.CLIENT_GOAL_UNCLEAR === null) eligible.push("CLIENT_GOAL_UNCLEAR");
  if (answers.delivery.capacity === "change" && answers.focus.route === "established"
      && (answers.direction.aim === "more_current" || answers.direction.aim === "narrower")
      && answers.clarifications.CURRENT_CAPACITY_CONFLICT === null) eligible.push("CURRENT_CAPACITY_CONFLICT");
  if (answers.value.fee_effort === "difficult" && answers.value.reasons.includes("fees")
      && answers.clarifications.FEE_EFFORT_CONFLICT === null) eligible.push("FEE_EFFORT_CONFLICT");
  if (answers.focus.route === "new" && answers.direction.aim === "more_current"
      && answers.clarifications.EXPERIENCE_DIRECTION_CONFLICT === null) eligible.push("EXPERIENCE_DIRECTION_CONFLICT");
  const asked = new Set(askedCodes);
  return CLARIFICATION_ORDER.filter((code) => eligible.includes(code) && !asked.has(code));
}

export function clarificationOption(code: ClarificationCode, id: string): ClarificationOption | undefined {
  return CLARIFICATION_BANK[code].options.find((option) => option.id === id);
}
export function isOpenClarificationChoice(id: string): boolean { return id === "open"; }
