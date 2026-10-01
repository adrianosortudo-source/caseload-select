import { getAnswerLabel, getWorkLabel, REASON_LABELS, resolveAnswerReference, TIMING_PHRASES } from "./catalog";
import { buildDefinitionSentence } from "./definition";
import { calculateContribution } from "./economics";
import { isInterviewClarificationCurrent, type AnswerReferencePath, type DesiredClientAnswers, type DesiredClientBrief, type DesiredClientBriefV4, type EvidenceBasis, type EvidenceLinkedStatement } from "./types";

const clean = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
const present = (answers: DesiredClientAnswers, path: AnswerReferencePath) => resolveAnswerReference(path, answers);
const knownPaths = (answers: DesiredClientAnswers, paths: AnswerReferencePath[]) => paths.filter((path) => {
  const result = present(answers, path);
  return result.present && result.value !== null && !result.unknown;
});
const text = (answers: DesiredClientAnswers, path: AnswerReferencePath) => clean(getAnswerLabel(path, answers));
const unique = (paths: AnswerReferencePath[]) => [...new Set(paths)].slice(0, 8);

function kindFor(basis: EvidenceBasis): EvidenceLinkedStatement["kind"] {
  if (basis === "firm_reported_recorded" || basis === "source_observed") return "experience";
  if (basis === "firm_reported_experience" || basis === "client_reported" || basis === "firm_reported_observation") return "experience";
  if (basis === "firm_reported_estimate" || basis === "hypothesis") return "hypothesis";
  if (basis === "firm_preference") return "preference";
  return "unknown";
}
function linked(textValue: string, basis: EvidenceBasis, paths: AnswerReferencePath[]): EvidenceLinkedStatement {
  return { text: textValue, kind: kindFor(basis), evidence_basis: basis, source_answer_ids: unique(paths) };
}
function answerClaim(answers: DesiredClientAnswers, paths: AnswerReferencePath[], makeText: (labels: string[]) => string, basis: EvidenceBasis = "firm_preference"): EvidenceLinkedStatement | null {
  const sources = knownPaths(answers, paths);
  if (!sources.length) return null;
  const labels = sources.map((path) => text(answers, path)).filter(Boolean);
  if (!labels.length) return null;
  return linked(makeText(labels), basis, sources);
}
function areaWork(answers: DesiredClientAnswers): string {
  if (answers.focus.work === "other") return clean(answers.focus.work_other) || "a type of legal work to be specified";
  if (answers.focus.area && answers.focus.work) return getWorkLabel(answers.focus.area, answers.focus.work);
  return "a type of legal work to be specified";
}
function role(answers: DesiredClientAnswers): string {
  if (answers.situation.role === "other") return clean(answers.situation.role_other) || "a client role to be specified";
  if (answers.situation.role && answers.situation.role !== "unknown" && answers.focus.area) return text(answers, "situation.role") || "a client role to be specified";
  return "a client role to be specified";
}
function matterDefinition(answers: DesiredClientAnswers): string {
  const roleText = role(answers), work = areaWork(answers);
  const trigger = text(answers, "situation.trigger") || clean(answers.write_ins?.trigger) || "a situation to be clarified";
  const timing = text(answers, "situation.timing");
  const location = clean(answers.client_context.geography);
  const specificMatter = clean(answers.client_context.repeat_matter_pattern);
  return `${roleText} seeking ${work}${trigger ? ` when ${trigger.toLowerCase()}` : ""}${timing ? `, at the ${timing.toLowerCase()} stage` : ""}${location ? ` in ${location}` : ""}${specificMatter ? `; specifically, ${specificMatter}` : ""}`;
}
function reasonText(answers: DesiredClientAnswers): string {
  const selected = answers.value.reasons.filter((id) => id !== "undecided").map((id) => REASON_LABELS[id].toLowerCase());
  if (selected.length) return selected.join(" and ");
  return "the firm's preferred expertise and delivery fit, with the economics still to be confirmed";
}
function opportunityLabel(id: string): string {
  const labels: Record<string, string> = {
    comparable_enquiries: "comparable enquiries", retained_matters: "comparable matters retained", professional_referrals: "professional referrals",
    repeat_clients: "repeat clients", website_search: "website or search enquiries", other_source: "another source", no_evidence: "no evidence yet", unknown: "not sure",
  };
  return labels[id] ?? id.replaceAll("_", " ");
}
function basisForValue(answers: DesiredClientAnswers): EvidenceBasis {
  if (answers.value.amount_basis === "recorded") return "firm_reported_recorded";
  if (answers.value.amount_basis === "estimated") return "firm_reported_estimate";
  if (answers.value.reasons.length > 0 && !answers.value.reasons.includes("undecided")) return "firm_preference";
  return "unknown";
}
function fitTexts(answers: DesiredClientAnswers): string[] {
  const candidates: Array<[AnswerReferencePath, string]> = [
    ["delivery.fit_signals", text(answers, "delivery.fit_signals")],
    ["delivery.conditions", text(answers, "delivery.conditions")],
    ["delivery.limit", text(answers, "delivery.limit")],
    ["client_context.language_service_needs", clean(answers.client_context.language_service_needs)],
  ];
  return candidates.filter(([path, value]) => value && knownPaths(answers, [path]).length).map(([, value]) => value);
}

