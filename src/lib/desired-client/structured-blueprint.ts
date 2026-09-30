import { getAnswerLabel, getWorkLabel, REASON_LABELS, resolveAnswerReference } from "./catalog";
import { buildDefinitionSentence } from "./definition";
import { calculateContribution } from "./economics";
import type { AnswerReferencePath, DesiredClientAnswers, DesiredClientBrief, EvidenceBasis, EvidenceLinkedStatement } from "./types";

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
  return `${roleText} seeking ${work}${trigger ? ` when ${trigger.toLowerCase()}` : ""}${timing ? `, at the ${timing.toLowerCase()} stage` : ""}${location ? ` in ${location}` : ""}`;
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
  const matterPaths = knownPaths(answers, ["focus.work", "focus.work_other", "situation.role", "situation.role_other", "situation.trigger", "write_ins.trigger", "situation.timing", "client_context.geography"]);
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
  const practiceClaims: EvidenceLinkedStatement[] = [];
  if (firmPaths.length) practiceClaims.push(linked(`Practice context: ${firmLabel}${direction ? `; current direction is ${direction.toLowerCase()}` : ""}.`, answers.practice.firm_type.trim() ? "firm_preference" : "hypothesis", firmPaths));
  else practiceClaims.push(linked("The firm type and practice direction are still to be specified.", "unknown", ["practice.direction"]));
  const practiceDetail = answerClaim(answers, ["practice.capability", "practice.enjoys"], (values) => `Relevant capabilities or work the team enjoys: ${values.join("; ")}.`);
  if (practiceDetail) practiceClaims.push(practiceDetail);
  if (!capability && !enjoyed) practiceClaims.push(linked("Relevant capabilities and the team's preferred work have not yet been described.", "unknown", ["practice.capability"]));

  const matterClaims: EvidenceLinkedStatement[] = [];
  if (matterPaths.length) matterClaims.push(linked(`Desired client and matter: ${clientMatter}.`, answers.focus.route === "established" ? "hypothesis" : "hypothesis", matterPaths));
  else matterClaims.push(linked("The client role, situation and specific matter still need definition.", "unknown", ["focus.work"]));
  const goals = answerClaim(answers, ["client.goals", "write_ins.goals"], (values) => `Desired client progress: ${values.join("; ")}.`, answers.focus.route === "established" ? "hypothesis" : "hypothesis");
  if (goals) matterClaims.push(goals);
  const clientNeeds = answerClaim(answers, ["client_context.relevant_circumstances", "client_context.community_focus", "client_context.language_service_needs", "client_context.repeat_matter_pattern"], (values) => `Relevant circumstances or service needs: ${values.join("; ")}.`, "hypothesis");
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
    report_version: "dcm-blueprint-v2",
    definition_sentence: "",
    definition_components: {
      firm: linked(firmLabel, firmComponentBasis, firmPaths.length ? firmPaths : ["practice.direction"]),
      client_matter: linked(clientMatter, matterComponentBasis, matterPaths.length ? matterPaths : ["focus.work"]),
      reasons: linked(reasons, reasonComponentBasis, reasonPaths.length ? reasonPaths : ["value.reasons"]),
      outcome: linked(outcomeText, outcomeComponentBasis, outcomePaths.length ? outcomePaths : ["repeatability.success_measure"]),
    },
    practice_context: { claims: practiceClaims.slice(0, 6) },
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
