import { resolveAnswerReference } from "./catalog";
import { buildDefinitionSentence } from "./definition";
import { getAnswerLabel } from "./catalog";
import { buildStructuredBlueprintV4, paymentContextEvidenceClaim, paymentEvidenceClaim, paymentEvidenceClaims } from "./structured-blueprint";
import { calculateContribution, hasNegativeContribution } from "./economics";
import { DESIRED_CLIENT_ANSWER_PATHS } from "./answer-paths";
import { isInterviewClarificationCurrent, type AnalysisResult, type AnswerReferencePath, type ClarificationCode, type DesiredClientAnswers, type DesiredClientBriefV4, type EvidenceBasis, type EvidenceLinkedStatement } from "./types";

const SOURCE_PATHS = new Set<string>(DESIRED_CLIENT_ANSWER_PATHS);
const FOLLOWUP_STAGES: Record<string, number[]> = { client_and_matter:[1,2], client_goals_needs:[2], why_firm_wants_work:[3], why_client_chooses_firm:[4], recognizable_circumstances:[5,6], evidence_and_open_questions:[1,2,3,4,5,6], decision_pathway:[2,5,6], definition_client_type:[2], definition_client_matter:[2], definition_reasons:[3], definition_outcome:[6] };
type SafeSourcePath = AnswerReferencePath | `interview.followups.${number}`;
export function isSafeSourcePath(path: string): path is SafeSourcePath {
  return SOURCE_PATHS.has(path) || /^interview\.followups\.\d+$/.test(path);
}
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
const NUMBERS_UNDER_TWENTY: Record<string, number> = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19 };
const NUMBER_TENS: Record<string, number> = { twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
const NUMBER_UNIT_CONTEXT = /\b(?:matters?|clients?|cases?|deals?|transactions?|quarters?|months?|weeks?|days?|years?|hours?|fees?|costs?|dollars?|percent(?:age)?s?|points?|inquiries|enquiries|referrals?|leads?)\b/i;
const POSITIVE_ECONOMICS = /\b(?:profitable|positive (?:contribution|margin)|fees? (?:are )?worthwhile|fees? support(?:s)? the effort|margin is positive)\b/giu;

/** Reject a claim of current positive economics, while allowing the model to
 * describe a negative result or a condition the firm still needs to meet. */
function assertsPositiveEconomics(text: string): boolean {
  for (const match of text.matchAll(POSITIVE_ECONOMICS)) {
    const preceding = text.slice(0, match.index).split(/[.!?;,]/u).at(-1)?.trim() ?? "";
    const following = text.slice((match.index ?? 0) + match[0].length).split(/[.!?;,]/u, 1)[0] ?? "";
    const negated = /\b(?:not|never|cannot|can't|no longer)\b(?:\s+\w+){0,5}\s*$/iu.test(preceding);
    const prerequisite = /\b(?:needs? to|must|should)\s+(?:\w+\s+){0,4}(?:establish|verify|achieve|confirm|reach|show|become)\s*$/iu.test(preceding);
    const unverified = /^\s+(?:remains? to be|still needs? to be)\s+(?:established|verified|confirmed)\b/iu.test(following);
    if (!negated && !prerequisite && !unverified) return true;
  }
  return false;
}

/** Match common written-out counts only when a nearby quantity word makes the
 * numeric meaning clear. This keeps “two matters” equivalent to “2 matters”
 * without treating every prose use of “one” or “first” as a figure. */
const spelledNumericTokens = (text: string): string[] => {
  const tokens: string[] = [];
  const numberPattern = /\b(?:(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](one|two|three|four|five|six|seven|eight|nine))?|(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen))\b/giu;
  for (const match of text.matchAll(numberPattern)) {
    const after = text.slice((match.index ?? 0) + match[0].length).split(/[.!?;,]/u, 1)[0] ?? "";
    if (!/^(?:\s+[\p{L}'-]+){0,5}\s+\p{L}/u.test(after) || !NUMBER_UNIT_CONTEXT.test(after)) continue;
    const tens = match[1]?.toLocaleLowerCase("en-CA");
    const unit = match[2]?.toLocaleLowerCase("en-CA");
    const small = match[3]?.toLocaleLowerCase("en-CA");
    const value = tens ? NUMBER_TENS[tens] + (unit ? NUMBERS_UNDER_TWENTY[unit] : 0) : NUMBERS_UNDER_TWENTY[small ?? ""];
    if (Number.isFinite(value)) tokens.push(String(value));
  }
  return tokens;
};

const numericTokens = (text: string) => [ ...[...text.matchAll(/[+-]?\s*(?:[$€£]\s*)?\d+(?:[\s,]\d{3})*(?:\.\d+)?\s*%?/gu)].map((match) => {
  const raw = match[0].replace(/\s/g, "");
  const sign = raw.startsWith("-") ? "-" : raw.startsWith("+") ? "+" : "";
  return sign + raw.replace(/[^\d.%]/g, "");
}), ...spelledNumericTokens(text) ];
export type AnalysisValidationFailure = { field: string; reason: string; sourcePath?: AnswerReferencePath | `interview.followups.${number}` };

/** A description of uncertainty is still an evidence gap, even when its text
 * is populated. Share this classification with both model input and schema. */
export function isUnresolvedEvidenceSource(path: string, answers: DesiredClientAnswers): boolean {
  const source = resolveAnswerReference(path as AnswerReferencePath, answers);
  return source.unknown || source.value === null || source.value === "" ||
    path === "opportunity.uncertainty" ||
    (path === "opportunity.sources" && answers.opportunity.sources.includes("no_evidence"));
}

function allowedPaths(slot: string): readonly string[] {
  if (slot === "practice_current_practice") return ["practice.firm_type"];
  if (slot === "practice_work_to_grow") return ["focus.area", "focus.work", "focus.work_other", "practice.direction"];
  if (slot === "practice_experience_supporting") return ["practice.experience", "practice.capability"];
  if (slot === "practice_development_needs") return ["practice.experience", "practice.development_needs"];
  if (slot === "practice_marketing_emphasis") return ["direction.less", "direction.less_note", "direction.less_reason"];
  if (slot === "definition_client_type") return ["situation.role", "situation.role_other", "client_context.geography", "client_context.community_focus"];
  if (slot === "definition_client_matter") return ["focus.area", "focus.work", "focus.work_other", "situation.trigger", "situation.role", "situation.role_other", "situation.timing", "client_context.geography", "client_context.relevant_circumstances", "client_context.repeat_matter_pattern", "write_ins.trigger"];
  if (slot === "practice_context") return ["practice.", "focus.", "direction."];
  if (slot === "client_and_matter") return ["focus.","situation.","client_context.geography","client_context.relevant_circumstances","client_context.repeat_matter_pattern","write_ins.trigger"];
  if (slot === "client_goals_needs") return ["client.","situation.","client_context.","write_ins.goals","write_ins.concerns","write_ins.decision_needs"];
  if (slot === "why_firm_wants_work") return ["practice.","value.","delivery.","direction.","repeatability.staffing_constraint","repeatability.additional_matters","write_ins.reasons","write_ins.fee_effort","write_ins.conditions","write_ins.capacity","write_ins.limit"];
  if (slot === "why_client_chooses_firm") return ["client.choice_","practice.client_strength","practice.capability","practice.experience"];
  if (slot === "decision_pathway") return ["situation.","client.goals","client.goal_detail","client.concerns","client.decision_needs","client.decision_context","client.pathway_basis","write_ins.trigger","write_ins.timing","write_ins.contact","write_ins.goals","write_ins.decision_needs"];
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

/** Exact registered answer paths the model may cite for a report slot. Keep
 * prompt guidance and validation aligned by deriving both from this policy. */
export function allowedSourceAnswerPaths(slot: string): AnswerReferencePath[] {
  const prefixes = allowedPaths(slot);
  return DESIRED_CLIENT_ANSWER_PATHS.filter((path) => prefixes.some((prefix) => path.startsWith(prefix)));
}

export function permittedSourceAnswerPath(path: string, answers: DesiredClientAnswers, slot: string): boolean {
  if (!path.startsWith("interview.followups.")) return allowedPaths(slot).some((prefix) => path.startsWith(prefix));
  const indexText = path.slice("interview.followups.".length);
  if (!/^\d+$/.test(indexText)) return false;
  const item = answers.interview.followups[Number(indexText)];
  return !!item && !item.skipped && isInterviewClarificationCurrent(item, answers) && (FOLLOWUP_STAGES[slot] ?? []).includes(item.stage);
}

export function allowedSourceAnswerPathsForAnswers(slot: string, answers: DesiredClientAnswers): string[] {
  const paths: string[] = allowedSourceAnswerPaths(slot);
  answers.interview.followups.forEach((item, index) => {
    const path = `interview.followups.${index}`;
    if (isInterviewClarificationCurrent(item, answers) && !item.skipped && permittedSourceAnswerPath(path, answers, slot)) paths.push(path);
  });
  return paths;
}

function validStatement(value: unknown, answers: DesiredClientAnswers, slot: string, reportFailure?: (reason: string, sourcePath?: SafeSourcePath) => void): value is EvidenceLinkedStatement {
  const reject = (reason: string, sourcePath?: SafeSourcePath) => { reportFailure?.(reason, sourcePath); return false; };
  const budget = BUDGETS[slot as keyof typeof BUDGETS] ?? BUDGETS.open;
  if (!exact(value, ["text", "kind", "source_answer_ids", "evidence_basis"]) || typeof value.text !== "string" || typeof value.kind !== "string" || !KIND.includes(value.kind as typeof KIND[number]) || !Array.isArray(value.source_answer_ids) || typeof value.evidence_basis !== "string" || !BASIS.includes(value.evidence_basis as EvidenceBasis)) return reject("statement_shape");
  const text = value.text.trim().replace(/\s+/g, " ");
  if (!text || text.length > budget[1] || wordCount(text) > budget[0] || BANNED.test(text)) return reject("statement_text_budget_or_format");
  const paths = value.source_answer_ids as unknown[];
  if (paths.length < 1 || paths.length > 8) return reject("source_answer_path_count");
  if (new Set(paths).size !== paths.length) return reject("source_answer_path_duplicate");
  if (paths.some((path) => typeof path !== "string" || !isSafeSourcePath(path))) return reject("source_answer_path_unrecognized");
  const disallowedPath = paths.find((path) => typeof path === "string" && !permittedSourceAnswerPath(path, answers, slot));
  if (typeof disallowedPath === "string" && isSafeSourcePath(disallowedPath)) return reject("source_answer_path_not_allowed_for_slot", disallowedPath);
  const combinedPayment = paymentEvidenceClaims(answers).find(claim => claim.source_answer_ids.includes("value.payment") && claim.source_answer_ids.includes("value.payment_context"));
  const expectedPayment = paymentEvidenceClaim(answers);
  const expectedContext = paymentContextEvidenceClaim(answers);
  const isCombinedPayment = paths.length === 3 && !!combinedPayment && !!expectedPayment && !!expectedContext &&
    combinedPayment.source_answer_ids.length === 3 && combinedPayment.source_answer_ids.every(path => paths.includes(path)) &&
    expectedPayment.evidence_basis === expectedContext.evidence_basis && expectedPayment.kind === expectedContext.kind &&
    value.evidence_basis === expectedPayment.evidence_basis && value.kind === expectedPayment.kind;
  if (paths.includes("value.payment") && (!answers.value.payment || (paths.length !== 1 && (!combinedPayment || paths.length !== combinedPayment.source_answer_ids.length || !combinedPayment.source_answer_ids.every(path => paths.includes(path)) || text !== combinedPayment.text)))) return reject("payment_source_must_be_isolated");
  if (paths.includes("value.payment")) {
    if (!expectedPayment || value.kind !== expectedPayment.kind || value.evidence_basis !== expectedPayment.evidence_basis) return reject("payment_evidence_status_mismatch", "value.payment");
  }
  if (paths.some((path) => path === "value.payment_context" || path === "value.payment_context_basis")) {
    const expected = combinedPayment?.text===text ? combinedPayment : expectedContext;
    if (!expected || !paths.includes("value.payment_context") || !paths.includes("value.payment_context_basis") ||
      value.kind !== expected.kind || value.evidence_basis !== expected.evidence_basis || text !== expected.text) {
      return reject("payment_context_claim_mismatch", "value.payment_context");
    }
  }
  let hasUnknown = false;
  let unresolvedPath: SafeSourcePath | undefined;
  const supportedValues: string[] = [];
  for (const path of paths as AnswerReferencePath[]) {
    const resolved = resolveAnswerReference(path, answers);
    if (!resolved.present || (resolved.value === null && value.evidence_basis !== "unknown")) return reject("source_answer_unavailable");
    if (isUnresolvedEvidenceSource(path, answers)) { hasUnknown = true; unresolvedPath ??= path; }
    else if (Array.isArray(resolved.value) && resolved.value.every((item) => typeof item === "string")) supportedValues.push(...resolved.value);
    else if (typeof resolved.value === "string") supportedValues.push(resolved.value);
    else return reject("unsupported_source_value_type");
    if (path === "value.collected_fee" || path === "value.team_hours") {
      const optionLabel = getAnswerLabel(path, answers);
      if (optionLabel) supportedValues.push(optionLabel);
    }
  }
  if (hasUnknown !== (value.evidence_basis === "unknown")) return reject("unknown_evidence_basis_mismatch", unresolvedPath ?? paths[0] as SafeSourcePath);
  if (value.evidence_basis === "unknown" && value.kind !== "unknown") return reject("unknown_evidence_kind_mismatch");
  const contributionCheck = slot === "why_firm_wants_work" ? calculateContribution(answers) : null;
  if (contributionCheck && hasNegativeContribution(answers) && assertsPositiveEconomics(text)) return reject("negative_contribution_claim");
  if (value.evidence_basis === "firm_reported_recorded") {
    const valueFigure = paths.some((path) => typeof path === "string" && path.startsWith("value."));
    const opportunityFigure = paths.some((path) => typeof path === "string" && path.startsWith("opportunity."));
    if (!(valueFigure && answers.value.amount_basis === "recorded") && !(opportunityFigure && answers.opportunity.data_basis === "recorded")) return reject("recorded_basis_mismatch");
  }
  if (value.evidence_basis === "firm_reported_estimate") {
    const valueFigure = paths.some((path) => typeof path === "string" && path.startsWith("value."));
    const opportunityFigure = paths.some((path) => typeof path === "string" && path.startsWith("opportunity."));
    if (!(valueFigure && answers.value.amount_basis === "estimated") && !(opportunityFigure && answers.opportunity.data_basis === "estimated")) return reject("estimate_basis_mismatch");
  }
  if (value.evidence_basis === "firm_reported_experience" && (
    value.kind !== "experience" ||
    (slot === "practice_current_practice"
      ? paths.length !== 1 || paths[0] !== "practice.firm_type"
      : !paths.some((path) => path === "practice.experience" || path === "practice.capability" || path === "practice.client_strength_support"))
  )) return reject("experience_basis_mismatch", paths[0] as SafeSourcePath);
  if (value.evidence_basis === "client_reported" || value.evidence_basis === "firm_reported_observation") {
    const expected = value.evidence_basis === "client_reported" ? "client_feedback" : "firm_observation";
    const paymentObservation = value.evidence_basis === "firm_reported_observation" && answers.focus.route === "established" &&
      ((paths.length === 1 && paths[0] === "value.payment") || (isCombinedPayment && paths.includes("value.payment")));
    const paymentContextSource = answers.value.payment_context.trim() && answers.value.payment_context_basis === expected &&
      ((paths.length === 2 && paths.includes("value.payment_context") && paths.includes("value.payment_context_basis")) ||
        (isCombinedPayment && paths.includes("value.payment_context") && paths.includes("value.payment_context_basis")));
    const valueRangeObservation = value.evidence_basis === "firm_reported_observation" && slot === "why_firm_wants_work" && answers.focus.route === "established" && paths.length > 0 && paths.every(path => path === "value.collected_fee" || path === "value.team_hours");
    const choice = paths.some(path => typeof path === "string" && path.startsWith("client.choice_"));
    const pathway = paths.some(path => typeof path === "string" && (path.startsWith("situation.") || ["client.goals","client.goal_detail","client.concerns","client.decision_needs","client.decision_context","client.pathway_basis"].includes(path)));
    if (!paymentObservation && !paymentContextSource && !valueRangeObservation && ((!choice && !pathway) || (choice && (!paths.includes("client.choice_basis") || answers.client.choice_basis !== expected)) || (pathway && (!paths.includes("client.pathway_basis") || answers.client.pathway_basis !== expected)))) return reject("client_reported_basis_mismatch");
  }
  if (value.evidence_basis === "source_observed" && !(paths.includes("opportunity.sources") && answers.opportunity.sources.some((source) => source !== "unknown" && source !== "no_evidence"))) return reject("source_observation_unavailable");
  if (["firm_reported_recorded", "firm_reported_estimate"].includes(value.evidence_basis as string) && value.kind !== "experience" && value.kind !== "hypothesis") return reject("evidence_kind_mismatch");
  if (value.evidence_basis === "firm_preference" && value.kind !== "preference") return reject("evidence_kind_mismatch");
  if (["firm_reported_observation","client_reported"].includes(value.evidence_basis) && value.kind !== "experience") return reject("evidence_kind_mismatch");
  if (["source_observed", "hypothesis"].includes(value.evidence_basis as string) && value.kind !== "experience" && value.kind !== "hypothesis" && value.kind !== "suggestion") return reject("evidence_kind_mismatch");
  if (slot === "open" && value.kind !== "unknown" && value.kind !== "suggestion") return reject("open_item_kind_mismatch");
  if (slot !== "open" && value.kind === "suggestion") return reject("non_open_suggestion");
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
    if (!contribution || !hasAllSources || !/\bcontribution\b/i.test(text) || unsupportedTokens.some((token) => !calculatedTokens.includes(token))) return reject("unsupported_numeric_claim");
  }
  return true;
}

function checkDefinitionPart(value: unknown, answers: DesiredClientAnswers, slot: string, reportFailure?: (reason: string, sourcePath?: SafeSourcePath) => void): value is EvidenceLinkedStatement {
  return validStatement(value, answers, slot, reportFailure);
}

function validCard(value: unknown, answers: DesiredClientAnswers, slot: string, reportFailure?: (reason: string, sourcePath?: SafeSourcePath) => void): value is { claims: EvidenceLinkedStatement[] } {
  if (!record(value)) { reportFailure?.("card_not_object"); return false; }
  if (!exact(value, ["claims"])) { reportFailure?.("card_shape"); return false; }
  if (!Array.isArray(value.claims)) { reportFailure?.("claims_not_array"); return false; }
  if (value.claims.length < 1) { reportFailure?.("card_claims_empty"); return false; }
  const claimLimit = slot === "why_firm_wants_work" ? 7 : 6;
  if (value.claims.length > claimLimit) { reportFailure?.("card_claim_limit_exceeded"); return false; }
  return value.claims.every((claim) => validStatement(claim, answers, slot, reportFailure));
}

function normalizePaymentEvidence(brief: Record<string, unknown>, answers: DesiredClientAnswers): { brief: Record<string, unknown>; blocked: boolean } {
  const expectedClaims = paymentEvidenceClaims(answers);
  const protectedPaths = new Set<string>(["value.payment", "value.payment_context", "value.payment_context_basis"]);
  const card = brief.why_firm_wants_work;
  if (!record(card) || !Array.isArray(card.claims)) return { brief, blocked: false };
  const claims = card.claims as unknown[];
  const protectedPathsForClaim = (claim: unknown) => record(claim) && Array.isArray(claim.source_answer_ids)
    ? claim.source_answer_ids.filter((path): path is string => typeof path === "string" && protectedPaths.has(path))
    : [];
  const protectedClaims = claims.filter((claim) => protectedPathsForClaim(claim).length > 0);
  if (!protectedClaims.length && !expectedClaims.length) return { brief, blocked: false };
  const mixedSourcePaths = new Set<string>(protectedClaims.flatMap((claim) =>
    record(claim) && Array.isArray(claim.source_answer_ids)
      ? claim.source_answer_ids.filter((path): path is string => typeof path === "string" && !protectedPaths.has(path))
      : [],
  ));
  let nextClaims: unknown[];
  if (mixedSourcePaths.size) {
    // Rebuild any claim that combines payment evidence with a different fact
    // as separate, application-owned statements with distinct sources.
    const structuredClaims = buildStructuredBlueprintV4(answers).why_firm_wants_work.claims;
    const recoveredFacts = structuredClaims.filter((claim) => claim.source_answer_ids.some((path) => mixedSourcePaths.has(path)));
    const representedPaths = new Set<string>(recoveredFacts.flatMap((claim) => claim.source_answer_ids));
    if ([...mixedSourcePaths].some((path) => !representedPaths.has(path))) return { brief, blocked: true };
    const overlapsMixedPaths = (claim: unknown) => record(claim) && Array.isArray(claim.source_answer_ids) && claim.source_answer_ids.some((path) => typeof path === "string" && mixedSourcePaths.has(path));
    const overlappingClaims = claims.filter((claim) => protectedPathsForClaim(claim).length === 0 && overlapsMixedPaths(claim));
    if (overlappingClaims.some((claim) => record(claim) && Array.isArray(claim.source_answer_ids) && claim.source_answer_ids.some((path) => typeof path === "string" && !representedPaths.has(path)))) {
      return { brief, blocked: true };
    }
    const retainedClaims = claims.filter((claim) => protectedPathsForClaim(claim).length === 0 && !overlapsMixedPaths(claim));
    nextClaims = [...retainedClaims, ...expectedClaims, ...recoveredFacts];
    if (nextClaims.length > 7) {
      const protectedRepresented = expectedClaims.every((expected) => structuredClaims.some((claim) =>
        protectedPathsForClaim(claim).some((path) => expected.source_answer_ids.some((source) => source === path))));
      const mixedRepresented = [...mixedSourcePaths].every((path) => structuredClaims.some((claim) => claim.source_answer_ids.some((source) => source === path)));
      if (!protectedRepresented || !mixedRepresented) return { brief, blocked: true };
      nextClaims = structuredClaims;
    }
  } else {
    const firstIndex = claims.findIndex((claim) => protectedPathsForClaim(claim).length > 0);
    const before = firstIndex < 0 ? claims : claims.slice(0, firstIndex);
    const after = firstIndex < 0 ? [] : claims.slice(firstIndex + 1);
    nextClaims = [...before.filter((claim) => protectedPathsForClaim(claim).length === 0), ...expectedClaims,
      ...after.filter((claim) => protectedPathsForClaim(claim).length === 0)];
    if (nextClaims.length > 7) return { brief, blocked: true };
  }
  return { brief: { ...brief, why_firm_wants_work: { ...card, claims: nextClaims } }, blocked: false };
}

/**
 * A valid model response can still omit a supplied commercial or capacity fact.
 * Recover only application-owned, source-linked statements that are absent from
 * the firm's value card. Never invent or paraphrase a missing fact.
 */
function normalizeGroundedFirmValueClaims(brief: Record<string, unknown>, answers: DesiredClientAnswers): { brief: Record<string, unknown>; blocked: boolean } {
  const card = brief.why_firm_wants_work;
  if (!record(card) || !Array.isArray(card.claims)) return { brief, blocked: false };
  const claims = card.claims as unknown[];
  const groundedClaims = buildStructuredBlueprintV4(answers).why_firm_wants_work.claims;
  const groundedPaths = new Set<string>(groundedClaims.flatMap((claim) => claim.source_answer_ids));
  const representedPaths = new Set<string>(claims.flatMap((claim) =>
    record(claim) && Array.isArray(claim.source_answer_ids)
      ? claim.source_answer_ids.filter((path): path is string => typeof path === "string")
      : [],
  ));
  const missing = groundedClaims.filter((claim) => claim.source_answer_ids.some((path) => !representedPaths.has(path)));
  if (!missing.length) return { brief, blocked: false };

  const hasAllSources = (candidate: unknown, expected: EvidenceLinkedStatement) => {
    if (!record(candidate) || !Array.isArray(candidate.source_answer_ids)) return false;
    const sourceIds = candidate.source_answer_ids;
    return expected.source_answer_ids.every((path) => sourceIds.includes(path));
  };
  const overlaps = (candidate: unknown, expected: EvidenceLinkedStatement) => {
    if (!record(candidate) || !Array.isArray(candidate.source_answer_ids)) return false;
    const sourceIds = candidate.source_answer_ids;
    return sourceIds.some((path) => expected.source_answer_ids.includes(path as AnswerReferencePath));
  };
  const nextClaims = [...claims];
  for (let pass = 0; pass <= groundedClaims.length; pass += 1) {
    const toRecover = groundedClaims.filter((claim) => !nextClaims.some((existing) => hasAllSources(existing, claim)));
    if (!toRecover.length) break;
    for (const claim of toRecover) {
      // Replace a partial or mixed model claim with the complete application-owned
      // statement. Any other grounded fact it carried will be recovered in its own
      // pass below, rather than disappearing with the replacement.
      for (let index = nextClaims.length - 1; index >= 0; index -= 1) {
        if (overlaps(nextClaims[index], claim) && !hasAllSources(nextClaims[index], claim)) nextClaims.splice(index, 1);
      }
      if (!nextClaims.some((existing) => hasAllSources(existing, claim))) nextClaims.push(claim);
    }
  }
  while (nextClaims.length > 7) {
    const removable = nextClaims.findIndex((claim) =>
      record(claim) && Array.isArray(claim.source_answer_ids) &&
      !claim.source_answer_ids.some((path) => typeof path === "string" && groundedPaths.has(path)),
    );
    if (removable < 0) return { brief, blocked: true };
    nextClaims.splice(removable, 1);
  }
  return { brief: { ...brief, why_firm_wants_work: { ...card, claims: nextClaims } }, blocked: false };
}

export function validateAnalysisResult(value: unknown, answers: DesiredClientAnswers, _eligibleCodes: readonly ClarificationCode[], reportFailure?: (failure: AnalysisValidationFailure) => void): AnalysisResult | null {
  const reject = (field: string, reason: string) => { reportFailure?.({ field, reason }); return null; };
  if (!exact(value, ["brief", "clarification_code"])) return reject("report", "root_shape");
  if (value.clarification_code !== null) return reject("report", "unexpected_clarification_code");
  const sourceBrief=value.brief;
  const cardNames=["client_and_matter","client_goals_needs","why_firm_wants_work","why_client_chooses_firm","recognizable_circumstances","evidence_and_open_questions"] as const;
  if(!exact(sourceBrief,["report_version","definition_sentence","definition_components",...cardNames,"decision_pathway"]))return reject("report", "brief_shape");
  // Validate source claims before omission recovery. Payment claims may be
  // normalized for harmless wording or mixed-source separation, but their
  // evidence status and numeric content must still be authentic.
  const paymentPaths = new Set(["value.payment", "value.payment_context", "value.payment_context_basis"]);
  const sourceValueCard = sourceBrief.why_firm_wants_work;
  if (record(sourceValueCard) && Array.isArray(sourceValueCard.claims)) {
    for (const claim of sourceValueCard.claims) {
      const hasPaymentSource = record(claim) && Array.isArray(claim.source_answer_ids) &&
        claim.source_answer_ids.some((path) => typeof path === "string" && paymentPaths.has(path));
      const unsupportedPaymentAssertion = hasPaymentSource && record(claim) && Array.isArray(claim.source_answer_ids) &&
        claim.source_answer_ids.length === 1 && claim.source_answer_ids[0] === "value.payment" &&
        typeof claim.text === "string" && /\b(?:audited?|records?|prove[sd]?|all clients?|every client|always|never|paid on time|on time)\b/iu.test(claim.text);
      if (unsupportedPaymentAssertion) return reject("why_firm_wants_work", "claim_not_valid");
      let failure: { reason: string; sourcePath?: SafeSourcePath } | undefined;
      if (validStatement(claim, answers, "why_firm_wants_work", (reason, sourcePath) => { failure = { reason, ...(sourcePath ? { sourcePath } : {}) }; })) continue;
      if (!hasPaymentSource || !record(claim) || !Array.isArray(claim.source_answer_ids)) {
        if (failure) reportFailure?.({ field: "why_firm_wants_work", ...failure });
        return reject("why_firm_wants_work", "claim_not_valid");
      }
      const repairablePaymentWording = failure?.reason === "payment_source_must_be_isolated" || failure?.reason === "payment_context_claim_mismatch";
      const expectedPayment = paymentEvidenceClaim(answers);
      const expectedContext = paymentContextEvidenceClaim(answers);
      const paymentStatusMatches = !claim.source_answer_ids.includes("value.payment") ||
        (!!expectedPayment && claim.kind === expectedPayment.kind && claim.evidence_basis === expectedPayment.evidence_basis);
      const contextStatusMatches = !claim.source_answer_ids.some((path) => path === "value.payment_context" || path === "value.payment_context_basis") ||
        (!!expectedContext && claim.kind === expectedContext.kind && claim.evidence_basis === expectedContext.evidence_basis);
      if (!repairablePaymentWording || !paymentStatusMatches || !contextStatusMatches) {
        if (failure) reportFailure?.({ field: "why_firm_wants_work", ...failure });
        return reject("why_firm_wants_work", "claim_not_valid");
      }
    }
  }
  const normalizedPayment = normalizePaymentEvidence(sourceBrief, answers);
  if (normalizedPayment.blocked) return reject("why_firm_wants_work", "payment_claim_cannot_fit_without_dropping_other_claims");
  const normalizedFacts = normalizeGroundedFirmValueClaims(normalizedPayment.brief, answers);
  if (normalizedFacts.blocked) return reject("why_firm_wants_work", "grounded_fact_claims_cannot_fit_without_dropping_other_claims");
  const brief = normalizedFacts.brief;
  if(brief.report_version!=="dcm-blueprint-v4")return reject("report", "unsupported_report_version");
  if(typeof brief.definition_sentence!=="string")return reject("definition_sentence", "sentence_not_text");
  if(!exact(brief.definition_components,["client","client_matter","reasons","outcome"]))return reject("definition_components", "component_shape");
  const components=brief.definition_components;
  const definitionParts = [["client","definition_client_type"],["client_matter","definition_client_matter"],["reasons","definition_reasons"],["outcome","definition_outcome"]] as const;
  for (const [field, slot] of definitionParts) if (!checkDefinitionPart(components[field],answers,slot,(reason,sourcePath)=>reportFailure?.({field:`definition_components.${field}`,reason,...(sourcePath?{sourcePath}:{})}))) return null;
  for(const field of cardNames)if(!validCard(brief[field],answers,field,(reason,sourcePath)=>reportFailure?.({field,reason,...(sourcePath?{sourcePath}:{})})))return null;
  const pathway=brief.decision_pathway;
  if(!exact(pathway,["trigger","first_contact","decision","desired_progress"]))return reject("decision_pathway", "pathway_shape");
  const pathwayFields=["trigger","first_contact","decision","desired_progress"] as const;
  for(const field of pathwayFields)if(!validStatement(pathway[field],answers,"decision_pathway",(reason,sourcePath)=>reportFailure?.({field:`decision_pathway.${field}`,reason,...(sourcePath?{sourcePath}:{})})))return null;
  const typedBrief=brief as unknown as DesiredClientBriefV4;
  // A broad practice-area citation cannot support an invented client segment
  // or engagement. Require the model's target fields to match the specific
  // client and matter rebuilt from the firm's answers, including provenance.
  const groundedTarget = buildStructuredBlueprintV4(answers);
  const sameGroundedStatement = (actual: EvidenceLinkedStatement, expected: EvidenceLinkedStatement) =>
    actual.text.trim().replace(/\s+/g, " ") === expected.text.trim().replace(/\s+/g, " ") &&
    actual.kind === expected.kind && actual.evidence_basis === expected.evidence_basis &&
    actual.source_answer_ids.length === expected.source_answer_ids.length &&
    expected.source_answer_ids.every((path) => actual.source_answer_ids.includes(path));
  if (
    !sameGroundedStatement(typedBrief.definition_components.client, groundedTarget.definition_components.client) ||
    !sameGroundedStatement(typedBrief.definition_components.client_matter, groundedTarget.definition_components.client_matter) ||
    !sameGroundedStatement(typedBrief.definition_components.reasons, groundedTarget.definition_components.reasons)
  ) return reject("definition_components", "target_not_grounded_in_confirmed_answers");
  const targetClaims = groundedTarget.client_and_matter.claims;
  if (typedBrief.client_and_matter.claims.length !== targetClaims.length ||
    typedBrief.client_and_matter.claims.some((claim, index) => {
      const expected = targetClaims[index];
      return !expected || !sameGroundedStatement(claim, expected);
    })) {
    return reject("client_and_matter", "target_card_not_grounded_in_confirmed_answers");
  }
  // The outcome is application-owned so the proposed measure, target and
  // review period cannot disappear when the model returns a sparse component.
  const progressSources = new Set(["repeatability.target", "repeatability.review_period"]);
  const canonicalOutcome = groundedTarget.definition_components.outcome.source_answer_ids.some((path) => progressSources.has(path)) &&
    !sameGroundedStatement(typedBrief.definition_components.outcome, groundedTarget.definition_components.outcome)
    ? groundedTarget.definition_components.outcome
    : typedBrief.definition_components.outcome;
  const canonicalBrief = {
    ...typedBrief,
    definition_components: {
      ...typedBrief.definition_components,
      outcome: canonicalOutcome,
    },
  } as DesiredClientBriefV4;
  const expectedSentence=buildDefinitionSentence(canonicalBrief,false,answers.client.goal_detail,answers.client.goals.includes("unknown"));
  // The definition is assembled from bounded, source-linked fields. A hard
  // 85-word ceiling rejected valid, specific client-and-matter definitions;
  // keep a generous abuse limit while preserving supported detail.
  if(typedBrief.definition_sentence.length>1600||expectedSentence.length>1600)return reject("definition_sentence", "sentence_length");
  const reportWords=[...cardNames.flatMap(field=>canonicalBrief[field].claims.map(claim=>claim.text)),...pathwayFields.map(field=>canonicalBrief.decision_pathway[field].text)].reduce((sum,text)=>sum+wordCount(text),wordCount(expectedSentence));
  if(reportWords>800)return reject("report", "word_limit");
  return { clarification_code: null, brief: { ...canonicalBrief, definition_sentence: expectedSentence } };
}

const LINKED_STATEMENT_SCHEMA = { type: "object", properties: { text: { type: "string" }, kind: { type: "string", enum: KIND }, source_answer_ids: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } }, evidence_basis: { type: "string", enum: BASIS } }, required: ["text", "kind", "source_answer_ids", "evidence_basis"] } as const;
const EVIDENCE_CARD_SCHEMA = { type: "object", properties: { claims: { type: "array", minItems: 1, maxItems: 6, items: LINKED_STATEMENT_SCHEMA } }, required: ["claims"] } as const;
const WHY_FIRM_EVIDENCE_CARD_SCHEMA = { type: "object", properties: { claims: { type: "array", minItems: 1, maxItems: 7, items: LINKED_STATEMENT_SCHEMA } }, required: ["claims"] } as const;
export const BLUEPRINT_RESPONSE_SCHEMA = {
  type: "object", properties: {
    clarification_code: { type: "string", nullable: true, enum: ["CLIENT_MATTER_UNCLEAR", "VALUE_EFFORT_CONFLICT", "CAPACITY_CONFLICT", "REPEATABILITY_UNPROVEN", "OPPORTUNITY_UNSUPPORTED"] },
    brief: { type: "object", properties: {
      report_version: { type: "string", enum: ["dcm-blueprint-v4"] }, definition_sentence: { type: "string" },
      definition_components: { type: "object", properties: { client: LINKED_STATEMENT_SCHEMA, client_matter: LINKED_STATEMENT_SCHEMA, reasons: LINKED_STATEMENT_SCHEMA, outcome: LINKED_STATEMENT_SCHEMA }, required: ["client", "client_matter", "reasons", "outcome"] },
      client_and_matter:EVIDENCE_CARD_SCHEMA,client_goals_needs:EVIDENCE_CARD_SCHEMA,why_firm_wants_work:WHY_FIRM_EVIDENCE_CARD_SCHEMA,why_client_chooses_firm:EVIDENCE_CARD_SCHEMA,recognizable_circumstances:EVIDENCE_CARD_SCHEMA,evidence_and_open_questions:EVIDENCE_CARD_SCHEMA,
      decision_pathway:{type:"object",properties:{trigger:LINKED_STATEMENT_SCHEMA,first_contact:LINKED_STATEMENT_SCHEMA,decision:LINKED_STATEMENT_SCHEMA,desired_progress:LINKED_STATEMENT_SCHEMA},required:["trigger","first_contact","decision","desired_progress"]},
    }, required: ["report_version", "definition_sentence", "definition_components",...(["client_and_matter","client_goals_needs","why_firm_wants_work","why_client_chooses_firm","recognizable_circumstances","evidence_and_open_questions","decision_pathway"])] },
  }, required: ["clarification_code", "brief"],
} as const;