/** Deterministic, source-linked report used when AI is unavailable. */
export function buildStructuredBlueprint(answers: DesiredClientAnswers): DesiredClientBrief {
  const firmLabel = clean(answers.practice.firm_type) || (answers.focus.area ? `law firms focused on ${areaWork(answers).toLowerCase()}` : "law firms defining a preferred type of work");
  const firmPaths = knownPaths(answers, ["practice.firm_type", "focus.area", "focus.work", "focus.work_other", "practice.direction"]);
  const matterPaths = knownPaths(answers, ["focus.work", "focus.work_other", "situation.role", "situation.role_other", "situation.trigger", "write_ins.trigger", "situation.timing", "client_context.geography", "client_context.repeat_matter_pattern"]);
  const calculatedContribution = calculateContribution(answers);
  const reasonPaths = calculatedContribution
    ? knownPaths(answers, ["value.fee_amount", "value.direct_cost_amount", "value.currency", "value.amount_basis", "value.amount_scope"])
    : knownPaths(answers, ["value.reasons", "practice.enjoys", "practice.capability", "delivery.conditions"]);
  const outcomePaths = knownPaths(answers, ["repeatability.success_measure", "repeatability.success_other", "repeatability.target", "repeatability.review_period"]);
  const success = answers.repeatability.success_measure && answers.repeatability.success_measure !== "unknown"
    ? text(answers, "repeatability.success_measure")
    : clean(answers.repeatability.success_other);
  const target = clean(answers.repeatability.target);
  const outcomeText = success ? `${success}${target ? `, with a proposed target of ${target}` : ""}` : "a measure still to be agreed";

  const direction = text(answers, "practice.direction") || text(answers, "direction.aim");
  const capability = clean(answers.practice.capability);
  const enjoyed = clean(answers.practice.enjoys);
  const work = areaWork(answers);
  const clientMatter = matterDefinition(answers);
  const reasons = calculatedContribution
    ? `${calculatedContribution.amount} contribution before overhead and acquisition costs per matter`
    : reasonText(answers);
  const economicBasis = calculatedContribution?.basis ?? basisForValue(answers);
  const practiceUnknown = (textValue: string, path: AnswerReferencePath) => linked(textValue, "unknown", [path]);
  const currentPractice = answers.practice.firm_type.trim()
    ? linked(answers.practice.firm_type.trim(), "firm_reported_experience", ["practice.firm_type"])
    : practiceUnknown("The firm's current practice has not been described.", "practice.firm_type");
  const workPaths = knownPaths(answers, ["focus.work", "focus.work_other", "focus.area"]);
  const workToGrow = workPaths.length
    ? linked(work, "firm_preference", workPaths)
    : practiceUnknown("The specific work to grow is not yet defined.", "focus.work");
  const experienceLabels: Record<string, string> = { regular: "Regular experience", occasional: "Occasional experience", adjacent: "Adjacent experience", new: "A new area for the firm", unknown: "Experience level not known" };
  const establishedExperience = answers.practice.experience === "regular" || answers.practice.experience === "occasional" || answers.practice.experience === "adjacent";
  const experiencePaths = knownPaths(answers, ["practice.experience", ...(establishedExperience ? ["practice.capability" as const] : [])]);
  const experienceSupport = experiencePaths.length && establishedExperience
    ? linked(`${experienceLabels[answers.practice.experience ?? "unknown"]}${capability ? `: ${capability}` : ""}.`, "firm_reported_experience", experiencePaths)
    : answers.practice.experience === "new"
      ? linked("The firm identifies this as a new area; prior experience supporting it was not reported.", "firm_reported_experience", ["practice.experience"])
      : practiceUnknown(answers.practice.experience === "unknown" ? "The firm marked its experience level as unknown." : "The firm's experience supporting this direction is not yet recorded.", "practice.experience");
  const devLabels: Record<string, string> = { expertise: "expertise", support: "specialist or team support", process: "delivery process", capacity: "capacity", unknown: "development needs not yet defined" };
  const devPaths = knownPaths(answers, ["practice.development_needs"]);
  const developmentNeeds = devPaths.length
    ? linked(`Development to plan for: ${answers.practice.development_needs.map((id) => devLabels[id]).join(", ")}.`, "firm_preference", devPaths)
    : practiceUnknown("No development need has been specified yet.", "practice.development_needs");
  const lessLabels: Record<string, string> = { within: "work within the firm's current practice", outside: "work outside the firm's preferred direction", model: "work that does not fit its delivery model", none: "no specific work to reduce" };
  const lessPaths = knownPaths(answers, ["direction.less", "direction.less_reason", "direction.less_note"]);
  const lessWork = lessPaths.length
    ? linked(`Marketing emphasis to reduce: ${answers.direction.less === "none" ? lessLabels.none : lessLabels[answers.direction.less ?? ""] ?? "work identified by the firm"}${answers.direction.less_reason ? `; reason: ${answers.direction.less_reason}` : ""}${answers.direction.less_note.trim() ? `; detail: ${answers.direction.less_note.trim()}` : ""}.`, "firm_preference", lessPaths)
    : practiceUnknown("The firm has not identified work to reduce marketing emphasis on.", "direction.less");

  const matterClaims: EvidenceLinkedStatement[] = [];
  if (matterPaths.length) matterClaims.push(linked(`Desired client and matter: ${clientMatter}.`, answers.focus.route === "established" ? "hypothesis" : "hypothesis", matterPaths));
  else matterClaims.push(linked("The client role, situation and specific matter still need definition.", "unknown", ["focus.work"]));
  const goals = answerClaim(answers, ["client.goals", "write_ins.goals"], (values) => `Desired client progress: ${values.join("; ")}.`, answers.focus.route === "established" ? "hypothesis" : "hypothesis");
  if (goals) matterClaims.push(goals);
  const clientNeeds = answerClaim(answers, ["client_context.relevant_circumstances", "client_context.community_focus", "client_context.language_service_needs"], (values) => `Relevant circumstances or service needs: ${values.join("; ")}.`, "hypothesis");
  if (clientNeeds) matterClaims.push(clientNeeds);

  const valueClaims: EvidenceLinkedStatement[] = [];
  if (reasonPaths.length) valueClaims.push(linked(`Why the firm wants more of this work: ${reasons}.`, economicBasis, reasonPaths));
  else valueClaims.push(linked("The firm's reasons for choosing this work still need to be established.", "unknown", ["value.reasons"]));
  if (answers.value.fee_amount.trim() || answers.value.direct_cost_amount.trim()) {
    const amountParts = [answers.value.fee_amount.trim() ? `fee ${answers.value.fee_amount.trim()}` : "", answers.value.direct_cost_amount.trim() ? `direct delivery cost ${answers.value.direct_cost_amount.trim()}` : ""].filter(Boolean);
    const metadata = [answers.value.currency, answers.value.amount_scope, answers.value.amount_basis].filter(Boolean).join("; ");
    valueClaims.push(linked(`${amountParts.join("; ")}${metadata ? ` (${metadata})` : ""}.`, economicBasis === "unknown" ? "unknown" : economicBasis, ["value.fee_amount", "value.direct_cost_amount", "value.currency", "value.amount_basis", "value.amount_scope"].filter((path) => present(answers, path as AnswerReferencePath).present) as AnswerReferencePath[]));
  }
  if (answers.value.fee_effort === "unknown" || !answers.value.fee_effort) valueClaims.push(linked("The fee compared with delivery effort remains unconfirmed.", "unknown", ["value.fee_effort"]));
  if (answers.value.amount_basis === "estimated") valueClaims.push(linked("Any supplied commercial figures are estimates, not established results.", "firm_reported_estimate", ["value.amount_basis"]));

  const signalValues = fitTexts(answers);
  const relevanceClaims: EvidenceLinkedStatement[] = signalValues.length
    ? [linked(`Relevant observable signals or service conditions to establish: ${signalValues.join("; ")}.`, "hypothesis", knownPaths(answers, ["delivery.fit_signals", "delivery.conditions", "delivery.limit", "client_context.language_service_needs"]))]
    : [linked("Specific observable relevance signals and service conditions are still to be identified.", "unknown", ["delivery.fit_signals"])];
  if (answers.delivery.limit && answers.delivery.limit !== "none") {
    const limit = answerClaim(answers, ["delivery.limit", "write_ins.limit"], (values) => `Potential delivery limit to manage: ${values.join("; ")}.`, "hypothesis");
    if (limit) relevanceClaims.push(limit);
  }

  const oppLabels = answers.opportunity.sources.map(opportunityLabel).filter((label) => label !== "not sure");
  const opportunityClaims: EvidenceLinkedStatement[] = [];
  if (oppLabels.length) opportunityClaims.push(linked(`Evidence reported so far: ${oppLabels.join("; ")}.`, answers.opportunity.sources.includes("no_evidence") ? "source_observed" : "hypothesis", ["opportunity.sources"]));
  const oppBasis: EvidenceBasis = answers.opportunity.data_basis === "recorded" ? "firm_reported_recorded" : answers.opportunity.data_basis === "estimated" ? "firm_reported_estimate" : "hypothesis";
  const opportunityPaths: AnswerReferencePath[] = ["opportunity.source_detail", "opportunity.period", "opportunity.enquiry_count", "opportunity.retained_count", "opportunity.conversion", "opportunity.acquisition_cost", "opportunity.data_basis"];
  const opportunityDetailPaths = knownPaths(answers, opportunityPaths.filter((path) => path !== "opportunity.data_basis"));
  if (opportunityDetailPaths.length) {
    const sources = [...opportunityDetailPaths, ...(answers.opportunity.data_basis === "unknown" ? ["opportunity.data_basis" as const] : [])];
    const detail = opportunityDetailPaths.map((path) => text(answers, path)).filter(Boolean);
    opportunityClaims.push(linked(`Source detail and results supplied${answers.opportunity.data_basis === "unknown" ? ", with the basis still to be confirmed" : answers.opportunity.data_basis ? ` as ${answers.opportunity.data_basis}` : " with basis not yet stated"}: ${detail.join("; ")}.`, answers.opportunity.data_basis === "unknown" ? "unknown" : oppBasis, sources));
  }
  if (!oppLabels.length || answers.opportunity.sources.includes("unknown")) opportunityClaims.push(linked("Demand, access and acquisition cost have not been established by this profile.", "unknown", ["opportunity.sources"]));
  if (answers.opportunity.uncertainty.trim()) {
    const uncertainty = answerClaim(answers, ["opportunity.uncertainty"], (values) => `The firm's main opportunity uncertainty is: ${values[0]}.`, "hypothesis");
    if (uncertainty) opportunityClaims.push(uncertainty);
  }

  const repeatClaims: EvidenceLinkedStatement[] = [];
  const capacity = answerClaim(answers, ["delivery.capacity", "write_ins.capacity"], (values) => `Current capacity: ${values.join("; ")}.`, "firm_preference");
  if (capacity) repeatClaims.push(capacity);
  else repeatClaims.push(linked("Capacity for additional matters is still unknown.", "unknown", ["delivery.capacity"]));
  if (success) repeatClaims.push(linked(`Proposed progress measure: ${outcomeText}. The target is a future threshold, not a result already achieved.`, "firm_preference", outcomePaths.length ? outcomePaths : ["repeatability.success_measure"]));
  else repeatClaims.push(linked("The firm has not yet selected a measure of progress.", "unknown", ["repeatability.success_measure"]));
  if (answers.repeatability.staffing_constraint.trim() || answers.repeatability.additional_matters.trim()) {
    const constraint = answerClaim(answers, ["repeatability.additional_matters", "repeatability.staffing_constraint"], (values) => `Additional volume or staffing constraint: ${values.join("; ")}.`, "firm_preference");
    if (constraint) repeatClaims.push(constraint);
  }

  const firmComponentBasis: EvidenceBasis = firmPaths.length ? "firm_preference" : "unknown";
  const matterComponentBasis: EvidenceBasis = matterPaths.length ? "hypothesis" : "unknown";
  const reasonComponentBasis = reasonPaths.length ? (calculatedContribution ? economicBasis : "firm_preference") : "unknown";
  const outcomeComponentBasis: EvidenceBasis = success ? "firm_preference" : "unknown";
  const brief: DesiredClientBrief = {
    report_version: "dcm-blueprint-v3",
    definition_sentence: "",
    definition_components: {
      firm: linked(firmLabel, firmComponentBasis, firmPaths.length ? firmPaths : ["practice.direction"]),
      client_matter: linked(clientMatter, matterComponentBasis, matterPaths.length ? matterPaths : ["focus.work"]),
      reasons: linked(reasons, reasonComponentBasis, reasonPaths.length ? reasonPaths : ["value.reasons"]),
      outcome: linked(outcomeText, outcomeComponentBasis, outcomePaths.length ? outcomePaths : ["repeatability.success_measure"]),
    },
    practice_context: { current_practice: currentPractice, work_to_grow: workToGrow, experience_supporting_direction: experienceSupport, development_needs: developmentNeeds, marketing_emphasis_to_reduce: lessWork },
    desired_client_matter: { claims: matterClaims.slice(0, 6) },
    value_rationale: { claims: valueClaims.slice(0, 6) },
    relevance_signals: { claims: relevanceClaims.slice(0, 6) },
    opportunity_evidence: { claims: (opportunityClaims.length ? opportunityClaims : [linked("No evidence of opportunity has been supplied yet.", "unknown", ["opportunity.sources"])]).slice(0, 6) },
    repeatability: { claims: repeatClaims.slice(0, 6) },
    open_questions: [],
  };
  brief.definition_sentence = buildDefinitionSentence(brief, false);
  return brief;
}

