import { GOAL_LABELS } from "./catalog";
import type { ClarificationCode, DesiredClientAnswers } from "./types";

export const CLARIFICATION_ORDER: readonly ClarificationCode[] = [
  "CLIENT_MATTER_UNCLEAR", "VALUE_EFFORT_CONFLICT", "CAPACITY_CONFLICT", "REPEATABILITY_UNPROVEN", "OPPORTUNITY_UNSUPPORTED",
];
export type ClarificationOption = { id: string; label: string };
export interface ClarificationDefinition { reason: string; question: string; options: readonly ClarificationOption[]; }
const open: ClarificationOption = { id: "open", label: "Leave this uncertain and create the Blueprint" };
export const CLARIFICATION_BANK: Record<ClarificationCode, ClarificationDefinition> = {
  CLIENT_MATTER_UNCLEAR: {
    reason: "The client situation or matter is still broad.", question: "Would a narrower client situation make this profile more useful?",
    options: [{ id: "choose_specific", label: "Choose a more specific situation" }, { id: "keep_broad", label: "Keep this broad for now" }, open],
  },
  VALUE_EFFORT_CONFLICT: {
    reason: "The firm wants more of this work, but its fee and effort may not align.", question: "What should guide this candidate profile?",
    options: [{ id: "improve_model", label: "The delivery or fee model needs to improve" }, { id: "reconsider_work", label: "Reconsider whether to pursue this work" }, open],
  },
  CAPACITY_CONFLICT: {
    reason: "The firm wants more work but may need to change capacity first.", question: "How should the profile describe the firm's capacity?",
    options: [{ id: "limited_now", label: "A limited amount is supportable now" }, { id: "build_first", label: "Build capacity before increasing demand" }, open],
  },
  REPEATABILITY_UNPROVEN: {
    reason: "The success measure is selected, but the firm has not described experience supporting repeatability.", question: "How should this result be treated?",
    options: [{ id: "current_evidence", label: "We have relevant experience to review" }, { id: "future_direction", label: "This is a result to test as we build the practice" }, open],
  },
  OPPORTUNITY_UNSUPPORTED: {
    reason: "The selected opportunity source needs an example or remains untested.", question: "What best describes the evidence for reaching this work?",
    options: [{ id: "current_evidence", label: "We have seen this source produce relevant work" }, { id: "future_direction", label: "This is a source or demand hypothesis to test" }, open],
  },
};

export function getEligibleClarificationCodes(answers: DesiredClientAnswers, askedCodes: readonly ClarificationCode[] = []): ClarificationCode[] {
  const eligible: ClarificationCode[] = [];
  if ((answers.focus.work === "other" && !answers.focus.work_other.trim()) || answers.situation.role === "unknown") {
    if (answers.clarifications.CLIENT_MATTER_UNCLEAR === null) eligible.push("CLIENT_MATTER_UNCLEAR");
  }
  if (answers.value.fee_effort === "difficult" && answers.value.reasons.includes("fees") && answers.clarifications.VALUE_EFFORT_CONFLICT === null) eligible.push("VALUE_EFFORT_CONFLICT");
  if (answers.delivery.capacity === "change" && answers.clarifications.CAPACITY_CONFLICT === null) eligible.push("CAPACITY_CONFLICT");
  if (answers.repeatability.success_measure !== null && answers.repeatability.success_measure !== "unknown" &&
    answers.focus.route !== "established" && answers.clarifications.REPEATABILITY_UNPROVEN === null) eligible.push("REPEATABILITY_UNPROVEN");
  if (answers.opportunity.sources.some(source => !["unknown", "no_evidence"].includes(source)) && !answers.opportunity.source_detail.trim() &&
    answers.clarifications.OPPORTUNITY_UNSUPPORTED === null) eligible.push("OPPORTUNITY_UNSUPPORTED");
  const asked = new Set(askedCodes);
  return CLARIFICATION_ORDER.filter(code => eligible.includes(code) && !asked.has(code));
}

export function clarificationOption(code: ClarificationCode, id: string): ClarificationOption | undefined {
  if (id === "open") return open;
  if (code === "CLIENT_MATTER_UNCLEAR" && GOAL_LABELS[id as keyof typeof GOAL_LABELS]) return { id, label: GOAL_LABELS[id as keyof typeof GOAL_LABELS] };
  return CLARIFICATION_BANK[code].options.find(option => option.id === id) ??
    (id.trim().length > 0 && id.length <= 220 ? { id, label: id } : undefined);
}
export function isOpenClarificationChoice(id: string): boolean { return id === "open"; }
