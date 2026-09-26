import type { DesiredClientAnswers } from "./types";
export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface StageDefinition { id: StageId; label: string; heading: string; explanation: string; previewAfter?: boolean; }
export const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  { id: 1, label: "1 Focus", heading: "What legal work do you want more of?", explanation: "Choose one type of work and say whether your firm already handles it or wants to build toward it. This gives the brief a specific focus and keeps a future ambition separate from current experience." },
  { id: 2, label: "2 Situation", heading: "When does this client usually seek help?", explanation: "Identify who needs this work and what usually prompts them to contact a lawyer. This helps your marketing speak to a real situation, while keeping the client separate from the person who first gets in touch." },
  { id: 3, label: "3 Client goal", heading: "What does the client most want to achieve?", explanation: "Consider the progress the client wants and any concerns they bring. Their goal gives your message a useful angle beyond the name of a legal service.", previewAfter: true },
  { id: 4, label: "4 Value", heading: "What makes this work worth pursuing?", explanation: "Think about why this work suits the firm and how the fee compares with the time and effort involved. A larger fee alone does not tell you whether a matter supports the practice you want to build." },
  { id: 5, label: "5 Delivery", heading: "What helps your team deliver this work well?", explanation: "Consider the skills, support, and capacity needed to serve these clients well. This keeps the profile grounded in work your team can handle now, or shows what needs to change first." },
  { id: 6, label: "6 Direction", heading: "What should this work help the firm become known for?", explanation: "Name the reputation you want this work to build and what supports that direction. This connects the profile to future marketing and makes assumptions easier to check." },
  { id: 7, label: "7 Review", heading: "Does this describe the work you want more of?", explanation: "Check your answers together before creating the brief. You can change any section so the final wording reflects the work you actually want to pursue." },
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
  if (!answers.situation.timing && !answers.write_ins?.timing?.trim()) missing.push("situation.timing");
  if (!answers.situation.role) missing.push("situation.role");
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
