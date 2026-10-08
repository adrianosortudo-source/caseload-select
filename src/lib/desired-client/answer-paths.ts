import type { AnswerReferencePath } from "./types";

/** Complete, ordered source registry for review and all answer exports. */
export const DESIRED_CLIENT_ANSWER_PATHS: AnswerReferencePath[] = [
  "focus.area", "focus.work", "focus.work_other", "focus.service_area", "focus.certainty", "focus.route",
  "practice.direction", "practice.firm_type", "practice.capability", "practice.enjoys", "practice.experience", "practice.development_needs",
  "practice.client_strength", "practice.client_strength_effect", "practice.client_strength_support",
  "client_context.geography", "client_context.relevant_circumstances", "client_context.community_focus", "client_context.language_service_needs", "client_context.repeat_matter_pattern", "client_context.discovery_behaviour",
  "situation.trigger", "situation.timing", "situation.role", "situation.role_other", "situation.contact",
  "client.goals", "client.goal_detail", "client.concerns", "client.decision_needs", "client.decision_context", "client.pathway_basis", "client.choice_priorities", "client.choice_detail", "client.choice_basis",
  "value.reasons", "value.fee_effort", "value.collected_fee", "value.team_hours", "value.payment", "value.payment_context", "value.payment_context_basis", "value.currency", "value.fee_amount", "value.direct_cost_amount", "value.amount_basis", "value.amount_scope",
  "delivery.conditions", "delivery.capacity", "delivery.limit", "delivery.fit_signals",
  "direction.aim", "direction.evidence", "direction.less", "direction.less_reason", "direction.less_note",
  "opportunity.sources", "opportunity.data_basis", "opportunity.source_detail", "opportunity.period", "opportunity.enquiry_count", "opportunity.retained_count", "opportunity.conversion", "opportunity.acquisition_cost", "opportunity.uncertainty",
  "repeatability.success_measure", "repeatability.success_other", "repeatability.target", "repeatability.review_period", "repeatability.additional_matters", "repeatability.staffing_constraint",
  "write_ins.aim", "write_ins.capacity", "write_ins.concerns", "write_ins.conditions", "write_ins.contact", "write_ins.decision_needs", "write_ins.evidence", "write_ins.fee_effort", "write_ins.fit_signals", "write_ins.goals", "write_ins.limit", "write_ins.reasons", "write_ins.timing", "write_ins.trigger",
  "clarifications.CLIENT_MATTER_UNCLEAR", "clarifications.VALUE_EFFORT_CONFLICT", "clarifications.CAPACITY_CONFLICT", "clarifications.REPEATABILITY_UNPROVEN", "clarifications.OPPORTUNITY_UNSUPPORTED",
  "focus.comparison.a.work", "focus.comparison.a.fee_effort", "focus.comparison.a.team_fit", "focus.comparison.a.capacity", "focus.comparison.a.evidence",
  "focus.comparison.b.work", "focus.comparison.b.fee_effort", "focus.comparison.b.team_fit", "focus.comparison.b.capacity", "focus.comparison.b.evidence",
  "interview.followups.0", "interview.followups.1", "interview.followups.2",
];
