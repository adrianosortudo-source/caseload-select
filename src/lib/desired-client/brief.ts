import { CAPACITY_LABELS, COLLECTED_FEE_LABELS, CONDITION_LABELS, CONCERN_LABELS, EVIDENCE_LABELS, GOAL_LABELS, AIM_LABELS, LESS_LABELS, LIMIT_LABELS, PAYMENT_LABELS, TEAM_HOURS_LABELS, TIMING_PHRASES, getFeeEffortLabel, getReasonLabel, getRoleLabel, getWorkLabel, resolveAnswerReference } from "./catalog";

import type { AnswerReferencePath, DesiredClientAnswers, DesiredClientBrief, DesiredClientStatement } from "./types";

export function emptyAnswers(): DesiredClientAnswers {
  return {
    schema_version: "dcm-v2.1", revision: 0,
    focus: { area: null, work: null, work_other: "", service_area: "", certainty: null, route: null, comparison: null },
    situation: { timing: null, role: null, role_other: "", contact: null },
    client: { goals: [], concerns: [] },
    value: { reasons: [], fee_effort: null, collected_fee: null, team_hours: null, payment: null },
    delivery: { conditions: [], capacity: null, limit: null },
    direction: { aim: null, evidence: [], less: null, less_note: "" },
    clarifications: {
      FOCUS_UNCLEAR: null, CLIENT_GOAL_UNCLEAR: null, CURRENT_CAPACITY_CONFLICT: null,
      FEE_EFFORT_CONFLICT: null, EXPERIENCE_DIRECTION_CONFLICT: null,
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

const ISSUE_TEXT: Record<string, string> = {
  unclearWork: "Specify the type of work this profile should focus on.",
  unknownGoal: "Establish the client's main desired result.",
  capacity: "Establish the capacity or support needed before increasing demand.",
  capacityUnknown: "Establish how much of this work the firm can support.",
  fee: "Check whether the fee can support the effort required.",
  experience: "Clarify whether this is established work or a direction to develop.",
  aimUnknown: "Clarify how this work supports the firm's future direction.",
  reasonsUnknown: "Establish why this work is worth pursuing for the firm.",
  evidence: "Test this preference against relevant client and delivery evidence.",
  unknownFee: "Establish whether the economics support this work.",
  unknownRole: "Identify the client role behind this work.",
  timingUnknown: "Establish when this client usually seeks help.",
};
function activeExperienceConflict(answers: DesiredClientAnswers): boolean {
  return answers.focus.route === "new" && answers.direction.aim === "more_current";
}
export function buildOpenQuestions(answers: DesiredClientAnswers, maximum = 3): DesiredClientStatement[] {
  const issues: Array<{ id: string; sources: AnswerReferencePath[] }> = [];
  if (answers.focus.work === "other" && !answers.focus.work_other.trim() && answers.clarifications.FOCUS_UNCLEAR === null)
    issues.push({ id: "unclearWork", sources: ["focus.work", "focus.work_other"] });
  if (answers.client.goals.length === 1 && answers.client.goals[0] === "unknown" && answers.clarifications.CLIENT_GOAL_UNCLEAR === null)
    issues.push({ id: "unknownGoal", sources: ["client.goals"] });
  if (answers.delivery.capacity === "change") issues.push({ id: "capacity", sources: ["delivery.capacity", "focus.route", "direction.aim"] });
  else if (answers.delivery.capacity === "unknown") issues.push({ id: "capacityUnknown", sources: ["delivery.capacity"] });
  if (answers.value.fee_effort === "difficult") issues.push({ id: "fee", sources: ["value.fee_effort", "value.reasons"] });
  if (activeExperienceConflict(answers) && answers.clarifications.EXPERIENCE_DIRECTION_CONFLICT === null)
    issues.push({ id: "experience", sources: ["focus.route", "direction.aim"] });
  if (answers.direction.aim === "unknown") issues.push({ id: "aimUnknown", sources: ["direction.aim"] });
  if (answers.value.reasons.length === 1 && answers.value.reasons[0] === "undecided") issues.push({ id: "reasonsUnknown", sources: ["value.reasons"] });
  if (answers.direction.evidence.includes("preference")) issues.push({ id: "evidence", sources: ["direction.evidence"] });
  if (answers.value.fee_effort === "unknown") issues.push({ id: "unknownFee", sources: ["value.fee_effort"] });
  if (answers.situation.role === "unknown" || (answers.situation.role === "other" && !answers.situation.role_other.trim()))
    issues.push({ id: "unknownRole", sources: ["situation.role", "situation.role_other"] });
  if (answers.situation.timing === "unknown") issues.push({ id: "timingUnknown", sources: ["situation.timing"] });
  return issues.slice(0, maximum).map(({ id, sources }) => ({ text: ISSUE_TEXT[id], kind: "unknown", source_answer_ids: sources }));
}
function statement(text: string, kind: DesiredClientStatement["kind"], sources: AnswerReferencePath[]): DesiredClientStatement {
  return { text, kind, source_answer_ids: [...new Set(sources)].slice(0, 6) };
}
function presentSources(answers: DesiredClientAnswers, paths: AnswerReferencePath[]): AnswerReferencePath[] {
  return paths.filter((path) => { const result = resolveAnswerReference(path, answers); return result.present && !result.unknown && result.value !== null; });
}
function selectedGoals(answers: DesiredClientAnswers): string[] {
  if (answers.client.goals.length === 1 && answers.client.goals[0] === "unknown") return ["The client's main goal is still to be established."];
  return answers.client.goals.map((id) => GOAL_LABELS[id]);
}
function workValue(answers: DesiredClientAnswers): string {
  if (answers.focus.work === "other") return answers.focus.work_other.trim() || "a type of work still to be specified";
  if (answers.focus.work && answers.focus.area) return getWorkLabel(answers.focus.area, answers.focus.work);
  return "a type of work still to be specified";
}
function roleValue(answers: DesiredClientAnswers): string {
  if (answers.situation.role === "other") return answers.situation.role_other.trim() || "a client role still to be established";
  if (answers.situation.role === "unknown" || !answers.situation.role) return "a client role still to be established";
  if (answers.focus.area) return getRoleLabel(answers.focus.area, answers.situation.role);
  return "a client role still to be established";
}
export function hasRefinedComparisonAnswers(answers: DesiredClientAnswers): boolean {
  const comparison = answers.focus.comparison;
  if (!comparison) return false;
  const candidate = comparison[comparison.selected];
  return (answers.value.fee_effort !== null && answers.value.fee_effort !== candidate.fee_effort)
    || (answers.delivery.capacity !== null && answers.delivery.capacity !== candidate.capacity);
}
export function buildStructuredBrief(answers: DesiredClientAnswers): DesiredClientBrief {
  const work = workValue(answers);
  const role = roleValue(answers);
  const route = answers.focus.route;
  const timing = answers.situation.timing ?? "unknown";
  const own = answers.write_ins ?? {};
  const unknownFocus = answers.focus.work === "other" && !answers.focus.work_other.trim();
  const unknownRole = answers.situation.role === "unknown" || !answers.situation.role
    || (answers.situation.role === "other" && !answers.situation.role_other.trim());
  let definitionText = "The firm wants to explore " + work + " for " + role + ". " + (own.timing?.trim() ? "Client timing supplied: " + own.timing.trim() + "." : "Clients usually seek help " + TIMING_PHRASES[timing] + ".");
  if (route === "established") definitionText += " This is work the firm already handles.";
  if (route === "new") definitionText += " This is a direction the firm is building toward.";
  if (route === "exploring") definitionText += " This is a direction the firm is considering.";
  if (answers.focus.certainty === "provisional") definitionText += " The choice remains provisional.";
  const definitionSources: AnswerReferencePath[] = [];
  definitionSources.push(answers.focus.work === "other" && answers.focus.work_other.trim() ? "focus.work_other" : "focus.work");
  definitionSources.push(answers.situation.role === "other" && answers.situation.role_other.trim() ? "situation.role_other" : "situation.role");
  definitionSources.push(own.timing?.trim() ? "write_ins.timing" : "situation.timing", "focus.route");
  if (answers.focus.certainty === "provisional") definitionSources.push("focus.certainty");
  if (answers.focus.service_area.trim()) definitionSources.push("focus.service_area");
  let definitionKind: DesiredClientStatement["kind"] = unknownFocus || unknownRole ? "unknown" : route === "established" ? "preference" : "hypothesis";
  if (!route || !answers.focus.certainty) definitionKind = "unknown";
  const definition = statement(definitionText, definitionKind, definitionSources);

  if (answers.focus.service_area.trim()) {
    definition.text += ` Service area supplied: ${answers.focus.service_area.trim()}.`;
  }

  const clientGoals: DesiredClientStatement[] = selectedGoals(answers).map((goal) => statement(
    goal,
    answers.client.goals.includes("unknown") ? "unknown" : "preference", ["client.goals"],
  ));
  if (own.goals?.trim()) clientGoals.push(statement(own.goals.trim(), "preference", ["write_ins.goals"]));
  if (answers.client.concerns.length || own.concerns?.trim()) {
    const concerns = [...answers.client.concerns.map((id) => CONCERN_LABELS[id]), ...(own.concerns?.trim() ? [own.concerns.trim()] : [])].join(", ");
    const expected = route === "new" || route === "exploring";
    clientGoals.push(statement(`Concerns to understand: ${concerns}.${expected ? " These concerns are assumptions to check." : ""}`,
      answers.client.concerns.includes("unheard") ? "unknown" : expected ? "hypothesis" : own.concerns?.trim() ? "preference" : "experience", [...(answers.client.concerns.length ? ["client.concerns" as const] : []), ...(own.concerns?.trim() ? ["write_ins.concerns" as const] : [])]));
  }

  const firmReasons = answers.value.reasons.length === 1 && answers.value.reasons[0] === "undecided"
    ? [statement("The reasons for pursuing this work are still to be established.", "unknown", ["value.reasons"])]
    : answers.value.reasons.map((id) => statement(getReasonLabel(id, route), route === "established" ? "experience" : "preference", ["value.reasons"]));
  if (own.reasons?.trim()) firmReasons.push(statement(own.reasons.trim(), "preference", ["write_ins.reasons"]));

  const deliveryConditions: DesiredClientStatement[] = [];
  const conditions = answers.delivery.conditions;
  const conditionText = conditions.length
    ? conditions.includes("unknown") ? "The team is still establishing a delivery process."
      : `The team identified these conditions: ${conditions.map((id) => CONDITION_LABELS[id]).join(", ")}.`
    : own.conditions?.trim() ? "The team named another delivery condition." : "No specific delivery conditions have been supplied.";
  const conditionSources: AnswerReferencePath[] = conditions.length || !own.conditions?.trim() ? ["delivery.conditions"] : [];
  if (own.conditions?.trim()) conditionSources.push("write_ins.conditions");
  if (own.limit?.trim()) conditionSources.push("write_ins.limit");
  const conditionKind: DesiredClientStatement["kind"] = conditions.includes("unknown") || (!conditions.length && !own.conditions?.trim()) ? "unknown" : own.conditions?.trim() ? "preference" : route === "established" ? "experience" : "preference";
  const additionalConditions = (own.conditions?.trim() ? " Additional condition: " + own.conditions.trim() + "." : "") + (own.limit?.trim() ? " Additional limit: " + own.limit.trim() + "." : "");
  if (answers.delivery.limit && answers.delivery.limit !== "none") {
    conditionSources.push("delivery.limit");
    deliveryConditions.push(statement(conditionText + " Important limit: " + LIMIT_LABELS[answers.delivery.limit] + "." + additionalConditions, conditionKind, conditionSources));
  } else deliveryConditions.push(statement(conditionText + additionalConditions, conditionKind, conditionSources));

  const capacity = answers.delivery.capacity;
  const refined = hasRefinedComparisonAnswers(answers);
  let capacityText = own.capacity?.trim() ? "Capacity as described: " + own.capacity.trim() + "." : capacity ? "Capacity: " + CAPACITY_LABELS[capacity] + "." : "Capacity still needs to be established.";
  const capacitySources: AnswerReferencePath[] = own.capacity?.trim() ? ["write_ins.capacity"] : ["delivery.capacity"];
  if (capacity === "change" && answers.clarifications.CURRENT_CAPACITY_CONFLICT === "build_first") capacityText += " Build capacity before increasing demand.";
  if (refined && answers.focus.comparison) {
    capacityText += " Your answers were refined after the comparison.";
    const selected = answers.focus.comparison.selected;
    if (answers.value.fee_effort !== answers.focus.comparison[selected].fee_effort) capacitySources.push("value.fee_effort", `focus.comparison.${selected}.fee_effort`);
    if (answers.delivery.capacity !== answers.focus.comparison[selected].capacity) capacitySources.push(`focus.comparison.${selected}.capacity`);
  }
  deliveryConditions.push(statement(capacityText, capacity === "unknown" || (!capacity && !own.capacity?.trim()) ? "unknown" : own.capacity?.trim() ? "preference" : route === "established" ? "experience" : "preference", capacitySources));
  const feeText = own.fee_effort?.trim() || (answers.value.fee_effort ? getFeeEffortLabel(answers.value.fee_effort, route) : "Not established");
  deliveryConditions.push(statement((route === "established" ? "Fee" : "Expected fee") + " compared with effort: " + feeText + ".", answers.value.fee_effort === "unknown" || (!answers.value.fee_effort && !own.fee_effort?.trim()) ? "unknown" : own.fee_effort?.trim() ? "preference" : route === "established" ? "experience" : "hypothesis", [own.fee_effort?.trim() ? "write_ins.fee_effort" : "value.fee_effort"]));

  const commercial: string[] = [];
  const commercialSources: AnswerReferencePath[] = [];
  if (answers.value.collected_fee && answers.value.collected_fee !== "unknown" && answers.value.collected_fee !== "private") {
    commercial.push(`Fee: ${COLLECTED_FEE_LABELS[answers.value.collected_fee]}`); commercialSources.push("value.collected_fee");
  }
  if (answers.value.team_hours && answers.value.team_hours !== "unknown") {
    commercial.push(`Total team time: ${TEAM_HOURS_LABELS[answers.value.team_hours]}`); commercialSources.push("value.team_hours");
  }
  if (answers.value.payment && answers.value.payment !== "unknown") {
    commercial.push(`Payment: ${PAYMENT_LABELS[answers.value.payment]}`); commercialSources.push("value.payment");
  }
  if (commercial.length) {
    const label = route === "established" ? "Commercial ranges supplied" : "Planned commercial ranges";
    deliveryConditions.push(statement(`${label}: ${commercial.join("; ")}.`, route === "established" ? "experience" : "preference", commercialSources));
  }
  const evidenceText = answers.direction.evidence.length === 0 && own.evidence?.trim() ? "Supporting basis supplied: " + own.evidence.trim() + "." : answers.direction.evidence.includes("preference")
    ? "This definition is based mainly on your preferences at this stage."
    : "You identified: " + answers.direction.evidence.map((id) => EVIDENCE_LABELS[id]).join(", ") + (own.evidence?.trim() ? "; " + own.evidence.trim() : "") + ".";
  const evidenceKind: DesiredClientStatement["kind"] = own.evidence?.trim() ? "preference" : answers.direction.evidence.includes("preference")
    ? "preference" : route === "established" ? "experience" : "hypothesis";
  const evidence = [
    statement(evidenceText, evidenceKind, [...(answers.direction.evidence.length ? ["direction.evidence" as const] : []), ...(own.evidence?.trim() ? ["write_ins.evidence" as const] : [])]),
    statement("Direction sought: " + (own.aim?.trim() ?? (answers.direction.aim ? AIM_LABELS[answers.direction.aim] : AIM_LABELS.unknown)) + ".", !own.aim?.trim() && (answers.direction.aim === "unknown" || !answers.direction.aim) ? "unknown" : "preference", [own.aim?.trim() ? "write_ins.aim" : "direction.aim"]),
  ];
  const openQuestions = buildOpenQuestions(answers);
  const feeInterpretation = answers.clarifications.FEE_EFFORT_CONFLICT;
  if (feeInterpretation === "improve_model" || feeInterpretation === "reconsider_work") {
    const existing = openQuestions.find((item) => item.source_answer_ids.includes("value.fee_effort"));
    if (existing) {
      existing.text += feeInterpretation === "improve_model"
        ? " You indicated the economics need to improve."
        : " You indicated that the work needs reconsideration.";
      existing.source_answer_ids.push("clarifications.FEE_EFFORT_CONFLICT");
    }
  }
  const topicWork = workValue(answers).replace(/^a type of work/, "type of work");
  const suggestionSources = presentSources(answers, ["focus.work", "focus.area", "focus.route"]);
  const marketing = {
    topic: statement(answers.focus.work === "other" && !answers.focus.work_other.trim()
      ? "Choose one specific type of work before drafting a marketing topic."
      : `A plain-language explanation of ${topicWork}: when a client might seek help and what they can prepare.`, "suggestion", suggestionSources),
    inquiry_question: statement("What are you hoping to achieve, and what stage has the matter reached?", "suggestion",
      presentSources(answers, ["client.goals", "situation.timing", "focus.work"]).slice(0, 3)),
    validation_step: statement(route === "established"
      ? "Review five recent examples of this work. Compare the time involved, collected fees, client feedback and delivery demands with this profile."
      : "Ask two people with relevant client or practice experience to review this direction. Check the expected client need, delivery requirements and commercial assumptions.",
      "suggestion", presentSources(answers, ["focus.route", "direction.evidence", "value.fee_effort", "delivery.conditions", "delivery.capacity"]).slice(0, 5)),
  };
  const workToPromoteLess: DesiredClientStatement[] = [];
  if (answers.direction.less && answers.direction.less !== "none") {
    const note = answers.direction.less_note.trim();
    workToPromoteLess.push(statement(`Work to promote less: ${LESS_LABELS[answers.direction.less]}${note ? `. ${note}` : ""}.`,
      "preference", note ? ["direction.less", "direction.less_note"] : ["direction.less"]));
  }
  if (!answers.focus.service_area.trim()) {
    // The view/export layer renders this separate factual note so it never consumes an open-question slot.
    void "Service area not supplied.";
  }
  return { definition, client_goals: clientGoals, firm_reasons: firmReasons, delivery_conditions: deliveryConditions,
    evidence, open_questions: openQuestions, marketing, work_to_promote_less: workToPromoteLess };
}
export const BRIEF_SECTION_HEADINGS = [
  "Work to pursue", "What the client wants to achieve", "Why this work appeals to your firm",
  "Conditions for delivering it well", "What supports this definition", "Still to check", "Use it in your marketing",
] as const;

const DISMISSED_ISSUES: Record<import("./types").ClarificationCode,string> = {
  FOCUS_UNCLEAR: "Specify the type of work this profile should focus on.",
  CLIENT_GOAL_UNCLEAR: "Establish the client's main desired result.",
  CURRENT_CAPACITY_CONFLICT: "Establish the capacity or support needed before increasing demand.",
  FEE_EFFORT_CONFLICT: "Check whether the fee can support the effort required.",
  EXPERIENCE_DIRECTION_CONFLICT: "Clarify whether this is established work or a direction to develop.",
};
export function getDismissedClarificationText(code: import("./types").ClarificationCode): string { return DISMISSED_ISSUES[code]; }
