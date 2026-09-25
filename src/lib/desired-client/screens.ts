import type { DesiredClientAnswers } from "./types";
export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface StageDefinition { id: StageId; label: string; heading: string; previewAfter?: boolean; }
export const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  { id: 1, label: "1 Focus", heading: "Which area of work would you like to explore?" },
  { id: 2, label: "2 Situation", heading: "When does this client usually seek help?" },
  { id: 3, label: "3 Client goal", heading: "What does the client most want to achieve?", previewAfter: true },
  { id: 4, label: "4 Value", heading: "What makes this work worth pursuing?" },
  { id: 5, label: "5 Delivery", heading: "What helps your team deliver this work well?" },
  { id: 6, label: "6 Direction", heading: "What should this work help the firm become known for?" },
  { id: 7, label: "7 Review", heading: "Does this describe the work you want more of?" },
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
  if (!answers.situation.timing) missing.push("situation.timing");
  if (!answers.situation.role) missing.push("situation.role");
  if (answers.client.goals.length === 0) missing.push("client.goals");
  if (answers.value.reasons.length === 0) missing.push("value.reasons");
  if (!answers.value.fee_effort) missing.push("value.fee_effort");
  if (!answers.delivery.capacity) missing.push("delivery.capacity");
  if (!answers.direction.aim) missing.push("direction.aim");
  if (answers.direction.evidence.length === 0) missing.push("direction.evidence");
  return missing;
}
export function getMissingFieldsForStage(stage: StageId, answers: DesiredClientAnswers): string[] {
  const byStage: Record<Exclude<StageId, 7>, string[]> = {
    1: ["focus.area", "focus.work", "focus.route"],
    2: ["situation.timing", "situation.role"],
    3: ["client.goals"],
    4: ["value.reasons", "value.fee_effort"],
    5: ["delivery.capacity"],
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
