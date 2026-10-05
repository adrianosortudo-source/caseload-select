import { getAnswerLabel, getWorkLabel, resolveAnswerReference, WRITE_IN_QUESTIONS } from "./catalog";
import { CLARIFICATION_BANK } from "./clarifications";
import { isInterviewClarificationCurrent, type AnswerReferencePath, type DesiredClientAnswers, type StatementKind } from "./types";

export const STATEMENT_KIND_LABELS: Record<StatementKind, string> = {
  experience: "Based on your reported experience",
  preference: "Your preference",
  hypothesis: "To test",
  unknown: "Still open",
  suggestion: "Suggested next step",
};

function questionLabel(path: AnswerReferencePath, answers: DesiredClientAnswers): string {
  if (path.startsWith("interview.followups.")) {
    const item = answers.interview.followups[Number(path.slice("interview.followups.".length))];
    if (!item) return "Interview clarification";
    return isInterviewClarificationCurrent(item, answers) ? item.question : `Earlier clarification (reconfirm before use): ${item.question}`;
  }
  if (path.startsWith("write_ins.")) return `Other answer to: ${WRITE_IN_QUESTIONS[path.slice("write_ins.".length) as keyof typeof WRITE_IN_QUESTIONS]}`;
  if (path.startsWith("clarifications.")) {
    const code = path.slice("clarifications.".length) as keyof typeof CLARIFICATION_BANK;
    return CLARIFICATION_BANK[code].question;
  }
  if (path.startsWith("focus.comparison.")) {
    const candidate = answers.focus.comparison?.[answers.focus.comparison.selected];
    const work = candidate && answers.focus.area ? getWorkLabel(answers.focus.area, candidate.work) : "Selected work";
    const field = path.split(".").at(-1);
    const label = field === "work" ? "Selected work" : field === "fee_effort" ? "Fee compared with effort"
      : field === "team_fit" ? "Fit with the team" : field === "capacity" ? "Capacity now" : "Basis for this view";
    return `${work}: ${label}`;
  }
  const route = answers.focus.route;
  const labels: Partial<Record<AnswerReferencePath, string>> = {
    "practice.direction": "What direction should the firm take?",
    "practice.firm_type": "Firm or practice type",
    "practice.capability": "What capabilities support this work?",
    "practice.enjoys": "What work does the team enjoy?",
    "practice.experience": "How much experience does the firm have with this type of work?",
    "practice.development_needs": "What would help the firm build or support this work?",
    "practice.client_strength": "Which relevant strength can the firm bring to this matter?",
    "practice.client_strength_effect": "How would that strength help this client?",
    "practice.client_strength_support": "What experience or evidence supports that strength?",
    "client_context.geography": "Where is this work offered?",
    "client_context.relevant_circumstances": "What client or matter circumstances distinguish a good-fit enquiry?",
    "client_context.community_focus": "Which community or audience does the firm serve?",
    "client_context.language_service_needs": "What language or service needs should the firm plan for?",
    "client_context.repeat_matter_pattern": "Which specific matter and legal work would the firm welcome again?",
    "client_context.discovery_behaviour": "How do clients find or approach the firm for this work?",
    "focus.area": "What legal work do you want more of?",
    "focus.work": "Which type of work should we focus on?",
    "focus.work_other": "Describe the work in a few words",
    "focus.service_area": "Where can your firm offer this work?",
    "focus.certainty": "Which work should this profile explore?",
    "focus.route": "Where does this work sit today?",
    "situation.timing": "When does this client usually seek help?",
    "situation.trigger": "What usually happens that makes this client seek help?",
    "situation.role": "Who usually needs the help?",
    "situation.role_other": "Describe the role in a few words",
    "situation.contact": "Who makes the first contact?",
    "client.goals": "What does the client most want to achieve?",
    "client.goal_detail": "What would progress look like in this situation?",
    "client.decision_context": "Who is involved in deciding or paying for the legal help?",
    "client.pathway_basis": "How does the firm know this decision pathway?",
    "client.choice_priorities": "What matters to the client when choosing a firm?",
    "client.choice_detail": "What else may matter to the client?",
    "client.choice_basis": "What is the basis for the firm's view of client choice?",
    "client.concerns": route === "established" ? "What concern have you heard from these clients?" : "What might concern these clients?",
    "client.decision_needs": "What would help this client feel ready to take the next step?",
    "value.reasons": "What makes this work worth pursuing?",
    "value.fee_effort": route === "established" ? "How does the fee compare with the work involved?" : "How do you expect the fee to compare with the work involved?",
    "value.collected_fee": route === "established" ? "Typical collected fee, excluding disbursements" : "Fee range you are considering, excluding disbursements",
    "value.team_hours": "Typical total team time",
    "value.payment": "How predictable is payment?",
    "value.payment_context": "Payment context supplied",
    "value.payment_context_basis": "Source of payment context",
    "value.currency": "Currency for the supplied amounts",
    "value.fee_amount": "Fee amount or range",
    "value.direct_cost_amount": "Direct delivery cost amount or range",
    "value.amount_basis": "Whether supplied amounts are recorded or estimated",
    "value.amount_scope": "Scope of supplied amount",
    "delivery.conditions": "What helps your team deliver this work well?",
    "delivery.fit_signals": "Which early signs would make this inquiry worth a closer look?",
    "delivery.capacity": "Could the firm take on more of this work now?",
    "delivery.limit": "What makes this work hard?",
    "direction.aim": "What should this work help the firm become known for?",
    "direction.evidence": "What supports this direction?",
    "direction.less": "Work to promote less",
    "direction.less_reason": "Why should this work receive less marketing attention?",
    "direction.less_note": "Name the work in a few words",
    "opportunity.sources": "What past source or evidence supports this direction?",
    "opportunity.source_detail": "Describe the opportunity source",
    "opportunity.period": "Period covered by the opportunity evidence",
    "opportunity.enquiry_count": "Comparable enquiry count",
    "opportunity.retained_count": "Comparable retained matter count",
    "opportunity.conversion": "Observed conversion information",
    "opportunity.acquisition_cost": "Known acquisition cost",
    "opportunity.data_basis": "Whether opportunity figures are recorded or estimated",
    "opportunity.uncertainty": "What remains uncertain about demand or access?",
    "repeatability.success_measure": "What outcome should measure progress?",
    "repeatability.success_other": "Describe another firm-approved outcome",
    "repeatability.target": "Desired target",
    "repeatability.review_period": "Period for reviewing progress",
    "repeatability.additional_matters": "Additional matters the firm could support",
    "repeatability.staffing_constraint": "Staffing or process constraint",
  };
  return labels[path] ?? "Answer";
}

/** Resolves a source reference to the authored question and its current human-readable answer. */
export function getSourceDetails(path: AnswerReferencePath, answers: DesiredClientAnswers): { question: string; answer: string | null } {
  const resolved = resolveAnswerReference(path, answers);
  return { question: questionLabel(path, answers), answer: resolved.present ? getAnswerLabel(path, answers) : null };
}
