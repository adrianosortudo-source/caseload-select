import { resolveAnswerReference } from "./catalog";
import { buildDefinitionSentence } from "./definition";
import { getAnswerLabel } from "./catalog";
import { buildStructuredBlueprintV4, paymentContextEvidenceClaim, paymentEvidenceClaim, paymentEvidenceClaims } from "./structured-blueprint";
import { calculateContribution, hasNegativeContribution } from "./economics";
import { DESIRED_CLIENT_ANSWER_PATHS } from "./answer-paths";
import { isInterviewClarificationCurrent, type AnalysisResult, type AnswerReferencePath, type ClarificationCode, type DesiredClientAnswers, type DesiredClientBriefV4, type EvidenceBasis, type EvidenceLinkedStatement } from "./types";
import { allowedSourceAnswerPathsForAnswers as registryAllowedPaths, buildDesiredClientEvidenceGroups, DESIRED_CLIENT_EVIDENCE_SLOTS, getProviderEvidenceSelection, isUnresolvedEvidenceSource as registryIsUnresolvedEvidenceSource, safeEvidenceDiagnostic, statementMatchesEvidenceGroups, type DesiredClientEvidenceSlot } from "./evidence-contract";

const SOURCE_PATHS = new Set<string>(DESIRED_CLIENT_ANSWER_PATHS);
type SafeSourcePath = AnswerReferencePath | `interview.followups.${number}`;
export function isSafeSourcePath(path: string): path is SafeSourcePath {
  return SOURCE_PATHS.has(path) || /^interview\.followups\.\d+$/.test(path);
}
export function isSafeDiagnosticSourcePath(path: string, answers: DesiredClientAnswers): boolean {
  if (path.length > 80) return false;
  let resolved;
  try { resolved = resolveAnswerReference(path as AnswerReferencePath, answers); } catch { return false; }
  if (!resolved.present) return false;
  if (!SOURCE_PATHS.has(path)) {
    const match = /^interview\.followups\.(0|[1-9]\d{0,2})$/.exec(path);
    if (!match) return false;
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index < 0 || index >= answers.interview.followups.length) return false;
    const item = answers.interview.followups[index];
    if (!item || item.skipped || !isInterviewClarificationCurrent(item, answers)) return false;
  }
  return DESIRED_CLIENT_EVIDENCE_SLOTS.some(slot => buildDesiredClientEvidenceGroups(slot, answers).some(group => group.source_answer_ids.includes(path as AnswerReferencePath)));
}
const BASIS: readonly EvidenceBasis[] = ["firm_reported_recorded", "firm_reported_estimate", "firm_reported_experience", "firm_reported_observation", "client_reported", "firm_preference", "source_observed", "hypothesis", "unknown"];
const KIND = ["experience", "preference", "hypothesis", "unknown", "suggestion"] as const;
const BUDGETS = {
  definition_client_type: [25, 300], definition_client_matter: [75, 600], definition_reasons: [35, 300], definition_outcome: [25, 240],
  practice_context: [60, 420], desired_client_matter: [100, 700], value_rationale: [90, 650], relevance_signals: [70, 500], opportunity_evidence: [70, 500], repeatability: [65, 450], open: [25, 180],
  practice_current_practice: [30, 180], practice_work_to_grow: [30, 180], practice_experience_supporting: [35, 210], practice_development_needs: [30, 180], practice_marketing_emphasis: [35, 210],
  client_and_matter:[95,650], client_goals_needs:[95,650], why_firm_wants_work:[100,700], why_client_chooses_firm:[95,650],
  decision_pathway:[50,330], "decision_pathway.trigger":[30,240], "decision_pathway.first_contact":[30,240],
  "decision_pathway.decision":[30,240], "decision_pathway.desired_progress":[30,240],
  recognizable_circumstances:[100,700], evidence_and_open_questions:[110,760],
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

const PAYMENT_LANGUAGE: Record<string, string> = {
  predictable: "payment is usually predictable",
  varies: "payment depends on the matter",
  uncertain: "payment is often uncertain",
};

const PAYMENT_MEANING_NEGATED = /\bpayment\b[^.!?;]{0,40}\b(?:not|never|rarely|seldom|hardly|isn\W?t|aren\W?t|doesn\W?t|don\W?t|can(?:not|\W?t)|won\W?t)\b[^.!?;]{0,20}\b(?:predictable|vary|varies|variable|depend|depends|uncertain)\b/iu;
function paymentMeaningIsPresent(text: string, payment: string | null): boolean {
  const lower = text.toLocaleLowerCase("en-CA");
  if (PAYMENT_MEANING_NEGATED.test(lower)) return false;
  if (payment === "predictable") return /\bpayment\b[\w\s-]{0,30}\bpredictable\b/iu.test(lower);
  if (payment === "varies") return /\bpayment\b[\w\s-]{0,30}\b(?:varies|variable|depends)\b/iu.test(lower);
  if (payment === "uncertain") return /\bpayment\b[\w\s-]{0,30}\buncertain\b/iu.test(lower);
  return false;
}

const PAYMENT_CONTEXT_STOP_WORDS = new Set([
  "about", "after", "also", "and", "been", "before", "from", "into", "last", "most", "our",
  "over", "that", "the", "their", "this", "within", "with", "would", "your",
]);
const PAYMENT_ON_TIME = /\b(?:on[ -]schedule|on[ -]time|prompt(?:ly)?|within\s+(?:the\s+)?\d+(?:\s+\w+){0,2}|not\s+(?:usually\s+)?late)\b/iu;
const PAYMENT_ON_TIME_NEGATED = /\b(?:not|never|rarely|seldom|hardly|infrequently)\b(?:\s+[\w'-]+){0,3}\s+(?:paid\s+)?on[ -](?:time|schedule)\b/iu;
const PAYMENT_LATE = /\b(?:late|delayed|overdue|past[ -]due|behind\s+schedule)\b/iu;
const MIXED_CLAIM_STOP_WORDS = new Set([
  ...PAYMENT_CONTEXT_STOP_WORDS, "a", "an", "are", "as", "at", "be", "been", "being", "but", "by", "can", "could", "did", "do", "does", "for", "from", "get", "gets", "has", "have", "in", "is", "it", "may", "of", "on", "or", "our", "should", "so", "than", "then", "there", "these", "they", "to", "was", "were", "will", "we", "when", "which", "who", "while", "you", "firm", "firms", "reports", "reported", "reporting", "states", "stated", "says", "said", "notes", "noted", "basis", "specified", "established", "observation", "observed", "hypothesis", "working", "assumption", "test", "testing", "context", "feedback", "payment", "payments", "claim", "claims", "current", "assessment", "additional", "supplied", "matter", "matters", "client", "clients",
]);

function answerTextForPath(path: string, answers: DesiredClientAnswers): string[] {
  const followup = /^interview\.followups\.(\d+)$/.exec(path);
  if (followup) {
    const answer = answers.interview.followups[Number(followup[1])]?.answer;
    return typeof answer === "string" && answer.trim() ? [answer] : [];
  }
  if (!SOURCE_PATHS.has(path)) return [];
  const resolved = resolveAnswerReference(path as AnswerReferencePath, answers);
  const values = typeof resolved.value === "string" && resolved.value.trim() ? [resolved.value] : [];
  const label = getAnswerLabel(path as AnswerReferencePath, answers);
  return label && !values.includes(label) ? [...values, label] : values;
}

function citationSupportsNumericTokens(text: string, paths: readonly string[], answers: DesiredClientAnswers): boolean {
  const sourceNumbers = paths.flatMap((path) => answerTextForPath(path, answers)).flatMap((source) => numericTokens(source));
  const unsupported = numericTokens(text).filter((token) => !sourceNumbers.includes(token));
  if (!unsupported.length) return true;
  const contribution = calculateContribution(answers);
  const economicsPaths = ["value.fee_amount", "value.direct_cost_amount", "value.currency", "value.amount_basis", "value.amount_scope"];
  const hasAllEconomicsSources = economicsPaths.every((path) => paths.includes(path));
  const calculatedTokens = contribution ? [contribution.amount, contribution.margin?.amount ?? ""].flatMap(numericTokens) : [];
  return !!contribution && hasAllEconomicsSources && /\bcontribution\b/iu.test(text) &&
    unsupported.every((token) => calculatedTokens.includes(token));
}

function normalizedGroundingToken(token: string): string {
  const lower = token.toLocaleLowerCase("en-CA");
  const aliasGroups = [
    ["usually", "generally", "typically"], ["said", "told", "reported"], ["paid", "received"],
    ["schedule", "scheduled", "time", "timely", "prompt", "promptly", "punctual", "punctually"], ["client", "clients", "buyer", "buyers"], ["handle", "handles", "handled", "handling"],
  ];
  const alias = aliasGroups.find((group) => group.includes(lower));
  if (alias) return alias[0];
  if (lower.length > 5 && lower.endsWith("ly")) return lower.slice(0, -2);
  if (lower.length > 5 && lower.endsWith("ed")) return lower.slice(0, -2);
  if (lower.length > 4 && lower.endsWith("s")) return lower.slice(0, -1);
  return lower;
}

const SENSITIVE_GROUNDING_TOKENS = new Set(["not", "no", "all", "only", "always", "never", "without", "cannot", "audited", "audit", "prove", "proves", "proven", "verified"]);
function significantGroundingTokens(text: string): string[] {
  return text.toLocaleLowerCase("en-CA").split(/[^\p{L}\p{N}]+/u)
    .filter((token) => (token.length > 3 || SENSITIVE_GROUNDING_TOKENS.has(token)) && !MIXED_CLAIM_STOP_WORDS.has(token) && !/^\d+$/u.test(token))
    .map(normalizedGroundingToken);
}

function mixedPaymentClaimLanguageIsGrounded(text: string, paths: readonly string[], answers: DesiredClientAnswers): boolean {
  const paymentPaths = new Set(["value.payment", "value.payment_context", "value.payment_context_basis"]);
  const mixedPaths = paths.filter((path) => !paymentPaths.has(path));
  if (!mixedPaths.length) return true;
  const structuredClaims = buildStructuredBlueprintV4(answers).why_firm_wants_work.claims;
  const relevantClaims = structuredClaims.filter((claim) => claim.source_answer_ids.some((path) => mixedPaths.includes(path)));
  if (mixedPaths.some((path) => !relevantClaims.some((claim) => claim.source_answer_ids.some((sourcePath) => sourcePath === path)))) return false;
  const supportedText = [
    ...paths.flatMap((path) => answerTextForPath(path, answers)),
    ...paymentEvidenceClaims(answers).filter((claim): claim is EvidenceLinkedStatement => claim !== null).map((claim) => claim.text),
    ...relevantClaims.map((claim) => claim.text),
  ];
  const supportedTokens = new Set(supportedText.flatMap(significantGroundingTokens));
  return significantGroundingTokens(text).every((token) => supportedTokens.has(token));
}

function claimNegationMatchesSources(text: string, paths: readonly string[], answers: DesiredClientAnswers): boolean {
  const negations = /\b(?:not|no|never|without|cannot|can\s+not|can\s*['’]t|do\s+not|don\s*['’]t|does\s+not|doesn\s*['’]t|is\s+not|isn\s*['’]t|are\s+not|aren\s*['’]t|was\s+not|wasn\s*['’]t|were\s+not|weren\s*['’]t|will\s+not|won\s*['’]t|hardly|rarely|seldom)\b/giu;
  const markers = (value: string) => [...value.matchAll(negations)].map(() => "negation");
  const claimMarkers = markers(text);
  if (!claimMarkers.length) return true;
  const sourceText = [
    ...paths.flatMap((path) => answerTextForPath(path, answers)),
    ...buildStructuredBlueprintV4(answers).why_firm_wants_work.claims
      .filter((claim) => claim.source_answer_ids.some((path) => paths.includes(path)))
      .map((claim) => claim.text),
  ].join(" ");
  return claimMarkers.length <= markers(sourceText).length;
}

const FALSE_AUDIT_ASSERTION = /\b(?:audited records? (?:prove|show|confirm)|records? (?:prove|show|confirm) (?:that )?(?:all|every)|(?:all|every) clients? (?:are )?proven)\b/iu;

/**
 * Payment is an application-owned enum plus an optional free-text note. A
 * model may rephrase a supported note, but it must retain the selected
 * payment meaning, the note's material context, and every supplied number.
 * This check runs before repairable payment wording is considered, so a
 * fabricated statement cannot be replaced by a canonical fallback.
 */
function paymentClaimIsAuthentic(value: unknown, answers: DesiredClientAnswers): boolean {
  if (!record(value) || !Array.isArray(value.source_answer_ids) || typeof value.text !== "string") return true;
  const paths = value.source_answer_ids.filter((path): path is string => typeof path === "string");
  const hasPayment = paths.includes("value.payment");
  const hasContext = paths.includes("value.payment_context") || paths.includes("value.payment_context_basis");
  if (!hasPayment && !hasContext) return true;
  const text = value.text.trim().replace(/\s+/g, " ");
  if (!citationSupportsNumericTokens(text, paths, answers) || !mixedPaymentClaimLanguageIsGrounded(text, paths, answers)) return false;
  const expectedPayment = paymentEvidenceClaim(answers);
  const expectedContext = paymentContextEvidenceClaim(answers);
  const exactSupported = [expectedPayment, expectedContext, ...(paymentEvidenceClaims(answers) ?? [])]
    .filter((claim): claim is EvidenceLinkedStatement => claim !== null)
    .some((claim) => claim.text === text);
  if (exactSupported) return true;

  // Keep the payment enum's meaning in every mixed or paraphrased claim.
  if (hasPayment) {
    const phrase = answers.value.payment ? PAYMENT_LANGUAGE[answers.value.payment] : "";
    if (answers.value.payment === "unknown") {
      if (!/\b(?:unknown|not established|not yet established|basis not specified)\b/iu.test(text)) return false;
    } else if (!phrase || !paymentMeaningIsPresent(text, answers.value.payment)) return false;
  }

  // A context note may be paraphrased, but it must leave a recognizable trace
  // and cannot introduce a different number. This permits the existing mixed
  // payment/experience repair while blocking generic or invented context.
  if (hasContext && answers.value.payment_context.trim()) {
    const contextWords = answers.value.payment_context.toLocaleLowerCase("en-CA")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 3 && !PAYMENT_CONTEXT_STOP_WORDS.has(word));
    const textWords = new Set(text.toLocaleLowerCase("en-CA").split(/[^\p{L}\p{N}]+/u));
    if (contextWords.length && !contextWords.some((word) => textWords.has(word))) return false;
    const noteIsOnTime = PAYMENT_ON_TIME.test(answers.value.payment_context) && !PAYMENT_ON_TIME_NEGATED.test(answers.value.payment_context);
    const noteIsLate = PAYMENT_ON_TIME_NEGATED.test(answers.value.payment_context) || (PAYMENT_LATE.test(answers.value.payment_context) && !/\bnot\s+(?:usually\s+)?late\b/iu.test(answers.value.payment_context));
    const claimIsOnTime = PAYMENT_ON_TIME.test(text) && !PAYMENT_ON_TIME_NEGATED.test(text);
    const claimIsLate = PAYMENT_ON_TIME_NEGATED.test(text) || (PAYMENT_LATE.test(text) && !/\bnot\s+(?:usually\s+)?late\b/iu.test(text));
    if ((noteIsOnTime && claimIsLate) || (noteIsLate && claimIsOnTime)) return false;
  }

  // Do not allow broad payment assertions to pass merely because they cite a
  // payment source. Exact user-supplied notes remain allowed above.
  if (/\b(?:audited?|records?|prove[sd]?|all clients?|every client|always|never)\b/iu.test(text)) return false;
  return true;
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
export type AnalysisClaimDiagnostic = ReturnType<typeof safeEvidenceDiagnostic>;
export type AnalysisValidationFailure = {
  field: string;
  reason: string;
  sourcePath?: AnswerReferencePath | `interview.followups.${number}`;
  claimDiagnostic?: AnalysisClaimDiagnostic;
};

function diagnosticForClaim(value: unknown, claimIndex: number, answers: DesiredClientAnswers, slot: DesiredClientEvidenceSlot): AnalysisClaimDiagnostic {
  return safeEvidenceDiagnostic(slot, value, claimIndex, answers);
}

/** A description of uncertainty is still an evidence gap, even when its text
 * is populated. Share this classification with both model input and schema. */
export function isUnresolvedEvidenceSource(path: string, answers: DesiredClientAnswers): boolean {
  return registryIsUnresolvedEvidenceSource(path, answers);
}

export function allowedSourceAnswerPathsForAnswers(slot: string, answers: DesiredClientAnswers): string[] {
  if (slot === "decision_pathway") return [...new Set(DESIRED_CLIENT_EVIDENCE_SLOTS.filter(candidate => candidate.startsWith("decision_pathway.")).flatMap(candidate => registryAllowedPaths(candidate, answers)))];
  return registryAllowedPaths(slot, answers);
}

function validStatement(value: unknown, answers: DesiredClientAnswers, slot: string, reportFailure?: (reason: string, sourcePath?: SafeSourcePath) => void): value is EvidenceLinkedStatement {
  const reject = (reason: string, sourcePath?: SafeSourcePath) => { reportFailure?.(reason, sourcePath); return false; };
  const providerSelection = value && typeof value === "object" ? getProviderEvidenceSelection(value) : undefined;
  if (providerSelection && !providerSelection.valid) return reject("evidence_group_selection_invalid");
  const budget = BUDGETS[slot as keyof typeof BUDGETS] ?? BUDGETS.open;
  if (!exact(value, ["text", "kind", "source_answer_ids", "evidence_basis"]) || typeof value.text !== "string" || typeof value.kind !== "string" || !KIND.includes(value.kind as typeof KIND[number]) || !Array.isArray(value.source_answer_ids) || typeof value.evidence_basis !== "string" || !BASIS.includes(value.evidence_basis as EvidenceBasis)) return reject("statement_shape");
  const text = value.text.trim().replace(/\s+/g, " ");
  if (!text || text.length > budget[1] || wordCount(text) > budget[0] || BANNED.test(text)) return reject("statement_text_budget_or_format");
  const paths = value.source_answer_ids as unknown[];
  if (paths.length < 1 || paths.length > 8) return reject("source_answer_path_count");
  if (new Set(paths).size !== paths.length) return reject("source_answer_path_duplicate");
  if (paths.some((path) => typeof path !== "string" || !isSafeSourcePath(path))) return reject("source_answer_path_unrecognized");
  const allowedPaths = new Set(allowedSourceAnswerPathsForAnswers(slot, answers));
  const disallowedPath = paths.find((path) => typeof path === "string" && !allowedPaths.has(path));
  if (typeof disallowedPath === "string" && isSafeSourcePath(disallowedPath)) return reject("source_answer_path_not_allowed_for_slot", disallowedPath);
  const evidenceSlot = providerSelection?.slot ?? slot as DesiredClientEvidenceSlot;
  if (!DESIRED_CLIENT_EVIDENCE_SLOTS.includes(evidenceSlot) ||
    providerSelection && !statementMatchesEvidenceGroups(evidenceSlot, value as unknown as EvidenceLinkedStatement, answers)) {
    return reject("evidence_group_selection_invalid");
  }
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
      paths.includes("value.payment_context") && paths.includes("value.payment_context_basis");
    const valueRangeObservation = value.evidence_basis === "firm_reported_observation" && slot === "why_firm_wants_work" && answers.focus.route === "established" && paths.length > 0 && paths.every(path => path === "value.collected_fee" || path === "value.team_hours");
    const capacityObservation = value.evidence_basis === "firm_reported_observation" && slot === "why_firm_wants_work" && paths.length > 0 && paths.every(path => path === "delivery.capacity" || path === "write_ins.capacity" || path === "repeatability.additional_matters");
    const valueRangeSource = paths.some(path => path === "value.collected_fee" || path === "value.team_hours");
    const capacitySource = paths.some(path => path === "delivery.capacity" || path === "write_ins.capacity" || path === "repeatability.additional_matters");
    const combinedValueAndCapacityObservation = value.evidence_basis === "firm_reported_observation" && slot === "why_firm_wants_work" && answers.focus.route === "established" && valueRangeSource && capacitySource && paths.every(path => path === "value.collected_fee" || path === "value.team_hours" || path === "delivery.capacity" || path === "write_ins.capacity" || path === "repeatability.additional_matters");
    const choice = paths.some(path => typeof path === "string" && path.startsWith("client.choice_"));
    const pathway = paths.some(path => typeof path === "string" && (path.startsWith("situation.") || ["client.goals","client.goal_detail","client.concerns","client.decision_needs","client.decision_context","client.pathway_basis"].includes(path)));
    if (!paymentObservation && !paymentContextSource && !valueRangeObservation && !capacityObservation && !combinedValueAndCapacityObservation && ((!choice && !pathway) || (choice && (!paths.includes("client.choice_basis") || answers.client.choice_basis !== expected)) || (pathway && (!paths.includes("client.pathway_basis") || answers.client.pathway_basis !== expected)))) return reject("client_reported_basis_mismatch");
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

function validCard(value: unknown, answers: DesiredClientAnswers, slot: string, reportFailure?: (reason: string, sourcePath?: SafeSourcePath, claimDiagnostic?: AnalysisClaimDiagnostic) => void): value is { claims: EvidenceLinkedStatement[] } {
  if (!record(value)) { reportFailure?.("card_not_object"); return false; }
  if (!exact(value, ["claims"])) { reportFailure?.("card_shape"); return false; }
  if (!Array.isArray(value.claims)) { reportFailure?.("claims_not_array"); return false; }
  if (value.claims.length < 1) { reportFailure?.("card_claims_empty"); return false; }
  const claimLimit = slot === "why_firm_wants_work" ? 7 : 6;
  if (value.claims.length > claimLimit) { reportFailure?.("card_claim_limit_exceeded"); return false; }
  return value.claims.every((claim, index) => validStatement(claim, answers, slot, (reason, sourcePath) =>
    reportFailure?.(reason, sourcePath, diagnosticForClaim(claim, index, answers, slot as DesiredClientEvidenceSlot))));
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

function authenticMixedProviderClaimText(value: unknown, paths: readonly AnswerReferencePath[], answers: DesiredClientAnswers): boolean {
  if (!record(value) || typeof value.text !== "string") return false;
  const text = value.text.trim().replace(/\s+/gu, " ");
  if (!text || text.length > 400 || wordCount(text) > 50 || BANNED.test(text) || paths.length < 1 || paths.length > 8) return false;
  const paymentPaths = paths.some(path => ["value.payment", "value.payment_context", "value.payment_context_basis"].includes(path));
  if (!citationSupportsNumericTokens(text, paths, answers) ||
    !mixedPaymentClaimLanguageIsGrounded(text, paths, answers) ||
    !claimNegationMatchesSources(text, paths, answers) ||
    (hasNegativeContribution(answers) && assertsPositiveEconomics(text)) ||
    (!paymentPaths && FALSE_AUDIT_ASSERTION.test(text))) return false;
  return !paymentPaths || paymentClaimIsAuthentic({ text, source_answer_ids: [...paths] }, answers);
}

/** Recover only a valid, current in-slot selection rejected solely for mixed basis/kind. */
function recoverMixedWhyFirmSelection(value: unknown, answers: DesiredClientAnswers): { value: unknown; recovered: boolean } {
  if (!record(value) || !record(value.brief)) return { value, recovered: false };
  const brief = value.brief;
  const card = brief.why_firm_wants_work;
  if (!exact(card, ["claims"]) || !Array.isArray(card.claims) || card.claims.length < 1 || card.claims.length > 7) return { value, recovered: false };

  const groups = buildDesiredClientEvidenceGroups("why_firm_wants_work", answers);
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const originalSources = new Set<AnswerReferencePath>();
  let foundMixedSelection = false;
  for (const claim of card.claims) {
    if (!record(claim) || !exact(claim, ["text", "kind", "source_answer_ids", "evidence_basis"])) return { value, recovered: false };
    const selection = getProviderEvidenceSelection(claim);
    if (!selection || selection.slot !== "why_firm_wants_work" || !selection.validShape || !Array.isArray(selection.rawGroupIds) ||
      selection.rawGroupIds.length < 1 || selection.rawGroupIds.length > 8 || selection.rawGroupIds.some(id => typeof id !== "string") ||
      new Set(selection.rawGroupIds).size !== selection.rawGroupIds.length) return { value, recovered: false };
    const selectedGroups = (selection.rawGroupIds as string[]).map(id => groupsById.get(id));
    if (selectedGroups.some(group => !group)) return { value, recovered: false };
    const resolvedGroups = selectedGroups as NonNullable<typeof selectedGroups[number]>[];
    const paths = resolvedGroups.flatMap(group => group.source_answer_ids);
    if (paths.length < 1 || paths.length > 8 || new Set(paths).size !== paths.length) return { value, recovered: false };
    const first = resolvedGroups[0];
    const mixed = resolvedGroups.some(group => group.evidence_basis !== first.evidence_basis || group.kind !== first.kind);
    if (mixed) {
      if (selection.valid || selection.failure !== "mixed_basis_or_kind" || !authenticMixedProviderClaimText(claim, paths, answers)) return { value, recovered: false };
      foundMixedSelection = true;
    } else {
      if (!selection.valid || selection.failure || !validStatement(claim, answers, "why_firm_wants_work")) return { value, recovered: false };
      const paymentPaths = paths.some(path => ["value.payment", "value.payment_context", "value.payment_context_basis"].includes(path));
      if (paymentPaths && !paymentClaimIsAuthentic(claim, answers)) return { value, recovered: false };
    }
    paths.forEach(path => originalSources.add(path));
  }
  if (!foundMixedSelection) return { value, recovered: false };

  const replacement = buildStructuredBlueprintV4(answers).why_firm_wants_work;
  if (!replacement.claims.length || replacement.claims.length > 7 || replacement.claims.some(claim => !claim.source_answer_ids.length || claim.source_answer_ids.length > 8)) return { value, recovered: false };
  const replacementSources = new Set(replacement.claims.flatMap(claim => claim.source_answer_ids));
  if ([...originalSources].some(path => !replacementSources.has(path))) return { value, recovered: false };

  return {
    value: { ...value, brief: { ...brief, why_firm_wants_work: replacement } },
    recovered: true,
  };
}

export function validateAnalysisResult(value: unknown, answers: DesiredClientAnswers, _eligibleCodes: readonly ClarificationCode[], reportFailure?: (failure: AnalysisValidationFailure) => void): AnalysisResult | null {
  const reject = (field: string, reason: string) => { reportFailure?.({ field, reason }); return null; };
  if (!exact(value, ["brief", "clarification_code"])) return reject("report", "root_shape");
  if (value.clarification_code !== null) return reject("report", "unexpected_clarification_code");
  const cardNames=["client_and_matter","client_goals_needs","why_firm_wants_work","why_client_chooses_firm","recognizable_circumstances","evidence_and_open_questions"] as const;
  const inputBrief=value.brief;
  if(!exact(inputBrief,["report_version","definition_sentence","definition_components",...cardNames,"decision_pathway"]))return reject("report", "brief_shape");
  const recovery = recoverMixedWhyFirmSelection(value, answers);
  const validatedValue = recovery.recovered ? recovery.value : value;
  const sourceBrief=(validatedValue as { brief: Record<string, unknown> }).brief;
  // Validate source claims before omission recovery. Payment claims may be
  // normalized for harmless wording or mixed-source separation, but their
  // evidence status and numeric content must still be authentic.
  const paymentPaths = new Set(["value.payment", "value.payment_context", "value.payment_context_basis"]);
  const sourceValueCard = sourceBrief.why_firm_wants_work;
  if (record(sourceValueCard) && Array.isArray(sourceValueCard.claims)) {
    for (const [claimIndex, claim] of sourceValueCard.claims.entries()) {
      const claimDiagnostic = diagnosticForClaim(claim, claimIndex, answers, "why_firm_wants_work");
      const hasPaymentSource = record(claim) && Array.isArray(claim.source_answer_ids) &&
        claim.source_answer_ids.some((path) => typeof path === "string" && paymentPaths.has(path));
      // Validate payment meaning, context trace and numeric authenticity before
      // allowing any repairable wording or source-separation path.
      if (hasPaymentSource && !paymentClaimIsAuthentic(claim, answers)) {
        reportFailure?.({ field: "why_firm_wants_work", reason: "claim_not_valid", claimDiagnostic });
        return reject("why_firm_wants_work", "claim_not_valid");
      }
      let failure: { reason: string; sourcePath?: SafeSourcePath } | undefined;
      if (validStatement(claim, answers, "why_firm_wants_work", (reason, sourcePath) => { failure = { reason, ...(sourcePath ? { sourcePath } : {}) }; })) continue;
      if (!hasPaymentSource || !record(claim) || !Array.isArray(claim.source_answer_ids)) {
        if (failure) {
          const { sourcePath, ...safeFailure } = failure;
          reportFailure?.({ field: "why_firm_wants_work", ...safeFailure,
            ...(sourcePath && isSafeDiagnosticSourcePath(sourcePath, answers) ? { sourcePath } : {}), claimDiagnostic });
        }
        return reject("why_firm_wants_work", "claim_not_valid");
      }
      const repairablePaymentWording = failure?.reason === "payment_source_must_be_isolated" || failure?.reason === "payment_context_claim_mismatch" || failure?.reason === "evidence_group_selection_invalid";
      const expectedPayment = paymentEvidenceClaim(answers);
      const expectedContext = paymentContextEvidenceClaim(answers);
      const paymentStatusMatches = !claim.source_answer_ids.includes("value.payment") ||
        (!!expectedPayment && claim.kind === expectedPayment.kind && claim.evidence_basis === expectedPayment.evidence_basis);
      const contextStatusMatches = !claim.source_answer_ids.some((path) => path === "value.payment_context" || path === "value.payment_context_basis") ||
        (!!expectedContext && claim.kind === expectedContext.kind && claim.evidence_basis === expectedContext.evidence_basis);
      if (!repairablePaymentWording || !paymentStatusMatches || !contextStatusMatches) {
        if (failure) {
          const { sourcePath, ...safeFailure } = failure;
          reportFailure?.({ field: "why_firm_wants_work", ...safeFailure,
            ...(sourcePath && isSafeDiagnosticSourcePath(sourcePath, answers) ? { sourcePath } : {}), claimDiagnostic });
        }
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
  for (const [field, slot] of definitionParts) if (!checkDefinitionPart(components[field],answers,slot,(reason,sourcePath)=>reportFailure?.({field:`definition_components.${field}`,reason,...(sourcePath?{sourcePath}:{}),claimDiagnostic:diagnosticForClaim(components[field],0,answers,slot)}))) return null;
  if (record(brief.client_and_matter) && exact(brief.client_and_matter, ["provider_target_selection_invalid"]) && brief.client_and_matter.provider_target_selection_invalid === true) {
    return reject("client_and_matter", "target_card_not_grounded_in_confirmed_answers");
  }
  for(const field of cardNames)if(!validCard(brief[field],answers,field,(reason,sourcePath,claimDiagnostic)=>reportFailure?.({field,reason,...(sourcePath?{sourcePath}:{}),...(claimDiagnostic?{claimDiagnostic}:{})})))return null;
  const pathway=brief.decision_pathway;
  if(!exact(pathway,["trigger","first_contact","decision","desired_progress"]))return reject("decision_pathway", "pathway_shape");
  const pathwayFields=["trigger","first_contact","decision","desired_progress"] as const;
  for(const field of pathwayFields)if(!validStatement(pathway[field],answers,`decision_pathway.${field}`,(reason,sourcePath)=>reportFailure?.({field:`decision_pathway.${field}`,reason,...(sourcePath?{sourcePath}:{}),claimDiagnostic:diagnosticForClaim(pathway[field],0,answers,`decision_pathway.${field}`)})))return null;
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
  return {
    clarification_code: null,
    brief: { ...canonicalBrief, definition_sentence: expectedSentence },
    ...(recovery.recovered ? { recoveredSections: ["why_firm_wants_work"] } : {}),
  };
}

/** Validate an application response, which may carry recovery metadata created after model validation.
 * Model output continues to go through validateAnalysisResult's strict two-key root contract. */
export function validateAnalysisResponseResult(value: unknown, answers: DesiredClientAnswers, eligibleCodes: readonly ClarificationCode[], reportFailure?: (failure: AnalysisValidationFailure) => void): AnalysisResult | null {
  if (!record(value) || !Object.hasOwn(value, "recoveredSections")) {
    return validateAnalysisResult(value, answers, eligibleCodes, reportFailure);
  }
  const reject = (reason: string) => { reportFailure?.({ field: "report", reason }); return null; };
  if (!exact(value, ["brief", "clarification_code", "recoveredSections"])) return reject("root_shape");
  const recovery = value.recoveredSections;
  if (!Array.isArray(recovery) || recovery.length !== 1 || recovery[0] !== "why_firm_wants_work") {
    return reject("recovery_metadata_invalid");
  }

  const validated = validateAnalysisResult({ brief: value.brief, clarification_code: value.clarification_code }, answers, eligibleCodes, reportFailure);
  if (!validated) return null;
  const deterministicCard = buildStructuredBlueprintV4(answers).why_firm_wants_work;
  if (JSON.stringify(validated.brief.why_firm_wants_work) !== JSON.stringify(deterministicCard)) {
    return reject("recovery_metadata_not_grounded");
  }
  return { ...validated, recoveredSections: ["why_firm_wants_work"] };
}

const LINKED_STATEMENT_SCHEMA = { type: "object", properties: { text: { type: "string" }, evidence_group_ids: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } } }, required: ["text", "evidence_group_ids"] } as const;
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
