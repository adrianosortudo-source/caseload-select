import { resolveAnswerReference, WRITE_IN_KEYS } from "./catalog";
import { buildDefinitionSentence } from "./definition";
import { calculateContribution } from "./economics";
import { isInterviewClarificationCurrent, type AnalysisResult, type AnswerReferencePath, type ClarificationCode, type DesiredClientAnswers, type DesiredClientBrief, type DesiredClientBriefV4, type EvidenceBasis, type EvidenceLinkedStatement } from "./types";

const SOURCE_PATHS = new Set<string>([
  "focus.area", "focus.work", "focus.work_other", "focus.service_area", "focus.certainty", "focus.route",
  "practice.direction", "practice.firm_type", "practice.capability", "practice.enjoys",
  "practice.experience", "practice.development_needs",
  "client_context.geography", "client_context.relevant_circumstances", "client_context.community_focus", "client_context.language_service_needs", "client_context.repeat_matter_pattern",
  "situation.trigger", "situation.timing", "situation.role", "situation.role_other", "situation.contact",
  "client.goals", "client.concerns", "client.decision_needs",
  "value.reasons", "value.fee_effort", "value.collected_fee", "value.team_hours", "value.payment", "value.currency", "value.fee_amount", "value.direct_cost_amount", "value.amount_basis", "value.amount_scope",
  "delivery.conditions", "delivery.capacity", "delivery.limit", "delivery.fit_signals",
  "direction.aim", "direction.evidence", "direction.less", "direction.less_reason", "direction.less_note",
  "opportunity.sources", "opportunity.data_basis", "opportunity.source_detail", "opportunity.period", "opportunity.enquiry_count", "opportunity.retained_count", "opportunity.conversion", "opportunity.acquisition_cost", "opportunity.uncertainty",
  "repeatability.success_measure", "repeatability.success_other", "repeatability.target", "repeatability.review_period", "repeatability.additional_matters", "repeatability.staffing_constraint",
  ...WRITE_IN_KEYS.map((key) => `write_ins.${key}`),
  "interview.followups.0", "interview.followups.1", "interview.followups.2",
  "client.goal_detail", "client.decision_context", "client.pathway_basis", "client.choice_priorities", "client.choice_detail", "client.choice_basis", "practice.client_strength", "practice.client_strength_effect", "practice.client_strength_support", "client_context.discovery_behaviour",
  "clarifications.CLIENT_MATTER_UNCLEAR", "clarifications.VALUE_EFFORT_CONFLICT", "clarifications.CAPACITY_CONFLICT", "clarifications.REPEATABILITY_UNPROVEN", "clarifications.OPPORTUNITY_UNSUPPORTED",
  ...(["a", "b"] as const).flatMap((side) => ["work", "fee_effort", "team_fit", "capacity", "evidence"].map((field) => `focus.comparison.${side}.${field}`)),
]);
const BASIS: readonly EvidenceBasis[] = ["firm_reported_recorded", "firm_reported_estimate", "firm_reported_experience", "firm_reported_observation", "client_reported", "firm_preference", "source_observed", "hypothesis", "unknown"];
const KIND = ["experience", "preference", "hypothesis", "unknown", "suggestion"] as const;
const BUDGETS = {
  definition_client_type: [25, 300], definition_client_matter: [75, 600], definition_reasons: [35, 300], definition_outcome: [25, 240],
  practice_context: [60, 420], desired_client_matter: [100, 700], value_rationale: [90, 650], relevance_signals: [70, 500], opportunity_evidence: [70, 500], repeatability: [65, 450], open: [25, 180],
  practice_current_practice: [30, 180], practice_work_to_grow: [30, 180], practice_experience_supporting: [35, 210], practice_development_needs: [30, 180], practice_marketing_emphasis: [35, 210],
  client_and_matter:[95,650], client_goals_needs:[95,650], why_firm_wants_work:[100,700], why_client_chooses_firm:[95,650],
  decision_pathway:[50,330], recognizable_circumstances:[100,700], evidence_and_open_questions:[110,760],
} as const;
const BANNED = /\u2014|<\/?[a-z][^>]*>|https?:\/\/|\bwww\.|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\[[^\]]+\]\([^)]+\)/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const wordCount = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;
const numericTokens = (text: string) => [...text.matchAll(/(?:[$€£]\s*)?\d+(?:[\s,]\d{3})*(?:\.\d+)?\s*%?/gu)].map((match) => match[0].replace(/[^\d.%]/g, ""));

