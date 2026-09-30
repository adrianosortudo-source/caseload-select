import { AREA_CATALOG, getWorkLabel } from "./catalog";
import { buildDefinitionSentence } from "./definition";
import { calculateContribution, type CalculatedContribution } from "./economics";
import { getSourceDetails } from "./sources";
import type { AnswerReferencePath, DesiredClientAnswers, DesiredClientBrief, EvidenceBasis, EvidenceCard, EvidenceLinkedStatement, SavedBrief } from "./types";

export type BlueprintMetadata = {
  mode: SavedBrief["mode"];
  generatedAt: string;
  wordingReviewed: boolean;
  openClarificationCode?: SavedBrief["openClarificationCode"];
};

export const EVIDENCE_BASIS_LABELS: Record<EvidenceBasis, string> = {
  firm_reported_recorded: "Firm-reported records",
  firm_reported_estimate: "Firm estimate",
  firm_preference: "Firm preference",
  source_observed: "Observed source",
  hypothesis: "To test",
  unknown: "Still open",
};

export type BlueprintCard = {
  id: "practice" | "clientMatter" | "value" | "fit" | "opportunity" | "repeatability";
  title: string;
  claims: EvidenceLinkedStatement[];
  sources: Array<{ statement: EvidenceLinkedStatement; path: AnswerReferencePath; question: string; answer: string | null }>;
  contribution?: CalculatedContribution;
  opportunityBasis?: string;
};

export type BlueprintViewModel = {
  title: string;
  status: string;
  evidenceStatus: string;
  modeLabel: string;
  date: string;
  confirmed: boolean;
  definition: string;
  definitionComponents: DesiredClientBrief["definition_components"];
  cards: BlueprintCard[];
  openQuestions: EvidenceLinkedStatement[];
  sourceDetails: Array<{ slot: string; statement: EvidenceLinkedStatement; answers: Array<{ path: AnswerReferencePath; question: string; answer: string | null }> }>;
  allAnswers: Array<{ question: string; answer: string }>;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not recorded" : date.toLocaleDateString("en-CA");
};

const CARD_DEFINITIONS = [
  ["practice", "Practice we are building", "practice_context"],
  ["clientMatter", "Desired client and matter", "desired_client_matter"],
  ["value", "Why this work matters to the firm", "value_rationale"],
  ["fit", "What makes an inquiry relevant", "relevance_signals"],
  ["opportunity", "Evidence of opportunity", "opportunity_evidence"],
  ["repeatability", "What repeatable progress means", "repeatability"],
] as const;

const ANSWER_PATHS: AnswerReferencePath[] = [
  "focus.area", "focus.work", "focus.work_other", "focus.service_area", "focus.certainty", "focus.route",
  "practice.direction", "practice.firm_type", "practice.capability", "practice.enjoys",
  "client_context.geography", "client_context.relevant_circumstances", "client_context.community_focus", "client_context.language_service_needs", "client_context.repeat_matter_pattern",
  "situation.trigger", "write_ins.trigger", "situation.timing", "situation.role", "situation.role_other", "situation.contact",
  "client.goals", "write_ins.goals", "client.concerns", "write_ins.concerns", "client.decision_needs", "write_ins.decision_needs",
  "value.reasons", "write_ins.reasons", "value.fee_effort", "write_ins.fee_effort", "value.collected_fee", "value.team_hours", "value.payment", "value.currency", "value.fee_amount", "value.direct_cost_amount", "value.amount_basis", "value.amount_scope",
  "delivery.conditions", "write_ins.conditions", "delivery.capacity", "write_ins.capacity", "delivery.limit", "write_ins.limit", "delivery.fit_signals", "write_ins.fit_signals",
  "direction.aim", "write_ins.aim", "direction.evidence", "write_ins.evidence", "direction.less", "direction.less_note",
  "opportunity.sources", "opportunity.source_detail", "opportunity.period", "opportunity.enquiry_count", "opportunity.retained_count", "opportunity.conversion", "opportunity.acquisition_cost", "opportunity.uncertainty",
  "repeatability.success_measure", "repeatability.success_other", "repeatability.target", "repeatability.review_period", "repeatability.additional_matters", "repeatability.staffing_constraint",
];

