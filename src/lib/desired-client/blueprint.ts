import { AREA_CATALOG, getAnswerLabel, getWorkLabel } from "./catalog";
import { buildDefinitionSentence } from "./definition";
import { calculateContribution, hasNegativeContribution, type CalculatedContribution } from "./economics";
import { getSourceDetails } from "./sources";
import { DESIRED_CLIENT_ANSWER_PATHS } from "./answer-paths";
import type { AnswerReferencePath, ClientDecisionPathway, DesiredClientAnswers, DesiredClientBrief, DesiredClientBriefV2, DesiredClientBriefV4, EvidenceBasis, EvidenceCard, EvidenceLinkedStatement, SavedBrief } from "./types";

export type BlueprintMetadata = {
  mode: SavedBrief["mode"];
  generatedAt: string;
  wordingReviewed: boolean;
  openClarificationCode?: SavedBrief["openClarificationCode"];
};

export const EVIDENCE_BASIS_LABELS: Record<EvidenceBasis, string> = {
  firm_reported_recorded: "Firm-reported records",
  firm_reported_estimate: "Firm estimate",
  firm_reported_experience: "Firm-reported experience",
  firm_reported_observation: "Firm-reported observation",
  client_reported: "Client-reported information",
  firm_preference: "Firm preference",
  source_observed: "Observed source",
  hypothesis: "To test",
  unknown: "Still open",
};

export type BlueprintCard = {
  id: "practice" | "clientMatter" | "value" | "fit" | "opportunity" | "repeatability" | "clientGoals" | "whyWork" | "whyFirm" | "recognition" | "evidence";
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
  definitionComponents: DesiredClientBrief["definition_components"] | DesiredClientBriefV4["definition_components"];
  cards: BlueprintCard[];
  decisionPathway: ClientDecisionPathway | null;
  openQuestions: EvidenceLinkedStatement[];
  conditions: string[];
  progressReview: { metric: string; target: string; reviewPeriod: string; status: string };
  sourceDetails: Array<{ slot: string; statement: EvidenceLinkedStatement; answers: Array<{ path: AnswerReferencePath; question: string; answer: string | null }> }>;
  allAnswers: Array<{ question: string; answer: string }>;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not recorded" : date.toLocaleDateString("en-CA");
};