function allowedPaths(slot: string): readonly string[] {
  if (slot === "practice_current_practice") return ["practice.firm_type"];
  if (slot === "practice_work_to_grow") return ["focus.area", "focus.work", "focus.work_other", "practice.direction"];
  if (slot === "practice_experience_supporting") return ["practice.experience", "practice.capability"];
  if (slot === "practice_development_needs") return ["practice.experience", "practice.development_needs"];
  if (slot === "practice_marketing_emphasis") return ["direction.less", "direction.less_note", "direction.less_reason"];
  if (slot === "definition_client_type") return ["situation.role", "situation.role_other", "client_context.geography", "client_context.relevant_circumstances", "client_context.community_focus"];
  if (slot === "definition_client_matter") return ["focus.area", "focus.work", "focus.work_other", "situation.trigger", "situation.role", "situation.role_other", "situation.timing", "client_context.geography", "client_context.relevant_circumstances", "client_context.repeat_matter_pattern", "write_ins.trigger"];
  if (slot === "practice_context") return ["practice.", "focus.", "direction."];
  if (slot === "client_and_matter") return ["focus.","situation.","client_context.geography","client_context.relevant_circumstances","client_context.repeat_matter_pattern","write_ins.trigger"];
  if (slot === "client_goals_needs") return ["client.","situation.","client_context.","write_ins.goals","write_ins.concerns","write_ins.decision_needs"];
  if (slot === "why_firm_wants_work") return ["practice.","value.","delivery.","direction.","repeatability.staffing_constraint","repeatability.additional_matters","write_ins.reasons","write_ins.fee_effort","write_ins.conditions","write_ins.capacity","write_ins.limit"];
  if (slot === "why_client_chooses_firm") return ["client.choice_","practice.client_strength","practice.capability","practice.experience"];
  if (slot === "decision_pathway") return ["situation.","client.","write_ins.trigger","write_ins.timing","write_ins.contact","write_ins.goals","write_ins.decision_needs"];
  if (slot === "recognizable_circumstances") return ["client_context.","delivery.fit_signals","delivery.conditions","delivery.limit","situation.trigger","write_ins.fit_signals","write_ins.conditions","write_ins.limit"];
  if (slot === "evidence_and_open_questions") return [...SOURCE_PATHS].map((path)=>path.slice(0,path.lastIndexOf(".")+1));
  if (slot === "desired_client_matter") return ["focus.", "situation.", "client.", "client_context.", "write_ins.trigger"];
  if (slot.startsWith("definition_reasons") || slot === "value_rationale") return ["value.", "delivery.", "practice.", "write_ins.reasons"];
  if (slot.startsWith("definition_outcome") || slot === "repeatability") return ["repeatability.", "direction.", "value.", "delivery.capacity"];
  if (slot === "relevance_signals") return ["delivery.", "client_context.", "situation.trigger", "write_ins.conditions", "write_ins.fit_signals", "write_ins.limit"];
  if (slot === "opportunity_evidence") return ["opportunity."];
  if (slot === "open") return [...SOURCE_PATHS].map((path) => path.slice(0, path.lastIndexOf(".") + 1));
  return [];
}