function insightBasis(value:DesiredClientAnswers["client"]["pathway_basis"]|DesiredClientAnswers["client"]["choice_basis"]):EvidenceBasis {
  return value==="client_feedback"?"client_reported":value==="firm_observation"?"firm_reported_observation":value==="firm_hypothesis"?"hypothesis":"unknown";
}
function unknownClaim(label:string,path:AnswerReferencePath):EvidenceLinkedStatement{return linked(label,"unknown",[path]);}
function interviewClaims(answers:DesiredClientAnswers, stages:number[], prefix:string):EvidenceLinkedStatement[] {
  return answers.interview.followups.flatMap((item,index)=>{
    if(item.skipped||!stages.includes(item.stage)||!isInterviewClarificationCurrent(item,answers))return [];
    // Answers in the first three stages state the firm's chosen direction or
    // reasons. Later answers about client choice, observable behaviour and
    // opportunity are retained as hypotheses unless separately evidenced.
    const basis:EvidenceBasis=item.stage<=3?"firm_preference":"hypothesis";
    return [linked(`${prefix}${item.answer}`,basis,[`interview.followups.${index}` as AnswerReferencePath])];
  });
}

/** Deterministic v4 profile. It turns the answers into six useful sections without inventing client behaviour. */
export function buildStructuredBlueprintV4(answers:DesiredClientAnswers):DesiredClientBriefV4 {
  const matter= matterDefinition(answers);
  const matterPaths=knownPaths(answers,["focus.work","focus.work_other","situation.trigger","write_ins.trigger","situation.timing","client_context.repeat_matter_pattern"]);
  const clientMatter = matterPaths.length ? linked(matter,"hypothesis",matterPaths) : unknownClaim("The specific client role, situation and matter are still to be defined.","focus.work");
  const progressPaths=knownPaths(answers,["client.goals","client.goal_detail"]);
  const progress=progressPaths.length ? linked(`The client is seeking ${[text(answers,"client.goals"),clean(answers.client.goal_detail)].filter(Boolean).join(": ")}.`,"hypothesis",progressPaths) : unknownClaim("The client's desired progress has not been established.","client.goals");
  const needPaths=knownPaths(answers,["client.concerns","client.decision_needs","client.decision_context","client_context.language_service_needs","client_context.community_focus"]);
  const goalsClaims=[progress,...(needPaths.length?[linked(`Needs, concerns or decision participants noted by the firm: ${needPaths.map(path=>text(answers,path)).filter(Boolean).join("; ")}.`,"hypothesis",needPaths)]:[]),...interviewClaims(answers,[2],"Additional context supplied: ")].slice(0,6);

  const reasonPaths=knownPaths(answers,["value.reasons","write_ins.reasons","practice.enjoys","value.fee_effort","write_ins.fee_effort"]).filter((path)=>path!=="value.reasons"||!answers.value.reasons.includes("undecided"));
  const reasonLabels=reasonPaths.map(path=>text(answers,path)).filter(Boolean);
  const firmRationale=reasonPaths.length?linked(`The firm wants this work for the following reported reasons and conditions: ${reasonLabels.join("; ")||text(answers,"value.reasons")}.`,"firm_preference",reasonPaths):unknownClaim("The firm's reasons for wanting more of this work are not yet established.","value.reasons");
  const economicsPaths=knownPaths(answers,["value.fee_amount","value.direct_cost_amount","value.currency","value.amount_basis","value.amount_scope"]);
  const contribution=calculateContribution(answers);
  const economicsText=economicsPaths.map(path=>`${path.split(".")[1].replaceAll("_"," ")}: ${text(answers,path)}`).join("; ")+(contribution?`; ${contribution.basis==="firm_reported_estimate"?"estimated":"firm-record-based"} contribution before overhead and acquisition costs: ${contribution.amount} per matter, calculated as collected fee less direct delivery cost`:"");
  const experiencePaths=knownPaths(answers,["practice.experience","practice.capability","practice.development_needs"]);
  const deliveryPaths=knownPaths(answers,["delivery.capacity","write_ins.capacity","repeatability.staffing_constraint","repeatability.additional_matters","direction.less_note","direction.less_reason"]);
  const rangePaths=knownPaths(answers,["value.collected_fee","value.team_hours","value.payment"]);
  const whyFirmClaims=[firmRationale,
    ...(experiencePaths.length?[linked(`Experience and development reported by the firm: ${experiencePaths.map(path=>text(answers,path)).join("; ")}.`,["regular","occasional","adjacent"].includes(answers.practice.experience??"")?"firm_reported_experience":"firm_preference",experiencePaths)]:[]),
    ...(economicsPaths.length?[linked(`Matter economics supplied: ${economicsText}. ${answers.value.amount_basis==="recorded"||answers.value.amount_basis==="estimated"?"":"The evidence basis remains unconfirmed. "}These details do not establish net profit.`,answers.value.amount_basis==="recorded"?"firm_reported_recorded":answers.value.amount_basis==="estimated"?"firm_reported_estimate":"hypothesis",economicsPaths)]:[]),
    ...(rangePaths.length?[linked(`Fee range, effort or payment pattern supplied: ${rangePaths.map(path=>`${path.split(".")[1].replaceAll("_"," ")}: ${text(answers,path)}`).join("; ")}.`,"hypothesis",rangePaths)]:[]),
    ...(deliveryPaths.length?[linked(`Capacity, constraints and marketing trade-offs supplied: ${deliveryPaths.map(path=>text(answers,path)).join("; ")}.`,"firm_preference",deliveryPaths)]:[]),
    ...interviewClaims(answers,[3],"Clarification: ")];

  const choiceBasis=insightBasis(answers.client.choice_basis);
  const choicePaths=knownPaths(answers,["client.choice_priorities","client.choice_detail","client.choice_basis"]);
  const clientChoice=choicePaths.length&&choiceBasis!=="unknown"?linked(`Client choice factors ${answers.client.choice_basis==="client_feedback"?"reported by clients":answers.client.choice_basis==="firm_observation"?"observed by the firm":"treated as a hypothesis"}: ${choicePaths.map(path=>text(answers,path)).filter(Boolean).join("; ")}.`,choiceBasis,choicePaths):unknownClaim("Why this client would choose this firm is not yet established.","client.choice_basis");
  const strengthPaths=knownPaths(answers,["practice.client_strength","practice.client_strength_effect"]);
  const strength=answers.practice.client_strength&&answers.practice.client_strength!=="unknown"&&strengthPaths.length
    ?linked(`The firm identifies ${getAnswerLabel("practice.client_strength",answers)} as relevant because ${clean(answers.practice.client_strength_effect)||"its effect on this matter still needs to be described"}.`,"firm_preference",strengthPaths)
    :unknownClaim("A relevant firm strength has not yet been identified.","practice.client_strength");
  const supportPaths=knownPaths(answers,["practice.client_strength_support","practice.capability","practice.experience"]);
  const strengthSupport=clean(answers.practice.client_strength_support)||clean(answers.practice.capability)?linked(`Support reported by the firm: ${supportPaths.map(path=>text(answers,path)).filter(Boolean).join("; ")}. This is not independent verification or a comparative claim.`,"firm_reported_experience",supportPaths):unknownClaim("Supporting experience or evidence for the stated strength was not supplied.","practice.client_strength_support");
  const whyClientClaims=[clientChoice,strength,strengthSupport,...interviewClaims(answers,[4],"Clarification: ")].slice(0,6);

  const pathwayBasis=insightBasis(answers.client.pathway_basis);
  const pathway=(label:string,paths:AnswerReferencePath[],missing:string):EvidenceLinkedStatement=>{
    const available=knownPaths(answers,paths);
    if(pathwayBasis==="unknown")return unknownClaim(`${missing} The basis for the supplied pathway information is still open.`,"client.pathway_basis");
    if(!available.length)return unknownClaim(missing,paths[0]??"client.pathway_basis");
    const fact=available.map(path=>text(answers,path)).filter(Boolean).join("; ");
    return linked(`${label}: ${fact}.`,pathwayBasis,unique([...available,"client.pathway_basis"]));
  };
  const decisionPathway={
    trigger:pathway("Situation prompting legal help",["situation.trigger","write_ins.trigger"],"What prompts the client to seek legal help is not established."),
    first_contact:pathway("Stage and first contact",["situation.timing","situation.contact","situation.role"],"When the client reaches the firm and who initiates contact are not established."),
    decision:pathway("Decision and involvement",["client.decision_context","client.decision_needs","situation.contact"],"Who participates in the decision and what they need before acting are not established."),
    desired_progress:pathway("Progress sought",["client.goals","client.goal_detail"],"The client's desired progress is not established."),
  };

  const signalPaths=knownPaths(answers,["client_context.relevant_circumstances","client_context.geography","client_context.community_focus","client_context.language_service_needs","delivery.fit_signals","delivery.conditions"]);
  const recognizability=signalPaths.length?linked(`Circumstances and early signs to recognize or confirm: ${signalPaths.map(path=>text(answers,path)).filter(Boolean).join("; ")}.`,"hypothesis",signalPaths):unknownClaim("Observable circumstances that distinguish this matter have not been supplied.","client_context.relevant_circumstances");
  const recognizabilityClaims=[recognizability,...(answers.client_context.discovery_behaviour.trim()?[linked(`Discovery behaviour supplied by the firm, to confirm: ${clean(answers.client_context.discovery_behaviour)}.`,"hypothesis",["client_context.discovery_behaviour"])]:[]),...interviewClaims(answers,[5],"Clarification: ")].slice(0,6);

  const opportunityPaths=knownPaths(answers,["opportunity.source_detail","opportunity.period","opportunity.enquiry_count","opportunity.retained_count","opportunity.conversion","opportunity.data_basis","opportunity.acquisition_cost"]);
  const sources=answers.opportunity.sources.filter(source=>source!=="unknown").map(opportunityLabel);
  const evidenceClaim=sources.length&&!answers.opportunity.sources.includes("no_evidence")
    ?linked(`Sources the firm reports seeing: ${sources.join("; ")}. This does not by itself establish demand or acquisition cost.`,"source_observed",["opportunity.sources"])
    :unknownClaim("Evidence of access to and repeat demand from these clients has not been established.","opportunity.sources");
  const detail=opportunityPaths.map(path=>text(answers,path)).filter(Boolean).join("; ");
  const evidenceClaims=[evidenceClaim,...(opportunityPaths.length?[linked(`Additional evidence or discovery behaviour supplied: ${detail}.`,answers.opportunity.data_basis==="recorded"?"firm_reported_recorded":answers.opportunity.data_basis==="estimated"?"firm_reported_estimate":"hypothesis",opportunityPaths)]:[]),...interviewClaims(answers,[6],"Clarification: ")].slice(0,6);
  const gaps:EvidenceLinkedStatement[]=[];
  if(answers.client.choice_basis==="unknown"||!answers.client.choice_basis)gaps.push(unknownClaim("Client choice criteria still need confirmation with client feedback or observed evidence.","client.choice_basis"));
  if(answers.client.pathway_basis==="unknown"||!answers.client.pathway_basis)gaps.push(unknownClaim("The sequence from first concern to decision has not been verified.","client.pathway_basis"));
  if(answers.practice.client_strength_support.trim()==="")gaps.push(unknownClaim("The firm should identify what experience, process or approved evidence supports its stated strength.","practice.client_strength_support"));
  if(!opportunityPaths.length)gaps.push(unknownClaim("Demand and discovery sources need evidence before the profile is used as a growth assumption.","opportunity.sources"));

  const outcomePaths=knownPaths(answers,["repeatability.success_measure","repeatability.success_other","repeatability.target","repeatability.review_period"]);
  const success=answers.repeatability.success_measure&&answers.repeatability.success_measure!=="unknown"
    ? answers.repeatability.success_measure === "other" ? clean(answers.repeatability.success_other) : getAnswerLabel("repeatability.success_measure",answers)
    : clean(answers.repeatability.success_other);
  const metricSummary = answers.repeatability.success_measure === "retained_matters" ? "retained matters"
    : answers.repeatability.success_measure === "contribution_effort" ? "contribution relative to effort"
    : answers.repeatability.success_measure === "predictable_delivery" ? "delivery predictability"
    : answers.repeatability.success_measure === "practice_mix_reputation" ? "the desired practice mix or reputation"
    : success ? success.charAt(0).toLocaleLowerCase("en-CA") + success.slice(1) : "";
  const outcomeText = success
    ? answers.repeatability.target
      ? `a proposed target of ${answers.repeatability.target} for ${metricSummary}`
      : `a measure of ${metricSummary}, with the target still to be set`
    : "";
  const outcome=success?linked(outcomeText,"firm_preference",outcomePaths.length?outcomePaths:["repeatability.success_measure"]):unknownClaim("A progress measure has not been selected; none is inferred.","repeatability.success_measure");
  const clientRolePaths=knownPaths(answers,["situation.role","situation.role_other"]);
  // Keep the identity field concise: descriptive circumstances belong in the
  // recognition card, where the full wording remains visible and actionable.
  const clientTypePaths=clientRolePaths.length?knownPaths(answers,[...clientRolePaths,"client_context.geography","client_context.community_focus"]):[];
  const clientRole=answers.situation.role&&answers.situation.role!=="unknown"?role(answers):"";
  const rolePhrase=clientRole?(answers.situation.role==="other"?clientRole:`${/^[aeiou]/i.test(clientRole)?"an":"a"} ${clientRole.toLocaleLowerCase("en-CA")}`):"";
  const clientDetails=[rolePhrase,clean(answers.client_context.geography)?`in ${clean(answers.client_context.geography)}`:"",clean(answers.client_context.community_focus)?`serving the ${clean(answers.client_context.community_focus)} community`:""].filter(Boolean);
  const clientType=clientTypePaths.length?linked(clientDetails.join(" "),"firm_preference",clientTypePaths):unknownClaim("The specific kind of client the firm wants to attract has not yet been defined.","situation.role");
  const triggerText=answers.situation.trigger&&answers.situation.trigger!=="unknown"?text(answers,"situation.trigger"):clean(answers.write_ins?.trigger);
  const lowerFirst=(value:string)=>value.charAt(0).toLocaleLowerCase("en-CA")+value.slice(1);
  const workText=lowerFirst(areaWork(answers));
  const triggerClause=triggerText?`when ${lowerFirst(triggerText)}`:"while the precise triggering situation remains to be specified";
  const timingAddsContext=answers.situation.timing&&answers.situation.timing!=="unknown"&&!(answers.situation.timing==="planning"&&/planned|prepar|before/i.test(triggerText));
  const timingPhrase=timingAddsContext?`, ${TIMING_PHRASES[answers.situation.timing!]}`:"";
  const specificMatter=clean(answers.client_context.repeat_matter_pattern);
  const matterDescription=`legal help with ${workText} ${triggerClause}${timingPhrase}${specificMatter?`; specifically, ${lowerFirst(specificMatter)}`:""}`;
  const sentenceMatterPaths:AnswerReferencePath[]=unique([...matterPaths,...(answers.situation.trigger==="unknown"&&!triggerText?["situation.trigger" as const]:[])]);
  const sentenceMatter=sentenceMatterPaths.length?linked(matterDescription,triggerText?"hypothesis":"unknown",sentenceMatterPaths):unknownClaim("The specific client situation and matter have not yet been defined.","focus.work");
  const reasonFragments: string[] = [];
  for (const id of answers.value.reasons) {
    if (id === "client_benefit") reasonFragments.push("client benefit");
    if (id === "fees") reasonFragments.push(answers.focus.route === "established" ? "fees that support the effort" : "expected fee support for the effort");
    if (id === "skills") reasonFragments.push("a fit with the firm's skills");
    if (id === "enjoyment") reasonFragments.push("the team's enjoyment of the work");
    if (id === "repeatable") reasonFragments.push(answers.focus.route === "established" ? "consistent delivery" : "expected consistent delivery");
    if (id === "further") reasonFragments.push("potential for further work or referrals");
    if (id === "direction") reasonFragments.push("fit with the practice the firm wants to build");
  }
  if (!answers.value.reasons.includes("fees") && answers.value.fee_effort === "worthwhile") reasonFragments.push(answers.focus.route === "established" ? "fees usually worthwhile for the effort" : "expected fees worthwhile for the effort");
  if (!answers.value.reasons.includes("fees") && answers.value.fee_effort === "scoped") reasonFragments.push("value when scope is clear");
  const writeInReason = clean(answers.write_ins?.reasons ?? "");
  if (writeInReason && answers.value.reasons.includes("undecided")) reasonFragments.push(writeInReason);
  const reasonSentence = reasonFragments.length > 1
    ? `${reasonFragments.slice(0, -1).join(", ")} and ${reasonFragments.at(-1)}`
    : reasonFragments[0] ?? (reasonLabels.length ? reasonLabels.map((label) => label.replace(/^(It|The firm|We)\s+/i, "").replace(/^./, (first) => first.toLocaleLowerCase("en-CA"))).join(" and ") : "the firm's reasons are still to be confirmed");
  const reasonsComponent=reasonPaths.length?linked(`the firm cites ${reasonSentence}`,"firm_preference",reasonPaths):unknownClaim("the firm is still establishing why it prefers this work","value.reasons");

  const brief:DesiredClientBriefV4 = {
    report_version:"dcm-blueprint-v4",definition_sentence:"",definition_components:{client:clientType,client_matter:sentenceMatter,reasons:reasonsComponent,outcome},
    client_and_matter:{claims:[clientMatter,...interviewClaims(answers,[2],"Clarification: ")].slice(0,6)},
    client_goals_needs:{claims:goalsClaims},why_firm_wants_work:{claims:whyFirmClaims},why_client_chooses_firm:{claims:whyClientClaims},
    decision_pathway:decisionPathway,recognizable_circumstances:{claims:recognizabilityClaims},evidence_and_open_questions:{claims:[...evidenceClaims,...gaps].slice(0,6)},
  };
  brief.definition_sentence=buildDefinitionSentence(brief,false);
  return brief;
}
