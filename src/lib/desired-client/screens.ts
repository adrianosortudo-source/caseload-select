import type { DesiredClientAnswers } from "./types";

export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface StageDefinition { id: StageId; label: string; heading: string; explanation: string; }

export const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  { id: 1, label: "1 Practice", heading: "What kind of practice are we building?", explanation: "Your desired client should support work your firm can do well and wants to become known for. Choose the direction that best describes what this profile should help you decide." },
  { id: 2, label: "2 Client & matter", heading: "Which client situation and matter do we want more of?", explanation: "Choose one type of legal work and describe who needs help, what has happened, and when they tend to contact a lawyer. You can compare two types of work here if you are deciding between them." },
  { id: 3, label: "3 Value", heading: "Why would we choose this work again?", explanation: "Consider what the firm keeps, what delivery requires and why the team wants this work. Use what you know; estimates and unknowns are welcome." },
  { id: 4, label: "4 Fit", heading: "What makes an enquiry relevant to this profile?", explanation: "Choose observable signs that would make this type of matter worth a closer look. These are prompts for a lawyer to review, not automatic acceptance rules." },
  { id: 5, label: "5 Opportunity", heading: "What tells us we can attract this work?", explanation: "Start with enquiries, retained matters, referrals or other experience the firm has actually seen. It is fine if the direction has not been tested yet." },
  { id: 6, label: "6 Repeatability", heading: "What would make more of this work worthwhile?", explanation: "Decide what your team can support and what result would justify doing it again. A first profile can set a direction before every measure is known." },
  { id: 7, label: "Review", heading: "Review your direction", explanation: "Your answers shape a provisional client-and-matter profile. Review the direction and the questions still to resolve before asking AI to create the blueprint." },
];

export const COMPARISON_STEPS = [
  { id: 1, heading: "Which two types of work are you considering?" },
  { id: 2, heading: "Compare the two types of work" },
  { id: 3, heading: "Which work should this profile explore?" },
] as const;

export const STAGE_SUMMARY_OWNERS: Record<number, StageId> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
export function getStageDefinition(stage: StageId): StageDefinition { return STAGE_DEFINITIONS[stage - 1]; }

/** Only the ten core groups gate progress. Explicit unknown choices count as answers. */
export function getMissingRequiredFields(answers: DesiredClientAnswers): string[] {
  const missing: string[] = [];
  if (!answers.practice.direction || answers.practice.direction === "other" && !answers.write_ins?.aim?.trim()) missing.push("practice.direction");
  if (!answers.focus.area) missing.push("focus.area");
  if (!answers.focus.work || answers.focus.work === "other" && !answers.focus.work_other.trim()) missing.push("focus.work");
  if (!answers.situation.role || answers.situation.role === "other" && !answers.situation.role_other.trim()) missing.push("situation.role");
  if (!answers.situation.trigger && !answers.write_ins?.trigger?.trim()) missing.push("situation.trigger");
  if (!answers.situation.timing) missing.push("situation.timing");
  if (answers.value.reasons.length === 0 && !answers.write_ins?.reasons?.trim()) missing.push("value.reasons");
  if (answers.delivery.fit_signals.length === 0 && !answers.write_ins?.fit_signals?.trim()) missing.push("delivery.fit_signals");
  if (answers.opportunity.sources.length === 0) missing.push("opportunity.sources");
  if (!answers.delivery.capacity) missing.push("delivery.capacity");
  if (!answers.repeatability.success_measure || answers.repeatability.success_measure === "other" && !answers.repeatability.success_other.trim()) missing.push("repeatability.success_measure");
  return missing;
}

export function getMissingFieldsForStage(stage: StageId, answers: DesiredClientAnswers): string[] {
  const byStage: Record<Exclude<StageId, 7>, string[]> = {
    1: ["practice.direction"],
    2: ["focus.area", "focus.work", "situation.role", "situation.trigger", "situation.timing"],
    3: ["value.reasons"],
    4: ["delivery.fit_signals"],
    5: ["opportunity.sources"],
    6: ["delivery.capacity", "repeatability.success_measure"],
  };
  const missing = new Set(getMissingRequiredFields(answers));
  return stage === 7 ? [] : byStage[stage].filter((key) => missing.has(key));
}
export function isStageComplete(stage: StageId, answers: DesiredClientAnswers): boolean {
  return getMissingFieldsForStage(stage, answers).length === 0;
}
export function nextStage(stage: StageId): StageId { return Math.min(7, stage + 1) as StageId; }
export function previousStage(stage: StageId): StageId { return Math.max(1, stage - 1) as StageId; }
