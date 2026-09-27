import type { DesiredClientAnswers } from "./types";
export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface StageDefinition { id: StageId; label: string; heading: string; explanation: string; previewAfter?: boolean; }
export const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  { id: 1, label: "1 Focus", heading: "What legal work do you want more of?", explanation: "Choose one type of work for this profile. A specific focus helps you describe the right client situation and gives your marketing a clear direction." },
  { id: 2, label: "2 Situation", heading: "What brings this client to a lawyer?", explanation: "Identify the event behind the inquiry, the stage the matter has reached, and who needs help. This makes the profile recognizable in marketing and in an initial conversation." },
  { id: 3, label: "3 Client goal", heading: "What is the client trying to achieve?", explanation: "Describe the progress the client wants and what may make taking the next step difficult. These answers help the profile speak to a situation the client can recognize." },
  { id: 4, label: "4 Value", heading: "Why does your firm want more of this work?", explanation: "A desirable matter should benefit the client and support the practice you want to build. Consider the effort, your team's strengths, and the work you would prefer to handle again." },
  { id: 5, label: "5 Delivery", heading: "When is this work a good fit to deliver?", explanation: "Identify what helps your team serve the client well and what to establish early in an inquiry. The profile will turn these answers into practical questions for review." },
  { id: 6, label: "6 Direction", heading: "What direction should this profile support?", explanation: "Connect the profile to the practice you want to build and identify what supports your choices. This keeps established experience, future preferences, and open assumptions clear." },
  { id: 7, label: "7 Review", heading: "Review your direction", explanation: "Review your choices below. We will use them to connect the client situation, the value of the work, and practical delivery conditions. Anything uncertain will remain visible in the profile." },
];
export const COMPARISON_STEPS = [
  { id: 1, heading: "Which two types of work are you considering?" },
  { id: 2, heading: "Compare the two types of work" },
  { id: 3, heading: "Which work should this profile explore?" },
] as const;
export const STAGE_SUMMARY_OWNERS: Record<number, StageId> = { 1: 1, 2: 3, 3: 4, 4: 5, 5: 6 };
export function getStageDefinition(stage: StageId): StageDefinition { return STAGE_DEFINITIONS[stage - 1]; }
export function getMissingRequiredFields(answers: DesiredClientAnswers): string[] {
  const missing: string[] = [];
  if (!answers.focus.area) missing.push("focus.area");
  if (!answers.focus.work) missing.push("focus.work");
  if (!answers.focus.route) missing.push("focus.route");
  if (!answers.situation.trigger && !answers.write_ins?.trigger?.trim()) missing.push("situation.trigger");
  if (!answers.situation.timing && !answers.write_ins?.timing?.trim()) missing.push("situation.timing");
  if (!answers.situation.role) missing.push("situation.role");
  if (answers.delivery.fit_signals.length === 0 && !answers.write_ins?.fit_signals?.trim()) missing.push("delivery.fit_signals");
  if (answers.client.goals.length === 0 && !answers.write_ins?.goals?.trim()) missing.push("client.goals");
  if (answers.value.reasons.length === 0 && !answers.write_ins?.reasons?.trim()) missing.push("value.reasons");
  if (!answers.value.fee_effort && !answers.write_ins?.fee_effort?.trim()) missing.push("value.fee_effort");
  if (!answers.delivery.capacity && !answers.write_ins?.capacity?.trim()) missing.push("delivery.capacity");
  if (!answers.direction.aim && !answers.write_ins?.aim?.trim()) missing.push("direction.aim");
  if (answers.direction.evidence.length === 0 && !answers.write_ins?.evidence?.trim()) missing.push("direction.evidence");
  return missing;
}
export function getMissingFieldsForStage(stage: StageId, answers: DesiredClientAnswers): string[] {
  const byStage: Record<Exclude<StageId, 7>, string[]> = {
    1: ["focus.area", "focus.work", "focus.route"],
    2: ["situation.trigger", "situation.timing", "situation.role"],
    3: ["client.goals"],
    4: ["value.reasons", "value.fee_effort"],
    5: ["delivery.capacity", "delivery.fit_signals"],
    6: ["direction.aim", "direction.evidence"],
  };
  const missing = new Set(getMissingRequiredFields(answers));
  return stage === 7 ? [] : byStage[stage].filter((key) => missing.has(key));
}
export function isStageComplete(stage: StageId, answers: DesiredClientAnswers): boolean {
  return getMissingFieldsForStage(stage, answers).length === 0;
}
export function nextStage(stage: StageId): StageId {
  return Math.min(7, stage + 1) as StageId;
}
export function previousStage(stage: StageId): StageId {
  return Math.max(1, stage - 1) as StageId;
}