function evidenceStatus(brief: DesiredClientBrief): string {
  const statements = [brief.practice_context, brief.desired_client_matter, brief.value_rationale, brief.relevance_signals, brief.opportunity_evidence, brief.repeatability]
    .flatMap((card) => card.claims);
  const bases = new Set(statements.map((statement) => statement.evidence_basis));
  if (bases.has("unknown") || bases.has("hypothesis")) return "Some parts of this direction still need evidence";
  if (bases.has("firm_reported_estimate")) return "Some commercial details are estimates";
  if (bases.has("firm_preference")) return "Includes the firm’s stated preferences";
  return "Evidence is described by its source";
}

export function buildBlueprintViewModel(brief: DesiredClientBrief, answers: DesiredClientAnswers, meta: BlueprintMetadata): BlueprintViewModel {
  const cards: BlueprintCard[] = CARD_DEFINITIONS.map(([id, title, key]) => {
    const claims = (brief[key] as EvidenceCard).claims;
    const contribution = id === "value" ? calculateContribution(answers) : null;
    const opportunityHasResults = id === "opportunity" && Boolean(answers.opportunity.sources.length || answers.opportunity.source_detail.trim() || answers.opportunity.enquiry_count.trim() || answers.opportunity.retained_count.trim() || answers.opportunity.conversion.trim() || answers.opportunity.acquisition_cost.trim());
    const opportunityBasis = opportunityHasResults && answers.opportunity.data_basis
      ? answers.opportunity.data_basis === "recorded" ? "Firm-reported records" : answers.opportunity.data_basis === "estimated" ? "Firm estimate" : "Basis unknown"
      : undefined;
    return {
      id,
      title,
      claims,
      sources: claims.flatMap((statement) => statement.source_answer_ids.map((path) => ({ ...getSourceDetails(path, answers), path, statement }))),
      ...(contribution ? { contribution } : {}),
      ...(opportunityBasis ? { opportunityBasis } : {}),
    };
  });
  const detailStatements = [
    ...cards.flatMap((card) => card.claims.map((statement, index) => [`${card.title} · Claim ${index + 1}`, statement] as const)),
    ...Object.entries(brief.definition_components).map(([key, statement]) => [`Definition: ${key.replaceAll("_", " ")}`, statement] as const),
    ...brief.open_questions.map((statement, index) => [`Point to resolve ${index + 1}`, statement] as const),
  ];
  const sourceDetails = detailStatements.map(([slot, statement]) => ({
    slot,
    statement,
    answers: statement.source_answer_ids.map((path) => ({ ...getSourceDetails(path, answers), path })),
  }));
  const allAnswers = ANSWER_PATHS.flatMap((path) => {
    const source = getSourceDetails(path, answers);
    return source.answer === null || !source.answer.trim() ? [] : [{ question: source.question, answer: source.answer }];
  }).filter((item, index, list) => list.findIndex((candidate) => candidate.question === item.question && candidate.answer === item.answer) === index);
  const area = answers.focus.area ? AREA_CATALOG[answers.focus.area].label : "Practice area to define";
  const work = answers.focus.work === "other"
    ? answers.focus.work_other.trim()
    : answers.focus.area && answers.focus.work ? getWorkLabel(answers.focus.area, answers.focus.work) : "Matter to define";
  const title = work && work !== "Matter to define" ? `${area}: ${work}` : `${area} desired client profile`;
  const confirmed = meta.wordingReviewed;
  return {
    title,
    status: confirmed ? "Direction confirmed by the firm" : "Provisional direction",
    evidenceStatus: evidenceStatus(brief),
    modeLabel: meta.mode === "ai" ? "AI-assisted draft" : "Structured draft",
    date: formatDate(meta.generatedAt),
    confirmed,
    definition: buildDefinitionSentence(brief, confirmed),
    definitionComponents: brief.definition_components,
    cards,
    openQuestions: brief.open_questions,
    sourceDetails,
    allAnswers,
  };
}
