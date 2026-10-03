import { emptyAnswers } from "../brief";
import { buildDefinitionSentence } from "../definition";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import type { AnalysisResult, DesiredClientAnswers, DesiredClientBriefV4, EvidenceBasis, EvidenceLinkedStatement } from "../types";
export function completeAnswers(): DesiredClientAnswers {
  const a = emptyAnswers(); a.revision = 3;
  a.focus = { ...a.focus, area: "business", work: "business_acquisitions", service_area: "Ontario", route: "established", certainty: "chosen" };
  a.practice = { ...a.practice, direction: "grow_proven", experience:"regular", client_strength:"unknown", firm_type: "Ontario business law firms", capability: "Business acquisition advice", enjoys: "Transaction planning" };
  a.situation = { ...a.situation, trigger: "business.transaction", timing: "planning", role: "business_owner" };
  a.client_context.repeat_matter_pattern = "A business buyer who needs an asset purchase agreement drafted or reviewed before committing to final terms.";
  a.client.goal_detail = "Understand the assets, liabilities and closing obligations before deciding whether to proceed.";
  a.client.choice_priorities=["unknown"]; a.client.goals = ["understand"]; a.client.concerns = ["next"]; a.client.decision_needs = ["options"];
  a.value.reasons = ["client_benefit", "skills"]; a.value.fee_effort = "worthwhile";
  a.delivery.capacity = "room"; a.delivery.fit_signals = ["scope"];
  a.direction.aim = "more_current"; a.direction.evidence = ["repeated"];
  a.opportunity.sources = ["unknown"]; a.repeatability.success_measure = "retained_matters";
  return a;
}
const kindFor: Record<EvidenceBasis, EvidenceLinkedStatement["kind"]> = { firm_reported_recorded: "experience", firm_reported_estimate: "hypothesis", firm_reported_experience:"experience", firm_reported_observation:"experience", client_reported:"experience", firm_preference: "preference", source_observed: "experience", hypothesis: "hypothesis", unknown: "unknown" };
export const evidence = (text: string, basis: EvidenceBasis, ...source_answer_ids: EvidenceLinkedStatement["source_answer_ids"]): EvidenceLinkedStatement => ({ text, kind: kindFor[basis], evidence_basis: basis, source_answer_ids });
export function validBlueprint(answers: DesiredClientAnswers = completeAnswers()): AnalysisResult {
 const brief: DesiredClientBriefV4 = {
 report_version:"dcm-blueprint-v4", definition_sentence:"",
 definition_components:{
 client:evidence("business owners","hypothesis","situation.role"),
 client_matter:evidence("A buyer preparing to acquire an established business who needs agreement advice to clarify what the buyer receives and must do","hypothesis","client_context.repeat_matter_pattern"),
 reasons:evidence("the work fits the team's experience and preferences","firm_preference","value.reasons"),
 outcome:evidence("a proposed measure of comparable matters retained","firm_preference","repeatability.success_measure")},
 client_and_matter:{claims:[evidence("Business owners seek acquisition advice before committing to a transaction.","hypothesis","focus.work","situation.role","situation.trigger")]},
 client_goals_needs:{claims:[evidence("The client wants to understand their options.","hypothesis","client.goals")]},
 why_firm_wants_work:{claims:[evidence("The firm values this work's fit with its skills.","firm_preference","value.reasons")]},
 why_client_chooses_firm:{claims:[evidence("Client choice criteria are not yet established.","unknown","client.choice_priorities")]},
 recognizable_circumstances:{claims:[evidence("Scope information is useful for lawyer review.","hypothesis","delivery.fit_signals")]},
 evidence_and_open_questions:{claims:[evidence("Neither demand nor acquisition cost is established.","unknown","opportunity.sources")]},
 decision_pathway:{
 trigger:evidence("The prompting situation has not been observed.","unknown","client.decision_context"),
 first_contact:evidence("The first-contact pattern has not been observed.","unknown","client.decision_context"),
 decision:evidence("Who decides and in what order remains open.","unknown","client.decision_context"),
 desired_progress:evidence("The client's progress is a hypothesis to validate.","hypothesis","client.goals")}
 };
 const grounded = buildStructuredBlueprintV4(answers);
 brief.definition_components.client = grounded.definition_components.client;
 brief.definition_components.client_matter = grounded.definition_components.client_matter;
 brief.definition_components.reasons = grounded.definition_components.reasons;
 brief.client_and_matter.claims[0] = grounded.client_and_matter.claims[0];
 brief.definition_sentence=buildDefinitionSentence(brief,false,answers.client.goal_detail,answers.client.goals.includes("unknown"));
 return {brief,clarification_code:null};
}
