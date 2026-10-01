import type { DesiredClientAnswers } from "./types";

export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface StageDefinition { id: StageId; label: string; heading: string; explanation: string; }

export const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  { id: 1, label: "1 Practice", heading: "What work does the firm want to build around?", explanation: "Name the direction, relevant current-practice context, and work that should receive less marketing emphasis." },
  { id: 2, label: "2 Matter focus", heading: "Which client situation and specific matter do you want more of?", explanation: "Choose the work, who needs help, what has happened, the stage they are at, and the progress they seek. Compare two types of work if you are deciding between them." },
  { id: 3, label: "3 Work value", heading: "Why would the firm welcome this work again?", explanation: "Consider client benefit, fees, effort, the team’s experience, enjoyment and capacity. Separate what you have observed from estimates and hopes." },
  { id: 4, label: "4 Firm fit", heading: "Why might this client choose your firm?", explanation: "Consider what this client values, which firm strength matters to them, and what experience or evidence supports that strength. It is fine if you are still finding out." },
  { id: 5, label: "5 Matter signals", heading: "What would help you recognize this matter?", explanation: "Describe visible circumstances that distinguish this work and merit a closer look. These are prompts for lawyer review, not automatic acceptance rules." },
  { id: 6, label: "6 Evidence", heading: "Where have these clients come from, and what do you know?", explanation: "Use enquiries, retained matters, referrals, repeat clients or other experience. Mark estimates and unknowns clearly; you do not need a campaign plan." },
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
  if (!answers.practice.experience) missing.push("practice.experience");
  if (!answers.focus.area) missing.push("focus.area");
  if (!answers.focus.work || answers.focus.work === "other" && !answers.focus.work_other.trim()) missing.push("focus.work");
  if (!answers.situation.role || answers.situation.role === "other" && !answers.situation.role_other.trim()) missing.push("situation.role");
  if (!answers.situation.trigger && !answers.write_ins?.trigger?.trim()) missing.push("situation.trigger");
  if (!answers.situation.timing) missing.push("situation.timing");
  if (!answers.client_context.repeat_matter_pattern.trim()) missing.push("client_context.repeat_matter_pattern");
  if (answers.client.goals.length === 0) missing.push("client.goals");
  if (!answers.client.goal_detail.trim() && !answers.client.goals.includes("unknown")) missing.push("client.goal_detail");
  if (answers.value.reasons.length === 0 && !answers.write_ins?.reasons?.trim()) missing.push("value.reasons");
  if (!answers.value.fee_effort) missing.push("value.fee_effort");
  if (answers.client.choice_priorities.length === 0) missing.push("client.choice_priorities");
  if (!answers.practice.client_strength) missing.push("practice.client_strength");
  if (answers.delivery.fit_signals.length === 0 && !answers.write_ins?.fit_signals?.trim()) missing.push("delivery.fit_signals");
  if (answers.opportunity.sources.length === 0) missing.push("opportunity.sources");
  return missing;
}

export function getMissingFieldsForStage(stage: StageId, answers: DesiredClientAnswers): string[] {
  const byStage: Record<Exclude<StageId, 7>, string[]> = {
    1: ["practice.direction"],
    2: ["focus.area", "focus.work", "situation.role", "situation.trigger", "situation.timing", "client_context.repeat_matter_pattern", "client.goals", "client.goal_detail", "practice.experience"],
    3: ["value.reasons", "value.fee_effort"],
    4: ["client.choice_priorities", "practice.client_strength"],
    5: ["delivery.fit_signals"],
    6: ["opportunity.sources"],
  };
  const missing = new Set(getMissingRequiredFields(answers));
  return stage === 7 ? [] : byStage[stage].filter((key) => missing.has(key));
}
export function isStageComplete(stage: StageId, answers: DesiredClientAnswers): boolean {
  return getMissingFieldsForStage(stage, answers).length === 0;
}
export function nextStage(stage: StageId): StageId { return Math.min(7, stage + 1) as StageId; }
export function previousStage(stage: StageId): StageId { return Math.max(1, stage - 1) as StageId; }
