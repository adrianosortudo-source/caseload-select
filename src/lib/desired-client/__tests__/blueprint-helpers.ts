import { validateAnalysisResult } from "../output";
import { emptyAnswers } from "../brief";
import { buildDefinitionSentence } from "../definition";
import { getAnswerLabel } from "../catalog";
import { buildStructuredBlueprintV4 } from "../structured-blueprint";
import { buildDesiredClientEvidenceGroups, evidenceGroupIdsForStatement, type DesiredClientEvidenceSlot } from "../evidence-contract";
import { providerTargetClaimIds } from "../provider-schema";
import type { AnalysisResult, DesiredClientAnswers, DesiredClientBriefV4, EvidenceBasis, EvidenceLinkedStatement } from "../types";
export type ProviderSchemaProbe = {
 properties: Record<string, ProviderSchemaProbe>;
 items: ProviderSchemaProbe;
 enum: string[];
 maxItems: number;
 minItems: number;
 description: string;
 required: string[];
};
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
 const grounded = buildStructuredBlueprintV4(answers);
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
  recognizable_circumstances:{claims:[evidence(getAnswerLabel("delivery.fit_signals", answers) ?? "The relevant circumstance remains to be confirmed.","hypothesis","delivery.fit_signals")]},
 evidence_and_open_questions:{claims:[evidence("Neither demand nor acquisition cost is established.","unknown","opportunity.sources")]},
 decision_pathway: grounded.decision_pathway
 };
 brief.definition_components.client = grounded.definition_components.client;
 brief.definition_components.client_matter = grounded.definition_components.client_matter;
 brief.definition_components.reasons = grounded.definition_components.reasons;
 brief.definition_components.outcome = grounded.definition_components.outcome;
 brief.client_and_matter.claims[0] = grounded.client_and_matter.claims[0];
 brief.definition_sentence=buildDefinitionSentence(brief,false,answers.client.goal_detail,answers.client.goals.includes("unknown"));
 return {brief,clarification_code:null};
}

/** Encode a persisted fixture into the provider-only group-ID transport. */
export function providerBlueprint(result: AnalysisResult, answers: DesiredClientAnswers): unknown {
 const slot = providerStatement;
 const source = result.brief;
 return { brief: {
  ...source,
  definition_components: {
   client: slot("definition_client_type", source.definition_components.client, answers),
   client_matter: slot("definition_client_matter", source.definition_components.client_matter, answers),
   reasons: slot("definition_reasons", source.definition_components.reasons, answers),
   outcome: slot("definition_outcome", source.definition_components.outcome, answers),
  },
  client_and_matter: { claim_ids: providerTargetClaimIds(answers) },
  client_goals_needs: providerCard("client_goals_needs", source.client_goals_needs, answers),
  why_firm_wants_work: providerCard("why_firm_wants_work", source.why_firm_wants_work, answers),
  why_client_chooses_firm: providerCard("why_client_chooses_firm", source.why_client_chooses_firm, answers),
  recognizable_circumstances: providerCard("recognizable_circumstances", source.recognizable_circumstances, answers),
  evidence_and_open_questions: providerCard("evidence_and_open_questions", source.evidence_and_open_questions, answers),
  decision_pathway: {
   trigger: slot("decision_pathway.trigger", source.decision_pathway.trigger, answers),
   first_contact: slot("decision_pathway.first_contact", source.decision_pathway.first_contact, answers),
   decision: slot("decision_pathway.decision", source.decision_pathway.decision, answers),
   desired_progress: slot("decision_pathway.desired_progress", source.decision_pathway.desired_progress, answers),
  },
 } };
}

export function providerStatement(slot: DesiredClientEvidenceSlot, statement: EvidenceLinkedStatement, answers: DesiredClientAnswers) {
 return { text: statement.text, evidence_group_ids: evidenceGroupIdsForStatement(slot, statement, answers) };
}
export function providerCard(slot: DesiredClientEvidenceSlot, card: { claims: EvidenceLinkedStatement[] }, answers: DesiredClientAnswers) {
 return { claims: card.claims.map(claim => providerStatement(slot, claim, answers)) };
}

/** Complete synthetic acquisition fixture from the exact-86 reproduction packet. */
export function negativeEconomicsAnswers(): DesiredClientAnswers {
 const answers = completeAnswers();
 Object.assign(answers.value, {
  fee_amount: "8000", direct_cost_amount: "8500", currency: "CAD", amount_basis: "recorded", amount_scope: "per_matter",
  collected_fee: "15to50", team_hours: "16to40", payment: "predictable",
  payment_context: "Clients told the firm that the first invoice was usually paid on schedule.", payment_context_basis: "client_feedback",
 });
 Object.assign(answers.repeatability, {
  success_measure: "retained_matters", target: "2 additional retained matters per quarter", review_period: "6 months",
  additional_matters: "2 comparable matters per quarter", staffing_constraint: "An associate must be hired before increasing volume.",
 });
 return answers;
}

export function mixedPaymentProviderBlueprint(answers: DesiredClientAnswers, paraphrase = true) {
 const result = validateAnalysisResult(validBlueprint(answers), answers, [])!;
 const encoded = providerBlueprint(result, answers) as { brief: {
  why_firm_wants_work: { claims: Array<{ text: string; evidence_group_ids: string[] }> };
  recognizable_circumstances: { claims: Array<{ text: string; evidence_group_ids: string[] }> };
 } };
 const claims = encoded.brief.why_firm_wants_work.claims;
 const payment = result.brief.why_firm_wants_work.claims.find(claim => claim.source_answer_ids.includes("value.payment"))!;
 const context = result.brief.why_firm_wants_work.claims.find(claim => claim.source_answer_ids.includes("value.payment_context"))!;
 const paymentIds = evidenceGroupIdsForStatement("why_firm_wants_work", payment, answers);
 const contextIds = evidenceGroupIdsForStatement("why_firm_wants_work", context, answers);
 const fitSignalGroup = buildDesiredClientEvidenceGroupsForTest(answers).find(group => group.source_answer_ids.includes("delivery.fit_signals"));
 const developmentNeedsGroup = buildDesiredClientEvidenceGroupsForTest(answers).find(group => group.source_answer_ids.includes("practice.development_needs"));
 if (paraphrase) claims.find(claim => claim.evidence_group_ids.includes(contextIds[0]))!.text = "Clients reported that their first invoice was usually paid on schedule.";
 claims.push({
  text: "The firm reports that payment is usually predictable. Clients told the firm that the first invoice was usually paid on schedule.",
  evidence_group_ids: [...paymentIds, ...contextIds, ...(fitSignalGroup ? [fitSignalGroup.id] : []), ...(developmentNeedsGroup ? [developmentNeedsGroup.id] : [])],
 });
 return encoded;
}

function buildDesiredClientEvidenceGroupsForTest(answers: DesiredClientAnswers) {
 return buildDesiredClientEvidenceGroups("why_firm_wants_work", answers);
}