function validStatement(value: unknown, answers: DesiredClientAnswers, slot: string): value is EvidenceLinkedStatement {
  const budget = BUDGETS[slot as keyof typeof BUDGETS] ?? BUDGETS.open;
  if (!exact(value, ["text", "kind", "source_answer_ids", "evidence_basis"]) || typeof value.text !== "string" || typeof value.kind !== "string" || !KIND.includes(value.kind as typeof KIND[number]) || !Array.isArray(value.source_answer_ids) || typeof value.evidence_basis !== "string" || !BASIS.includes(value.evidence_basis as EvidenceBasis)) return false;
  const text = value.text.trim().replace(/\s+/g, " ");
  if (!text || text.length > budget[1] || wordCount(text) > budget[0] || BANNED.test(text)) return false;
  const paths = value.source_answer_ids as unknown[];
  const prefixes = allowedPaths(slot);
  const followupStages: Record<string, number[]> = { client_and_matter:[1,2], client_goals_needs:[2], why_firm_wants_work:[3], why_client_chooses_firm:[4], recognizable_circumstances:[5,6], evidence_and_open_questions:[1,2,3,4,5,6], decision_pathway:[2,5,6], definition_client_type:[2], definition_client_matter:[2], definition_reasons:[3], definition_outcome:[6] };
  const permitted = (path:string) => {
    if (!path.startsWith("interview.followups.")) return prefixes.some(prefix => path.startsWith(prefix));
    const item = answers.interview.followups[Number(path.split(".")[2])];
    return !!item && !item.skipped && isInterviewClarificationCurrent(item,answers) && (followupStages[slot] ?? []).includes(item.stage);
  };
  if (paths.length < 1 || paths.length > 8 || paths.some((path) => typeof path !== "string" || !SOURCE_PATHS.has(path) || !permitted(path)) || new Set(paths).size !== paths.length) return false;
  let hasUnknown = false;
  const supportedValues: string[] = [];
  for (const path of paths as AnswerReferencePath[]) {
    const resolved = resolveAnswerReference(path, answers);
    if (!resolved.present || (resolved.value === null && value.evidence_basis !== "unknown")) return false;
    if (resolved.unknown || resolved.value === null || resolved.value === "" || (path === "opportunity.sources" && answers.opportunity.sources.includes("no_evidence")) || (Array.isArray(resolved.value) && resolved.value.length === 0)) hasUnknown = true;
    else if (Array.isArray(resolved.value) && resolved.value.every((item) => typeof item === "string")) supportedValues.push(...resolved.value);
    else if (typeof resolved.value === "string") supportedValues.push(resolved.value);
    else return false;
  }
  if (hasUnknown !== (value.evidence_basis === "unknown")) return false;
  if (value.evidence_basis === "unknown" && value.kind !== "unknown") return false;
  if (value.evidence_basis === "firm_reported_recorded") {
    const valueFigure = paths.some((path) => typeof path === "string" && path.startsWith("value."));
    const opportunityFigure = paths.some((path) => typeof path === "string" && path.startsWith("opportunity."));
    if (!(valueFigure && answers.value.amount_basis === "recorded") && !(opportunityFigure && answers.opportunity.data_basis === "recorded")) return false;
  }
  if (value.evidence_basis === "firm_reported_estimate") {
    const valueFigure = paths.some((path) => typeof path === "string" && path.startsWith("value."));
    const opportunityFigure = paths.some((path) => typeof path === "string" && path.startsWith("opportunity."));
    if (!(valueFigure && answers.value.amount_basis === "estimated") && !(opportunityFigure && answers.opportunity.data_basis === "estimated")) return false;
  }
  if (value.evidence_basis === "firm_reported_experience" && (
    value.kind !== "experience" ||
    (slot === "practice_current_practice"
      ? paths.length !== 1 || paths[0] !== "practice.firm_type"
      : !paths.some((path) => path === "practice.experience" || path === "practice.capability" || path === "practice.client_strength_support"))
  )) return false;
  if (value.evidence_basis === "client_reported" || value.evidence_basis === "firm_reported_observation") {
    const expected = value.evidence_basis === "client_reported" ? "client_feedback" : "firm_observation";
    const choice = paths.some(path => typeof path === "string" && path.startsWith("client.choice_"));
    const pathway = paths.some(path => typeof path === "string" && (path.startsWith("situation.") || ["client.goals","client.goal_detail","client.concerns","client.decision_needs","client.decision_context","client.pathway_basis"].includes(path)));
    if ((!choice && !pathway) || (choice && (!paths.includes("client.choice_basis") || answers.client.choice_basis !== expected)) || (pathway && (!paths.includes("client.pathway_basis") || answers.client.pathway_basis !== expected))) return false;
  }
  if (value.evidence_basis === "source_observed" && !(paths.includes("opportunity.sources") && answers.opportunity.sources.some((source) => source !== "unknown" && source !== "no_evidence"))) return false;
  if (["firm_reported_recorded", "firm_reported_estimate"].includes(value.evidence_basis as string) && value.kind !== "experience" && value.kind !== "hypothesis") return false;
  if (value.evidence_basis === "firm_preference" && value.kind !== "preference") return false;
  if (["firm_reported_observation","client_reported"].includes(value.evidence_basis) && value.kind !== "experience") return false;
  if (["source_observed", "hypothesis"].includes(value.evidence_basis as string) && value.kind !== "experience" && value.kind !== "hypothesis" && value.kind !== "suggestion") return false;
  if (slot === "open" && value.kind !== "unknown" && value.kind !== "suggestion") return false;
  if (slot !== "open" && value.kind === "suggestion") return false;
  // Parse each answer independently so whitespace between two cited answers
  // cannot be mistaken for a thousands separator across the answer boundary.
  const supportedNumberTokens = supportedValues.flatMap((supportedValue) => numericTokens(supportedValue));
  const unsupportedTokens = numericTokens(text).filter((token) => !supportedNumberTokens.includes(token));
  if (unsupportedTokens.length) {
    // Permit only the application's independently recomputed contribution,
    // only in the firm-value card, with the complete economics source set.
    // All other numbers still need to occur literally in cited answers.
    const contribution = slot === "why_firm_wants_work" ? calculateContribution(answers) : null;
    const economicsSources = ["value.fee_amount", "value.direct_cost_amount", "value.currency", "value.amount_basis", "value.amount_scope"];
    const hasAllSources = economicsSources.every((path) => paths.includes(path));
    const calculatedTokens = contribution ? numericTokens(contribution.amount) : [];
    if (!contribution || !hasAllSources || !/\bcontribution\b/i.test(text) || unsupportedTokens.some((token) => !calculatedTokens.includes(token))) return false;
  }
  return true;
}

