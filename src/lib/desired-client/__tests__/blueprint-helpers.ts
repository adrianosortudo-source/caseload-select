import { emptyAnswers } from "../brief";
import { buildDefinitionSentence } from "../definition";
import type { AnalysisResult, DesiredClientAnswers, DesiredClientBrief, EvidenceBasis, EvidenceLinkedStatement } from "../types";
export function completeAnswers(): DesiredClientAnswers {
  const a = emptyAnswers(); a.revision = 3;
  a.focus = { ...a.focus, area: "business", work: "business_acquisitions", service_area: "Ontario", route: "established", certainty: "chosen" };
  a.practice = { ...a.practice, direction: "grow_proven", firm_type: "Ontario business law firms", capability: "Business acquisition advice", enjoys: "Transaction planning" };
  a.situation = { ...a.situation, trigger: "business.transaction", timing: "planning", role: "business_owner" };
  a.client.goals = ["understand"]; a.client.concerns = ["next"]; a.client.decision_needs = ["options"];
  a.value.reasons = ["client_benefit", "skills"]; a.value.fee_effort = "worthwhile";
  a.delivery.capacity = "room"; a.delivery.fit_signals = ["scope"];
  a.direction.aim = "more_current"; a.direction.evidence = ["repeated"];
  a.opportunity.sources = ["unknown"]; a.repeatability.success_measure = "retained_matters";
  return a;
}
const kindFor: Record<EvidenceBasis, EvidenceLinkedStatement["kind"]> = { firm_reported_recorded: "experience", firm_reported_estimate: "hypothesis", firm_preference: "preference", source_observed: "experience", hypothesis: "hypothesis", unknown: "unknown" };
export const evidence = (text: string, basis: EvidenceBasis, ...source_answer_ids: EvidenceLinkedStatement["source_answer_ids"]): EvidenceLinkedStatement => ({ text, kind: kindFor[basis], evidence_basis: basis, source_answer_ids });
export function validBlueprint(): AnalysisResult {
  const brief: DesiredClientBrief = {
    report_version: "dcm-blueprint-v2", definition_sentence: "",
    definition_components: {
      firm: evidence("Ontario business law firms", "firm_preference", "practice.firm_type"),
      client_matter: evidence("business owners considering an established business purchase before signing terms", "hypothesis", "focus.work", "situation.role", "situation.trigger"),
      reasons: evidence("transaction expertise and work the team enjoys", "firm_preference", "practice.capability", "practice.enjoys"),
      outcome: evidence("comparable matters retained", "firm_preference", "repeatability.success_measure"),
    },
    practice_context: { claims: [evidence("The firm's direction is to grow proven acquisition work.", "firm_preference", "practice.direction")] },
    desired_client_matter: { claims: [evidence("Business owners seek advice before committing to an established business purchase.", "hypothesis", "focus.work", "situation.role", "situation.trigger")] },
    value_rationale: { claims: [evidence("The team values transaction expertise and enjoys this work.", "firm_preference", "practice.capability", "practice.enjoys")] },
    relevance_signals: { claims: [evidence("An identified transaction and scope information are useful signals for lawyer review.", "hypothesis", "situation.trigger", "delivery.fit_signals")] },
    opportunity_evidence: { claims: [evidence("Demand and acquisition cost have not been established.", "unknown", "opportunity.sources")] },
    repeatability: { claims: [evidence("The firm proposes tracking comparable matters retained.", "firm_preference", "repeatability.success_measure")] },
    open_questions: [],
  };
  brief.definition_sentence = buildDefinitionSentence(brief, false);
  return { clarification_code: null, brief };
}
