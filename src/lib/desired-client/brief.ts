import { GOAL_LABELS, getRoleLabel, getWorkLabel } from "./catalog";

import type { DesiredClientAnswers } from "./types";

export function emptyAnswers(): DesiredClientAnswers {
  return {
    schema_version: "dcm-v3.2", revision: 0,
    interview: { ai_clarification_consent: false, clarification_count: 0, clarified_stages: [], followups: [] },
    focus: { area: null, work: null, work_other: "", service_area: "", certainty: null, route: null, comparison: null },
    practice: { direction: null, firm_type: "", capability: "", enjoys: "", experience: null, development_needs: [], client_strength: null, client_strength_effect: "", client_strength_support: "" },
    client_context: { geography: "", relevant_circumstances: "", community_focus: "", language_service_needs: "", repeat_matter_pattern: "", discovery_behaviour: "" },
    situation: { trigger: null, timing: null, role: null, role_other: "", contact: null },
    client: { goals: [], goal_detail: "", concerns: [], decision_needs: [], decision_context: "", pathway_basis: null, choice_priorities: [], choice_detail: "", choice_basis: null },
    value: { reasons: [], fee_effort: null, collected_fee: null, team_hours: null, payment: null, currency: "", fee_amount: "", direct_cost_amount: "", amount_basis: null, amount_scope: null },
    delivery: { conditions: [], capacity: null, limit: null, fit_signals: [] },
    direction: { aim: null, evidence: [], less: null, less_reason: null, less_note: "" },
    opportunity: { sources: [], data_basis: null, source_detail: "", period: "", enquiry_count: "", retained_count: "", conversion: "", acquisition_cost: "", uncertainty: "" },
    repeatability: { success_measure: null, success_other: "", target: "", review_period: "", additional_matters: "", staffing_constraint: "" },
    clarifications: {
      CLIENT_MATTER_UNCLEAR: null, VALUE_EFFORT_CONFLICT: null, CAPACITY_CONFLICT: null,
      REPEATABILITY_UNPROVEN: null, OPPORTUNITY_UNSUPPORTED: null,
    },
  };
}
export interface PreviewRow { label: "Work" | "Client" | "Goal"; value: string; }
export interface DraftPreview { label: string; badge: string; rows: PreviewRow[]; notes: string[]; }
export function buildDraftPreview(answers: DesiredClientAnswers): DraftPreview {
  const area = answers.focus.area;
  const work = answers.focus.work && area
    ? answers.focus.work === "other" ? answers.focus.work_other.trim() || "Type of work still to specify" : getWorkLabel(area, answers.focus.work)
    : "Type of work still to specify";
  const role = !answers.situation.role || answers.situation.role === "unknown" ? "Client role still to specify"
    : answers.situation.role === "other" ? answers.situation.role_other.trim() || "Client role still to specify"
    : area ? getRoleLabel(area, answers.situation.role) : "Client role still to specify";
  const goals = answers.client.goals.length === 1 && answers.client.goals[0] === "unknown" ? "Client goal still to establish" : [...answers.client.goals.map((goal) => GOAL_LABELS[goal]), ...(answers.write_ins?.goals?.trim() ? [answers.write_ins.goals.trim()] : [])].join(", ") || "Client goal still to establish";
  const notes: string[] = [];
  if (answers.focus.route === "new") notes.push("This is a direction you are building toward.");
  if (answers.focus.route === "exploring" || answers.focus.certainty === "provisional") notes.push("This is a direction to test.");
  return { label: "Your starting point", badge: "Draft to refine", rows: [{ label: "Work", value: work }, { label: "Client", value: role }, { label: "Goal", value: goals }], notes };
}

export { buildStructuredBlueprintV4 as buildStructuredBrief } from "./structured-blueprint";
export const BRIEF_SECTION_HEADINGS = [
  "Work to pursue", "What the client wants to achieve", "Why this work appeals to your firm",
  "Conditions for delivering it well", "What supports this definition", "Still to check", "Use it in your marketing",
] as const;

const DISMISSED_ISSUES: Record<import("./types").ClarificationCode,string> = {
  CLIENT_MATTER_UNCLEAR: "Specify the client situation and matter this profile should focus on.",
  VALUE_EFFORT_CONFLICT: "Check whether the economics and effort support this work.",
  CAPACITY_CONFLICT: "Establish the capacity or support needed before increasing demand.",
  REPEATABILITY_UNPROVEN: "Clarify what evidence would show this work can be repeated.",
  OPPORTUNITY_UNSUPPORTED: "Identify what evidence could test demand for this work.",
};
export function getDismissedClarificationText(code: import("./types").ClarificationCode): string { return DISMISSED_ISSUES[code]; }