function checkDefinitionPart(value: unknown, answers: DesiredClientAnswers, slot: string): value is EvidenceLinkedStatement {
  return validStatement(value, answers, slot);
}

function validCard(value: unknown, answers: DesiredClientAnswers, slot: string): value is { claims: EvidenceLinkedStatement[] } {
  const valid = exact(value, ["claims"]) && Array.isArray(value.claims) && value.claims.length >= 1 && value.claims.length <= 6 &&
    value.claims.every((claim) => validStatement(claim, answers, slot));
  return valid;
}

export function validateAnalysisResult(value: unknown, answers: DesiredClientAnswers, _eligibleCodes: readonly ClarificationCode[]): AnalysisResult | null {
  if (!exact(value, ["brief", "clarification_code"]) || value.clarification_code !== null) return null;
  const brief=value.brief;
  // A valid citation is not permission to invent a matter subtype. Guard the
  // hostile-takeover substitution found in the audit unless the firm actually
  // supplied that phrase in its answers.
  const suppliedText = JSON.stringify(answers).toLocaleLowerCase("en-CA");
  if (JSON.stringify(brief).toLocaleLowerCase("en-CA").includes("hostile takeover") && !suppliedText.includes("hostile takeover")) return null;
  const cardNames=["client_and_matter","client_goals_needs","why_firm_wants_work","why_client_chooses_firm","recognizable_circumstances","evidence_and_open_questions"] as const;
  if(!exact(brief,["report_version","definition_sentence","definition_components",...cardNames,"decision_pathway"])||brief.report_version!=="dcm-blueprint-v4"||typeof brief.definition_sentence!=="string")return null;
  if(!exact(brief.definition_components,["client","client_matter","reasons","outcome"]))return null;
  const components=brief.definition_components;
  if(!checkDefinitionPart(components.client,answers,"definition_client_type")||!checkDefinitionPart(components.client_matter,answers,"definition_client_matter")||!checkDefinitionPart(components.reasons,answers,"definition_reasons")||!checkDefinitionPart(components.outcome,answers,"definition_outcome"))return null;
  for(const field of cardNames)if(!validCard(brief[field],answers,field))return null;
  const pathway=brief.decision_pathway;
  if(!exact(pathway,["trigger","first_contact","decision","desired_progress"]))return null;
  const pathwayFields=["trigger","first_contact","decision","desired_progress"] as const;
  for(const field of pathwayFields)if(!validStatement(pathway[field],answers,"decision_pathway"))return null;
  const typedBrief=brief as unknown as DesiredClientBriefV4;
  const expectedSentence=buildDefinitionSentence(typedBrief,false);
  // The definition is assembled from bounded, source-linked fields. A hard
  // 85-word ceiling rejected valid, specific client-and-matter definitions;
  // keep a generous abuse limit while preserving supported detail.
  if(typedBrief.definition_sentence.trim()!==expectedSentence||expectedSentence.length>1600)return null;
  const reportWords=[...cardNames.flatMap(field=>typedBrief[field].claims.map(claim=>claim.text)),...pathwayFields.map(field=>typedBrief.decision_pathway[field].text)].reduce((sum,text)=>sum+wordCount(text),wordCount(expectedSentence));
  if(reportWords>800)return null;
  return value as unknown as AnalysisResult;
}