const MATTER_COUNTS: Record<string, number> = { zero: 0, none: 0, no: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
function parseMatterVolume(value: string): { count: number; period: string } | null {
  const match = value.trim().toLocaleLowerCase("en-CA").match(/^(?:about\s+|roughly\s+|up to\s+|at most\s+)?(\d{1,3}|zero|none|no|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+(?:additional|retained|new|acquisition|buyer-side|seller-side|buyer|seller|business|family|completed|signed|closed))*?(?:\s+(?:matters?|cases?|transactions?))?\s+(?:per|each|every)\s+(week|month|quarter|year)\b/u);
  if (!match) return null;
  const count = /^\d+$/u.test(match[1]) ? Number(match[1]) : MATTER_COUNTS[match[1]];
  return Number.isFinite(count) ? { count, period: match[2] } : null;
}

const CARD_DEFINITIONS = [
  ["practice", "Practice we are building", "practice_context"],
  ["clientMatter", "Desired client and matter", "desired_client_matter"],
  ["value", "Why this work matters to the firm", "value_rationale"],
  ["fit", "What makes an inquiry relevant", "relevance_signals"],
  ["opportunity", "Evidence of opportunity", "opportunity_evidence"],
  ["repeatability", "What repeatable progress means", "repeatability"],
] as const;

const V4_CARD_DEFINITIONS = [
  ["clientMatter", "Desired client and matter", "client_and_matter"],
  ["clientGoals", "Client goals and needs", "client_goals_needs"],
  ["whyWork", "Why this work", "why_firm_wants_work"],
  ["whyFirm", "Why clients choose the firm", "why_client_chooses_firm"],
  ["recognition", "Matter signals", "recognizable_circumstances"],
  ["evidence", "Evidence & open questions", "evidence_and_open_questions"],
] as const;

/** Report edit actions mapped to the interview stage that contains those answers. */
export const REPORT_EDIT_LINKS = [
  [1, "Edit practice"],
  [2, "Edit client and matter"],
  [3, "Edit value"],
  [4, "Edit firm fit"],
  [5, "Edit matter signals"],
  [6, "Edit opportunity and progress"],
] as const;

function evidenceStatus(brief: DesiredClientBrief | DesiredClientBriefV2 | DesiredClientBriefV4): string {
  const statements = brief.report_version === "dcm-blueprint-v4"
    ? [...brief.client_and_matter.claims, ...brief.client_goals_needs.claims, ...brief.why_firm_wants_work.claims, ...brief.why_client_chooses_firm.claims, ...brief.recognizable_circumstances.claims, ...brief.evidence_and_open_questions.claims, ...Object.values(brief.decision_pathway)]
    : [
        ...(brief.report_version === "dcm-blueprint-v3" ? Object.values(brief.practice_context) : brief.practice_context.claims),
        ...brief.desired_client_matter.claims,
        ...brief.value_rationale.claims,
        ...brief.relevance_signals.claims,
        ...brief.opportunity_evidence.claims,
        ...brief.repeatability.claims,
      ];
  const bases = new Set(statements.map((statement) => statement.evidence_basis));
  if (bases.has("unknown") || bases.has("hypothesis")) return "Some parts of this direction still need evidence";
  if (bases.has("firm_reported_estimate")) return "Some commercial details are estimates";
  if (bases.has("firm_preference")) return "Includes the firm’s stated preferences";
  return "Evidence is described by its source";
}

export function buildBlueprintViewModel(brief: DesiredClientBrief | DesiredClientBriefV2 | DesiredClientBriefV4, answers: DesiredClientAnswers, meta: BlueprintMetadata): BlueprintViewModel {
  const definitions = brief.report_version === "dcm-blueprint-v4" ? V4_CARD_DEFINITIONS : CARD_DEFINITIONS;
  const cards: BlueprintCard[] = definitions.map(([id, title, key]) => {
    const rawClaims: EvidenceLinkedStatement[] = brief.report_version === "dcm-blueprint-v4"
      ? (brief[key as keyof DesiredClientBriefV4] as EvidenceCard).claims
      : key === "practice_context"
        ? brief.report_version === "dcm-blueprint-v3" ? Object.values(brief.practice_context) : brief.practice_context.claims
        : (brief[key as keyof DesiredClientBrief] as EvidenceCard).claims;
    const practiceLabels = ["Current practice", "Work to grow", "Experience supporting this direction", "Development needs", "Marketing emphasis to reduce"];
    const claims = key === "practice_context" && brief.report_version === "dcm-blueprint-v3"
      ? rawClaims.map((claim, index) => ({ ...claim, text: `${practiceLabels[index]}: ${claim.text}` }))
      : rawClaims;
    // Economics is derived by the application and shown beside the firm's
    // rationale. It must never depend on AI-authored arithmetic in a claim.
    const contribution = (id === "value" || id === "whyWork") ? calculateContribution(answers) : null;
    const opportunityHasResults = brief.report_version !== "dcm-blueprint-v4" && id === "opportunity" && Boolean(answers.opportunity.sources.length || answers.opportunity.source_detail.trim() || answers.opportunity.enquiry_count.trim() || answers.opportunity.retained_count.trim() || answers.opportunity.conversion.trim() || answers.opportunity.acquisition_cost.trim());
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
    ...(brief.report_version === "dcm-blueprint-v4"
      ? (Object.entries(brief.decision_pathway) as Array<[string, EvidenceLinkedStatement]>).map(([key, statement]) => [`Client decision pathway · ${key.replaceAll("_", " ")}`, statement] as const)
      : brief.open_questions.map((statement, index) => [`Point to resolve ${index + 1}`, statement] as const)),
  ];
  const sourceDetails = detailStatements.map(([slot, statement]) => ({
    slot,
    statement,
    answers: statement.source_answer_ids.map((path: AnswerReferencePath) => ({ ...getSourceDetails(path, answers), path })),
  }));
  const allAnswers = DESIRED_CLIENT_ANSWER_PATHS.flatMap((path) => {
    const source = getSourceDetails(path, answers);
    return source.answer === null || !source.answer.trim() ? [] : [{ question: source.question, answer: source.answer }];
  }).filter((item, index, list) => list.findIndex((candidate) => candidate.question === item.question && candidate.answer === item.answer) === index);
  const area = answers.focus.area ? AREA_CATALOG[answers.focus.area].label : "Practice area to define";
  const work = answers.focus.work === "other"
    ? answers.focus.work_other.trim()
    : answers.focus.area && answers.focus.work ? getWorkLabel(answers.focus.area, answers.focus.work) : "Matter to define";
  const title = work && work !== "Matter to define" ? `${area}: ${work}` : `${area} desired client profile`;
  const confirmed = meta.wordingReviewed;
  const contributionResult = calculateContribution(answers);
  const conditions: string[] = [];
  if (!answers.client_context.repeat_matter_pattern.trim()) conditions.push("The specific legal engagement still needs to be defined.");
  if (!answers.client.goal_detail.trim()) conditions.push(answers.client.goals.includes("unknown") ? "The firm marked the client's practical benefit as not yet known." : "The practical benefit to the client still needs to be described.");
  if (answers.delivery.capacity === "unknown" || !answers.delivery.capacity) conditions.push("Capacity to take on more of this work has not been established.");
  if (answers.delivery.capacity === "limited") conditions.push("Current capacity is limited; confirm what volume the team can support.");
  if (answers.delivery.capacity === "change") conditions.push("The team reported that growth depends on a delivery change.");
  if (answers.repeatability.staffing_constraint.trim()) conditions.push(`Before increasing volume, the firm identified this prerequisite: ${answers.repeatability.staffing_constraint.trim()}`);
  const capacityVolume = parseMatterVolume(answers.repeatability.additional_matters);
  const targetVolume = parseMatterVolume(answers.repeatability.target);
  const targetExceedsCapacity = Boolean(capacityVolume && targetVolume && capacityVolume.period === targetVolume.period && targetVolume.count > capacityVolume.count);
  if (capacityVolume?.count === 0) conditions.push("The firm reported no additional matter capacity at present.");
  if (targetExceedsCapacity && capacityVolume && targetVolume) conditions.push(`The proposed target of ${targetVolume.count} matter${targetVolume.count === 1 ? "" : "s"} per ${targetVolume.period} exceeds the stated additional capacity of ${capacityVolume.count} matter${capacityVolume.count === 1 ? "" : "s"} per ${capacityVolume.period}; resolve the mismatch before treating the target as available volume.`);
  if (!capacityVolume && answers.repeatability.additional_matters.trim() && /^(0|none|no additional|zero)\b/i.test(answers.repeatability.additional_matters.trim())) conditions.push("The firm reported no additional matter capacity at present.");
  if (contributionResult && hasNegativeContribution(answers)) conditions.push(answers.value.reasons.includes("fees")
    ? `The firm selected fee sustainability as a reason to pursue this work, but the supplied fee and direct-cost figures calculate to a negative contribution of ${contributionResult.amount} before overhead and acquisition costs; reconcile this mismatch before treating fee sustainability as commercially supported.`
    : `The supplied fee and direct-cost figures calculate to a negative contribution of ${contributionResult.amount} before overhead and acquisition costs; resolve this conflict before treating the work as commercially attractive.`);
  else if ((answers.value.fee_amount.trim() || answers.value.direct_cost_amount.trim()) && !contributionResult) conditions.push("The supplied financial figures could not be compared on the same currency, scope and per-matter basis.");
  if (answers.opportunity.uncertainty.trim()) conditions.push(`Demand uncertainty reported by the firm: ${answers.opportunity.uncertainty.trim()}`);
  if (answers.opportunity.sources.includes("unknown") || answers.opportunity.sources.includes("no_evidence")) conditions.push("Demand and acquisition evidence still need to be established.");
  if (answers.practice.experience === "new" && answers.practice.development_needs.length) conditions.push("This is a new area for the firm; identify the development work required before increasing volume.");
  const progressMeasure = answers.repeatability.success_measure && answers.repeatability.success_measure !== "unknown"
    ? answers.repeatability.success_measure === "other" ? answers.repeatability.success_other.trim() : getAnswerLabel("repeatability.success_measure", answers) ?? ""
    : "";
  const progressReview = {
    metric: progressMeasure || "Not selected",
    target: answers.repeatability.target.trim() || "Not set",
    reviewPeriod: answers.repeatability.review_period.trim() || "Not set",
    status: progressMeasure && answers.repeatability.target.trim() ? "Proposed; firm approval required" : "Needs definition",
  };
  return {
    title,
    status: confirmed ? "Wording reviewed" : "Draft wording",
    evidenceStatus: evidenceStatus(brief),
    modeLabel: meta.mode === "ai" ? "AI-assisted draft" : "Structured draft",
    date: formatDate(meta.generatedAt),
    confirmed,
    definition: brief.report_version === "dcm-blueprint-v4" || brief.report_version === "dcm-blueprint-v2" ? brief.definition_sentence : buildDefinitionSentence(brief, confirmed),
    definitionComponents: brief.definition_components,
    cards,
    decisionPathway: brief.report_version === "dcm-blueprint-v4" ? brief.decision_pathway : null,
    openQuestions: brief.report_version === "dcm-blueprint-v4" ? [] : brief.open_questions,
    conditions,
    progressReview,
    sourceDetails,
    allAnswers,
  };
}