const LINKED_STATEMENT_SCHEMA = { type: "object", properties: { text: { type: "string" }, kind: { type: "string", enum: KIND }, source_answer_ids: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } }, evidence_basis: { type: "string", enum: BASIS } }, required: ["text", "kind", "source_answer_ids", "evidence_basis"] } as const;
const EVIDENCE_CARD_SCHEMA = { type: "object", properties: { claims: { type: "array", minItems: 1, maxItems: 6, items: LINKED_STATEMENT_SCHEMA } }, required: ["claims"] } as const;
export const BLUEPRINT_RESPONSE_SCHEMA = {
  type: "object", properties: {
    clarification_code: { type: "string", nullable: true, enum: ["CLIENT_MATTER_UNCLEAR", "VALUE_EFFORT_CONFLICT", "CAPACITY_CONFLICT", "REPEATABILITY_UNPROVEN", "OPPORTUNITY_UNSUPPORTED"] },
    brief: { type: "object", properties: {
      report_version: { type: "string", enum: ["dcm-blueprint-v4"] }, definition_sentence: { type: "string" },
      definition_components: { type: "object", properties: { client: LINKED_STATEMENT_SCHEMA, client_matter: LINKED_STATEMENT_SCHEMA, reasons: LINKED_STATEMENT_SCHEMA, outcome: LINKED_STATEMENT_SCHEMA }, required: ["client", "client_matter", "reasons", "outcome"] },
      client_and_matter:EVIDENCE_CARD_SCHEMA,client_goals_needs:EVIDENCE_CARD_SCHEMA,why_firm_wants_work:EVIDENCE_CARD_SCHEMA,why_client_chooses_firm:EVIDENCE_CARD_SCHEMA,recognizable_circumstances:EVIDENCE_CARD_SCHEMA,evidence_and_open_questions:EVIDENCE_CARD_SCHEMA,
      decision_pathway:{type:"object",properties:{trigger:LINKED_STATEMENT_SCHEMA,first_contact:LINKED_STATEMENT_SCHEMA,decision:LINKED_STATEMENT_SCHEMA,desired_progress:LINKED_STATEMENT_SCHEMA},required:["trigger","first_contact","decision","desired_progress"]},
    }, required: ["report_version", "definition_sentence", "definition_components",...(["client_and_matter","client_goals_needs","why_firm_wants_work","why_client_chooses_firm","recognizable_circumstances","evidence_and_open_questions","decision_pathway"])] },
  }, required: ["clarification_code", "brief"],
} as const;
