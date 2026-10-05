import { CONTACT_ROLE_IDS, AREA_CATALOG, WRITE_IN_KEYS, isKnownArea, isKnownTrigger, isKnownWork } from "./catalog";
import { INTERVIEW_CLARIFICATION_LIMITS } from "./interview-clarification-contract";
import type {
  AnalysisRequestEnvelope,
  AreaId,
  ClarificationAnswer,
  ClarificationCode,
  ComparisonCandidate,
  DesiredClientAnswers,
  GoalId,
  WorkComparison,
} from "./types";

const ANSWER_KEYS = ["schema_version", "revision", "interview", "focus", "practice", "client_context", "situation", "client", "value", "delivery", "direction", "opportunity", "repeatability", "clarifications"] as const;
const CLARIFICATION_CODES: readonly ClarificationCode[] = [
  "CLIENT_MATTER_UNCLEAR", "VALUE_EFFORT_CONFLICT", "CAPACITY_CONFLICT", "REPEATABILITY_UNPROVEN", "OPPORTUNITY_UNSUPPORTED",
];
const LEGACY_CLARIFICATION_CODES = ["FOCUS_UNCLEAR", "CLIENT_GOAL_UNCLEAR", "CURRENT_CAPACITY_CONFLICT", "FEE_EFFORT_CONFLICT", "EXPERIENCE_DIRECTION_CONFLICT"] as const;
const GOALS: readonly GoalId[] = ["understand", "complete", "resolve", "protect", "prepare", "respond", "unknown"];
const CONTACT_ROLE_SET: ReadonlySet<string> = new Set(CONTACT_ROLE_IDS);
const TEXT_MAX = 180;

const ENUMS = {
  route: ["established", "new", "exploring"],
  timing: ["planning", "emerging", "underway", "deadline", "varies", "unknown"],
  contact: ["owner", "manager", "adviser", "other", "unknown"],
  goals: GOALS,
  concerns: ["next", "cost", "consequences", "time", "worse", "unheard"],
  triggers: ["unknown"],
  decisionNeeds: ["scope_cost", "options", "relevant_experience", "process", "response", "heard", "unknown"],
  fitSignals: ["service", "stage", "information", "decision", "scope", "fees", "timing", "unknown"],
  reasons: ["client_benefit", "fees", "skills", "enjoyment", "repeatable", "further", "direction", "undecided"],
  feeEffort: ["worthwhile", "scoped", "difficult", "unknown"],
  collectedFee: ["under2", "2to5", "5to15", "15to50", "50plus", "unknown", "private"],
  teamHours: ["upto5", "6to15", "16to40", "41to100", "over100", "unknown"],
  payment: ["predictable", "varies", "uncertain", "unknown"],
  conditions: ["time", "scope", "information", "decision", "communication", "support", "unknown"],
  capacity: ["room", "limited", "change", "unknown"],
  limit: ["time", "scope", "support", "communication", "fees", "none"],
  aim: ["more_current", "narrower", "new_area", "new_model", "unknown"],
  evidence: ["repeated", "few", "feedback", "records", "team", "preference"],
  less: ["within", "outside", "model", "none"],
  candidateTeam: ["proven", "stretch", "unknown"],
  candidateEvidence: ["repeated", "few", "none"],
  practiceDirection: ["grow_proven", "narrow_specialty", "explore_direction", "improve_delivery", "other", "unknown"],
  practiceExperience: ["regular", "occasional", "adjacent", "new", "unknown"],
  developmentNeeds: ["expertise", "support", "process", "capacity", "unknown"],
  lessWorkReason: ["preference", "capacity", "effort", "financial", "model", "unknown"],
  opportunitySources: ["comparable_enquiries", "retained_matters", "professional_referrals", "repeat_clients", "website_search", "other_source", "no_evidence", "unknown"],
  successMeasure: ["retained_matters", "contribution_effort", "predictable_delivery", "practice_mix_reputation", "other", "unknown"],
  clientChoicePriority: ["relevant_experience", "clear_options", "clear_fees", "communication", "availability", "approach", "language", "community", "other", "unknown"],
  firmStrength: ["matter_experience", "specialist_knowledge", "clear_advice", "practical_approach", "responsive_service", "language_or_community", "other", "unknown"],
} as const;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is RecordValue {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isEnum(value: unknown, choices: readonly string[], nullable = false): boolean {
  return (nullable && value === null) || (typeof value === "string" && choices.includes(value));
}

function isOptionalText(value: unknown): value is string {
  return isBoundedMultilineText(value, TEXT_MAX);
}
export function isBoundedMultilineText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value) && value.split(/\r\n|\r|\n/).length <= INTERVIEW_CLARIFICATION_LIMITS.answerLines;
}
function isTextLimit(value:unknown,max:number):value is string{return isBoundedMultilineText(value,max);}

function isUniqueChoiceArray(value: unknown, choices: readonly string[], max: number, min = 0): value is string[] {
  return Array.isArray(value) && value.length >= min && value.length <= max &&
    value.every((item) => typeof item === "string" && choices.includes(item)) && new Set(value).size === value.length;
}

function exclusive(value: readonly string[], exclusiveId: string): boolean {
  return !value.includes(exclusiveId) || value.length === 1;
}

function validCandidate(value: unknown, area: AreaId): value is ComparisonCandidate {
  if (!hasExactKeys(value, ["work", "fee_effort", "team_fit", "capacity", "evidence"])) return false;
  return isKnownWork(area, value.work) && isEnum(value.fee_effort, ENUMS.feeEffort) &&
    isEnum(value.team_fit, ENUMS.candidateTeam) && isEnum(value.capacity, ENUMS.capacity) &&
    isEnum(value.evidence, ENUMS.candidateEvidence);
}

function validClarificationAnswer(code: ClarificationCode, answer: unknown): answer is ClarificationAnswer {
  if (typeof answer === "string" && answer.trim().length > 0 && answer.length <= INTERVIEW_CLARIFICATION_LIMITS.answerCharacters && !/[\r\n]/.test(answer)) return true;
  switch (code) {
    case "CLIENT_MATTER_UNCLEAR": return answer === "choose_specific" || answer === "keep_broad";
    case "VALUE_EFFORT_CONFLICT": return answer === "improve_model" || answer === "reconsider_work";
    case "CAPACITY_CONFLICT": return answer === "limited_now" || answer === "build_first";
    case "REPEATABILITY_UNPROVEN": return answer === "current_evidence" || answer === "future_direction";
    case "OPPORTUNITY_UNSUPPORTED": return answer === "current_evidence" || answer === "future_direction";
  }
}

function validateLegacyV22Answers(value: unknown, answerRevision: number, requireComplete = false): boolean {
  const legacyKeys = ["schema_version", "revision", "focus", "situation", "client", "value", "delivery", "direction", "clarifications"] as const;
  if (!hasExactKeys(value, legacyKeys) && !hasExactKeys(value, [...legacyKeys, "write_ins"])) return false;
  const answers = value;
  if (answers.schema_version !== "dcm-v2.2" || answers.revision !== answerRevision ||
      !Number.isSafeInteger(answers.revision) || answers.revision < 0) return false;
  const writeIns = answers.write_ins;
  if (writeIns !== undefined) {
    if (!isRecord(writeIns)) return false;
    if (Object.keys(writeIns).some((key) => !WRITE_IN_KEYS.includes(key as typeof WRITE_IN_KEYS[number]) || !isOptionalText(writeIns[key]))) return false;
  }
  const own = (key: typeof WRITE_IN_KEYS[number]) => isRecord(writeIns) && typeof writeIns[key] === "string" && (writeIns[key] as string).trim().length > 0;

  if (!hasExactKeys(answers.focus, ["area", "work", "work_other", "service_area", "certainty", "route", "comparison"])) return false;
  const focus = answers.focus;
  if (!(focus.area === null || isKnownArea(focus.area)) || !isOptionalText(focus.work_other) ||
      !isOptionalText(focus.service_area) || !isEnum(focus.certainty, ["chosen", "provisional"], true) ||
      !isEnum(focus.route, ENUMS.route, true)) return false;
  if (focus.work !== null && focus.work !== "other" && (!focus.area || !isKnownWork(focus.area, focus.work))) return false;
  if (focus.work === "other" && !focus.area) return false;
  if (focus.work !== "other" && focus.work_other.trim() !== "") return false;
  if (focus.work === null && (focus.certainty !== null || focus.comparison !== null)) return false;
  if (focus.work === null && !focus.area && (focus.route !== null || focus.service_area.trim() !== "")) return false;
  if (focus.work !== null && focus.certainty === null) return false;
  if (focus.work === null && focus.certainty !== null) return false;
  if (focus.certainty === "provisional" && !focus.comparison) return false;
  if (requireComplete && focus.route !== null && focus.work === null) return false;
  if (focus.comparison !== null) {
    if (!focus.area || !hasExactKeys(focus.comparison, ["a", "b", "selected"])) return false;
    const comparison = focus.comparison as unknown as WorkComparison;
    if (!validCandidate(comparison.a, focus.area) || !validCandidate(comparison.b, focus.area) ||
        comparison.a.work === comparison.b.work || !["a", "b"].includes(comparison.selected)) return false;
    const selected = comparison[comparison.selected];
    if (focus.work !== selected.work || (focus.certainty !== "chosen" && focus.certainty !== "provisional")) return false;
  }

  if (!hasExactKeys(answers.situation, ["trigger", "timing", "role", "role_other", "contact"])) return false;
  const situation = answers.situation;
  if (!(situation.trigger === null || situation.trigger === "unknown" || (!!focus.area && isKnownTrigger(focus.area, situation.trigger))) ||
      !isEnum(situation.timing, ENUMS.timing, true) || !isOptionalText(situation.role_other) ||
      !isEnum(situation.contact, ENUMS.contact, true) ||
      (situation.trigger !== null && situation.trigger !== "unknown" && own("trigger")) || (situation.trigger === "unknown" && own("trigger"))) return false;
  if (situation.role !== null && !focus.area) return false;
  if (situation.role !== null && situation.role !== "other" && situation.role !== "unknown" &&
      (!focus.area || typeof situation.role !== "string" || !Object.hasOwn(AREA_CATALOG[focus.area].roles, situation.role))) return false;
  if (situation.role === null && (situation.role_other.trim() !== "" || situation.contact !== null)) return false;
  if (situation.role !== "other" && situation.role_other.trim() !== "") return false;
  if (!CONTACT_ROLE_SET.has(String(situation.role)) && situation.contact !== null) return false;

  if (!hasExactKeys(answers.client, ["goals", "concerns", "decision_needs"]) ||
      !isUniqueChoiceArray(answers.client.goals, ENUMS.goals, 2) || !exclusive(answers.client.goals, "unknown") ||
      !isUniqueChoiceArray(answers.client.concerns, ENUMS.concerns, 2) || !exclusive(answers.client.concerns, "unheard") ||
      !isUniqueChoiceArray(answers.client.decision_needs, ENUMS.decisionNeeds, 2) || !exclusive(answers.client.decision_needs, "unknown") ||
      answers.client.decision_needs.length + Number(own("decision_needs")) > 2 ||
      (answers.client.decision_needs.includes("unknown") && own("decision_needs"))) return false;

  if (!hasExactKeys(answers.value, ["reasons", "fee_effort", "collected_fee", "team_hours", "payment"])) return false;
  const valueGroup = answers.value;
  if (!isUniqueChoiceArray(valueGroup.reasons, ENUMS.reasons, 3) || (requireComplete && valueGroup.reasons.length === 0 && !own("reasons")) ||
      !exclusive(valueGroup.reasons, "undecided") || !isEnum(valueGroup.fee_effort, ENUMS.feeEffort, true) ||
      !isEnum(valueGroup.collected_fee, ENUMS.collectedFee, true) || !isEnum(valueGroup.team_hours, ENUMS.teamHours, true) ||
      !isEnum(valueGroup.payment, ENUMS.payment, true)) return false;

  if (!hasExactKeys(answers.delivery, ["conditions", "capacity", "limit", "fit_signals"])) return false;
  const delivery = answers.delivery;
  if (!isUniqueChoiceArray(delivery.conditions, ENUMS.conditions, 3) || !exclusive(delivery.conditions, "unknown") ||
      !isEnum(delivery.capacity, ENUMS.capacity, true) || !isEnum(delivery.limit, ENUMS.limit, true) ||
      !isUniqueChoiceArray(delivery.fit_signals, ENUMS.fitSignals, 3) || !exclusive(delivery.fit_signals, "unknown") ||
      delivery.fit_signals.length + Number(own("fit_signals")) > 3 ||
      (delivery.fit_signals.includes("unknown") && own("fit_signals"))) return false;

  if (!hasExactKeys(answers.direction, ["aim", "evidence", "less", "less_note"])) return false;
  const direction = answers.direction;
  if (!isEnum(direction.aim, ENUMS.aim, true) || !isUniqueChoiceArray(direction.evidence, ENUMS.evidence, 6) ||
      !exclusive(direction.evidence, "preference") ||
      (direction.evidence.includes("repeated") && direction.evidence.includes("few")) ||
      !isEnum(direction.less, ENUMS.less, true) || !isOptionalText(direction.less_note)) return false;
  if (direction.less_note.trim() !== "" && !["within", "outside", "model"].includes(String(direction.less))) return false;

  if (!hasExactKeys(answers.clarifications, LEGACY_CLARIFICATION_CODES)) return false;
  for (const code of LEGACY_CLARIFICATION_CODES) {
    const answer = answers.clarifications[code];
    if (answer !== null && !validLegacyClarificationAnswer(code, answer)) return false;
  }
  // Clarification answers carry their required canonical updates into the next
  // same-run snapshot, so the submitted history and current fields cannot drift.
  if (answers.clarifications.CLIENT_GOAL_UNCLEAR !== null &&
      (answers.client.goals.length !== 1 || answers.client.goals[0] !== answers.clarifications.CLIENT_GOAL_UNCLEAR)) return false;
  if (answers.clarifications.CURRENT_CAPACITY_CONFLICT === "limited_now" && delivery.capacity !== "limited") return false;
  if (answers.clarifications.CURRENT_CAPACITY_CONFLICT === "build_first" && delivery.capacity !== "change") return false;
  if (answers.clarifications.EXPERIENCE_DIRECTION_CONFLICT === "current_evidence" && focus.route !== "established") return false;
  if (answers.clarifications.EXPERIENCE_DIRECTION_CONFLICT === "future_direction" && direction.aim !== "new_area") return false;

  if (!requireComplete) return true;
  // Review cannot be prepared until every required stage choice is present.
  return !!focus.area && focus.work !== null && focus.route !== null &&
    (situation.trigger !== null || own("trigger")) && (situation.timing !== null || own("timing")) &&
    situation.role !== null && (answers.client.goals.length > 0 || own("goals")) && (valueGroup.fee_effort !== null || own("fee_effort")) &&
    (delivery.capacity !== null || own("capacity")) && (delivery.fit_signals.length > 0 || own("fit_signals")) &&
    (direction.aim !== null || own("aim")) && (direction.evidence.length > 0 || own("evidence"));
}

function validLegacyClarificationAnswer(code: typeof LEGACY_CLARIFICATION_CODES[number], answer: unknown): boolean {
  switch (code) {
    case "FOCUS_UNCLEAR": return answer === "keep_broad";
    case "CLIENT_GOAL_UNCLEAR": return typeof answer === "string" && GOALS.includes(answer as GoalId) && answer !== "unknown";
    case "CURRENT_CAPACITY_CONFLICT": return answer === "limited_now" || answer === "build_first";
    case "FEE_EFFORT_CONFLICT": return answer === "improve_model" || answer === "reconsider_work";
    case "EXPERIENCE_DIRECTION_CONFLICT": return answer === "current_evidence" || answer === "future_direction";
  }
}

function validateAnswers(value: unknown, answerRevision: number, requireComplete: boolean, version: "dcm-v3.0" | "dcm-v3.1" | "dcm-v3.2" | "dcm-v3.3" = "dcm-v3.3"): value is DesiredClientAnswers {
  const hasInterview = version === "dcm-v3.2" || version === "dcm-v3.3";
  const answerKeys = hasInterview ? ANSWER_KEYS : ANSWER_KEYS.filter((key) => key !== "interview");
  if (!hasExactKeys(value, answerKeys) && !hasExactKeys(value, [...answerKeys, "write_ins"])) return false;
  const a = value as RecordValue;
  if (a.schema_version !== version || a.revision !== answerRevision || !Number.isSafeInteger(a.revision) || a.revision < 0) return false;
  const wi = a.write_ins;
  if (wi !== undefined && (!isRecord(wi) || Object.keys(wi).some(k => !WRITE_IN_KEYS.includes(k as typeof WRITE_IN_KEYS[number]) || !isOptionalText(wi[k])))) return false;
  const own = (key: typeof WRITE_IN_KEYS[number]) => isRecord(wi) && typeof wi[key] === "string" && (wi[key] as string).trim().length > 0;
  const exactGroup = (name: string, keys: string[]) => hasExactKeys(a[name], keys);

  if (!exactGroup("focus", ["area", "work", "work_other", "service_area", "certainty", "route", "comparison"]) ||
    !exactGroup("practice", version === "dcm-v3.0" ? ["direction", "firm_type", "capability", "enjoys"] : hasInterview ? ["direction", "firm_type", "capability", "enjoys", "experience", "development_needs", "client_strength", "client_strength_effect", "client_strength_support"] : ["direction", "firm_type", "capability", "enjoys", "experience", "development_needs"]) ||
    !exactGroup("client_context", hasInterview ? ["geography", "relevant_circumstances", "community_focus", "language_service_needs", "repeat_matter_pattern", "discovery_behaviour"] : ["geography", "relevant_circumstances", "community_focus", "language_service_needs", "repeat_matter_pattern"]) ||
    !exactGroup("situation", ["trigger", "timing", "role", "role_other", "contact"]) ||
    !exactGroup("client", hasInterview ? ["goals", "goal_detail", "concerns", "decision_needs", "decision_context", "pathway_basis", "choice_priorities", "choice_detail", "choice_basis"] : ["goals", "concerns", "decision_needs"]) ||
    !exactGroup("value", version === "dcm-v3.3" ? ["reasons", "fee_effort", "collected_fee", "team_hours", "payment", "payment_context", "payment_context_basis", "currency", "fee_amount", "direct_cost_amount", "amount_basis", "amount_scope"] : ["reasons", "fee_effort", "collected_fee", "team_hours", "payment", "currency", "fee_amount", "direct_cost_amount", "amount_basis", "amount_scope"]) ||
    !exactGroup("delivery", ["conditions", "capacity", "limit", "fit_signals"]) ||
    !exactGroup("direction", version === "dcm-v3.0" ? ["aim", "evidence", "less", "less_note"] : ["aim", "evidence", "less", "less_reason", "less_note"]) ||
    !exactGroup("opportunity", ["sources", "data_basis", "source_detail", "period", "enquiry_count", "retained_count", "conversion", "acquisition_cost", "uncertainty"]) ||
    !exactGroup("repeatability", ["success_measure", "success_other", "target", "review_period", "additional_matters", "staffing_constraint"]) ||
    !hasExactKeys(a.clarifications, CLARIFICATION_CODES)) return false;

  const focus = a.focus as RecordValue;
  const practice = a.practice as RecordValue;
  const clientContext = a.client_context as RecordValue;
  const situation = a.situation as RecordValue;
  const client = a.client as RecordValue;
  const valueGroup = a.value as RecordValue;
  const delivery = a.delivery as RecordValue;
  const direction = a.direction as RecordValue;
  const opportunity = a.opportunity as RecordValue;
  const repeatability = a.repeatability as RecordValue;
  const clarifications = a.clarifications as RecordValue;
  const interview = hasInterview ? a.interview as RecordValue : null;
  if (hasInterview) {
    if (!hasExactKeys(interview, ["ai_clarification_consent", "clarification_count", "clarified_stages", "followups"]) || typeof interview.ai_clarification_consent !== "boolean" ||
      !Number.isSafeInteger(interview.clarification_count) || (interview.clarification_count as number) < 0 || (interview.clarification_count as number) > 3 ||
      !Array.isArray(interview.clarified_stages) || interview.clarified_stages.length !== interview.clarification_count || interview.clarified_stages.some((stage) => ![1,2,3,4,5,6].includes(stage as number)) || new Set(interview.clarified_stages).size !== interview.clarified_stages.length ||
      !Array.isArray(interview.followups) || interview.followups.length > INTERVIEW_CLARIFICATION_LIMITS.maximumFollowups || interview.followups.some((item) => !isRecord(item) || ![
        ["id", "stage", "purpose", "source_answer_ids", "question", "answer", "skipped"],
        ["id", "stage", "purpose", "source_answer_ids", "question", "answer", "choiceId", "skipped"],
        ["id", "stage", "purpose", "source_answer_ids", "question", "answer", "skipped", "reflection"],
        ["id", "stage", "purpose", "source_answer_ids", "question", "answer", "choiceId", "skipped", "reflection"],
      ].some((keys) => hasExactKeys(item,keys)||hasExactKeys(item,[...keys,"source_answer_fingerprint"])) ||
        typeof item.id !== "string" || item.id.length > 64 || !/^[a-z0-9_-]+$/i.test(item.id) || ![1,2,3,4,5,6].includes(item.stage as number) ||
        !["client_matter_specificity","client_goal_detail","firm_desirability","client_choice_criteria","strength_and_support","decision_pathway_observation","discovery_evidence","economics_effort_conflict","capacity_conflict"].includes(String(item.purpose)) ||
        !Array.isArray(item.source_answer_ids) || item.source_answer_ids.length < 1 || item.source_answer_ids.length > 8 || item.source_answer_ids.some((path) => typeof path !== "string") ||
        typeof item.question !== "string" || item.question.length < 1 || item.question.length > INTERVIEW_CLARIFICATION_LIMITS.questionCharacters || /[\r\n]/.test(item.question) || !isBoundedMultilineText(item.answer,INTERVIEW_CLARIFICATION_LIMITS.answerCharacters) ||
        item.source_answer_fingerprint !== undefined && (typeof item.source_answer_fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(item.source_answer_fingerprint)) ||
        typeof item.skipped !== "boolean" || item.skipped && item.answer !== "" || !item.skipped && item.answer.trim().length === 0 || item.choiceId !== undefined && (typeof item.choiceId !== "string" || item.choiceId.length > 48 || !/^[a-z0-9_-]+$/i.test(item.choiceId)) || item.reflection !== undefined && (typeof item.reflection !== "string" || item.reflection.length > INTERVIEW_CLARIFICATION_LIMITS.reflectionCharacters || item.reflection.trim().split(/\s+/).filter(Boolean).length > INTERVIEW_CLARIFICATION_LIMITS.reflectionWords)) ||
      (interview.followups as RecordValue[]).some((item, index, all) => all.findIndex((other) => other.id === item.id) !== index || all.findIndex((other) => other.stage === item.stage) !== index || !(interview.clarified_stages as unknown[]).includes(item.stage))) return false;
  }

  const textLimits: Record<string, number> = {"practice.firm_type":180,"practice.capability":180,"practice.enjoys":600,
    "client_context.geography":240,"client_context.relevant_circumstances":600,"client_context.community_focus":300,
    "client_context.language_service_needs":300,"client_context.repeat_matter_pattern":600,"value.currency":12,
    "value.fee_amount":80,"value.direct_cost_amount":80,"opportunity.source_detail":400,"opportunity.period":120,
    "opportunity.enquiry_count":80,"opportunity.retained_count":80,"opportunity.conversion":80,"opportunity.acquisition_cost":80,
    "opportunity.uncertainty":400,"repeatability.success_other":240,"repeatability.target":160,"repeatability.review_period":120,
    "repeatability.additional_matters":120,"repeatability.staffing_constraint":300};
  if (hasInterview) Object.assign(textLimits, {"practice.client_strength_effect":240,"practice.client_strength_support":240,"client_context.discovery_behaviour":360,"client.goal_detail":240,"client.decision_context":240,"client.choice_detail":180});
  if (version === "dcm-v3.3") textLimits["value.payment_context"] = 400;
  for (const [field, max] of Object.entries(textLimits)) {
    const [group, key] = field.split("."); const val = ({ practice, client_context: clientContext, client, value: valueGroup, opportunity, repeatability } as Record<string, RecordValue>)[group][key];
    if (!isBoundedMultilineText(val, max)) return false;
  }
  if (requireComplete && (!String(clientContext.repeat_matter_pattern).trim() || (!String(client.goal_detail).trim() && !(client.goals as GoalId[]).includes("unknown")))) return false;
  if (version === "dcm-v3.3") {
    if (!isEnum(valueGroup.payment_context_basis, ["client_feedback", "firm_observation", "firm_hypothesis", "unknown"], true) ||
      (!String(valueGroup.payment_context).trim() && valueGroup.payment_context_basis !== null)) return false;
  }
  if (hasInterview) {
    const goals = a.client as RecordValue;
    if (!isTextLimit(goals.goal_detail,240) || !isTextLimit(goals.decision_context,240) || !isTextLimit(goals.choice_detail,180) ||
      !isEnum(goals.pathway_basis,["client_feedback","firm_observation","firm_hypothesis","unknown"],true) || !isEnum(goals.choice_basis,["client_feedback","firm_observation","firm_hypothesis","unknown"],true) ||
      !isUniqueChoiceArray(goals.choice_priorities, ENUMS.clientChoicePriority, 2) || !exclusive(goals.choice_priorities, "unknown") ||
      !isEnum(practice.client_strength, ENUMS.firmStrength, true) ||
      (goals.choice_priorities as string[]).includes("other") !== Boolean(String(goals.choice_detail).trim()) ||
      (practice.client_strength === "unknown" && (String(practice.client_strength_effect).trim() || String(practice.client_strength_support).trim()))) return false;
  }
  if (!isEnum(practice.direction, ENUMS.practiceDirection, true) || ((version === "dcm-v3.1" || hasInterview) && (!isEnum(practice.experience, ENUMS.practiceExperience, true) || !isUniqueChoiceArray(practice.development_needs, ENUMS.developmentNeeds, 2) || !exclusive(practice.development_needs, "unknown") ||
      (practice.experience !== "adjacent" && practice.experience !== "new" && (practice.development_needs as unknown[]).length > 0) ||
      !isEnum(direction.less_reason, ENUMS.lessWorkReason, true) || (direction.less === null || direction.less === "none") && direction.less_reason !== null ||
      (practice.experience === "regular" && focus.route !== "established") || (practice.experience === "occasional" && focus.route !== "established") ||
      (practice.experience === "adjacent" && focus.route !== "exploring") || (practice.experience === "new" && focus.route !== "new") || (practice.experience === "unknown" && focus.route !== "exploring"))) || !isEnum(valueGroup.amount_basis, ["recorded","estimated","unknown"], true) ||
    !isEnum(opportunity.data_basis, ["recorded","estimated","unknown"], true) ||
    !isEnum(valueGroup.amount_scope, ["per_matter","range","other"], true) || !isEnum(repeatability.success_measure, ENUMS.successMeasure, true)) return false;
  if (!isUniqueChoiceArray(opportunity.sources, ENUMS.opportunitySources, 8) || !exclusive(opportunity.sources,"unknown") || !exclusive(opportunity.sources,"no_evidence")) return false;
  if (repeatability.success_measure !== "other" && (repeatability.success_other as string).trim()) return false;
  if (Object.values(clarifications).some((answer, i) => answer !== null && !validClarificationAnswer(CLARIFICATION_CODES[i], answer))) return false;

  const legacyProjection = {
    schema_version: "dcm-v2.2", revision: a.revision, ...(wi ? {write_ins:wi} : {}), focus:{...focus,certainty:focus.certainty === "provisional" && !focus.comparison ? "chosen" : focus.certainty},
    situation, client,
    value:{reasons:valueGroup.reasons,fee_effort:valueGroup.fee_effort,collected_fee:valueGroup.collected_fee,team_hours:valueGroup.team_hours,payment:valueGroup.payment},
    delivery,direction: version === "dcm-v3.0" ? direction : { aim: direction.aim, evidence: direction.evidence, less: direction.less, less_note: direction.less_note },
    clarifications:{FOCUS_UNCLEAR:null,CLIENT_GOAL_UNCLEAR:null,CURRENT_CAPACITY_CONFLICT:null,FEE_EFFORT_CONFLICT:null,EXPERIENCE_DIRECTION_CONFLICT:null},
  };
  const legacyClient = { goals: client.goals, concerns: client.concerns, decision_needs: client.decision_needs };
  if (!validateLegacyV22Answers({ ...legacyProjection, client: legacyClient }, answerRevision, false)) return false;
  if (!requireComplete) return true;
  if (version === "dcm-v3.0") return !!focus.area && focus.work !== null && focus.route !== null && practice.direction !== null &&
    situation.trigger !== null && situation.timing !== null && situation.role !== null && (valueGroup.reasons as unknown[]).length > 0 &&
    delivery.capacity !== null && (delivery.fit_signals as unknown[]).length > 0 && (opportunity.sources as unknown[]).length > 0 && repeatability.success_measure !== null;
  return !!focus.area && focus.work !== null && practice.experience !== null && practice.direction !== null &&
    (practice.direction !== "other" || own("aim")) &&
    (situation.trigger !== null || own("trigger")) && situation.timing !== null && situation.role !== null && (client.goals as unknown[]).length > 0 &&
    ((valueGroup.reasons as unknown[]).length > 0 || own("reasons")) && valueGroup.fee_effort !== null &&
    (client.choice_priorities as unknown[]).length > 0 && practice.client_strength !== null &&
    ((delivery.fit_signals as unknown[]).length > 0 || own("fit_signals")) && (opportunity.sources as unknown[]).length > 0;
}

export function validateLegacyV22DraftAnswers(value: unknown): boolean {
  return isRecord(value) && value.schema_version === "dcm-v2.2" && validateLegacyV22Answers(value, value.revision as number, false);
}

export function validateLegacyV30DraftAnswers(value: unknown): boolean {
  if (!isRecord(value) || value.schema_version !== "dcm-v3.0" || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false;
  return validateAnswers(value, value.revision as number, false, "dcm-v3.0");
}

export function validateLegacyV31DraftAnswers(value: unknown): boolean {
  if (!isRecord(value) || value.schema_version !== "dcm-v3.1" || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false;
  return validateAnswers(value, value.revision as number, false, "dcm-v3.1");
}

/** Strictly validates the exact v3.2 answer shape before adding the optional payment-context defaults. */
export function validateLegacyV32DraftAnswers(value: unknown): boolean {
  if (!isRecord(value) || value.schema_version !== "dcm-v3.2" || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false;
  return validateAnswers(value, value.revision as number, false, "dcm-v3.2");
}

/** Validates an incomplete saved draft without rejecting a normal mid-edit state. */
export function validateDraftAnswers(value: unknown): value is DesiredClientAnswers {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false;
  return validateAnswers(value, value.revision as number, false);
}

export type AnalysisRequestValidation =
  | { valid: true; value: AnalysisRequestEnvelope }
  | { valid: false; reason: string };

export function validateAnalysisRequest(input: unknown): AnalysisRequestValidation {
  const legacyKeys = ["schemaVersion", "requestId", "answerRevision", "reviewRunId", "analysisIndex", "aiConsent", "answers", "clarifications"];
  const currentKeys = ["schemaVersion", "operation", "requestId", "answerRevision", "reviewRunId", "analysisIndex", "aiConsent", "answers", "clarifications"];
  const legacy = hasExactKeys(input, legacyKeys) && input.schemaVersion === 3;
  const current = hasExactKeys(input, currentKeys) && input.schemaVersion === 4 && input.operation === "generate";
  if (!legacy && !current) return { valid: false, reason: "invalid envelope keys" };
  if (input.aiConsent !== true || !Number.isSafeInteger(input.answerRevision) ||
      (input.answerRevision as number) < 0 || ![0, 1, 2].includes(input.analysisIndex as number)) {
    return { valid: false, reason: "invalid envelope values" };
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof input.requestId !== "string" || input.requestId.length > 64 || !uuid.test(input.requestId) ||
      typeof input.reviewRunId !== "string" || input.reviewRunId.length > 64 || !uuid.test(input.reviewRunId)) {
    return { valid: false, reason: "invalid request identifiers" };
  }
  if (!validateAnswers(input.answers, input.answerRevision as number, true)) return { valid: false, reason: "invalid answers" };
  const answers = input.answers as DesiredClientAnswers;
  const clarificationHistory = input.clarifications as AnalysisRequestEnvelope["clarifications"];
  if (!Array.isArray(input.clarifications) || input.clarifications.length > 2) return { valid: false, reason: "invalid clarification history" };
  const seen = new Set<string>();
  for (const item of input.clarifications) {
    if (!hasExactKeys(item, ["code", "answer"]) || !CLARIFICATION_CODES.includes(item.code as ClarificationCode) ||
        seen.has(String(item.code)) || !validClarificationAnswer(item.code as ClarificationCode, item.answer)) {
      return { valid: false, reason: "invalid clarification history" };
    }
    seen.add(item.code as string);
    if (answers.clarifications[item.code as ClarificationCode] !== item.answer) {
      return { valid: false, reason: "clarification history mismatch" };
    }
  }
  const answered = CLARIFICATION_CODES.filter((code) => answers.clarifications[code] !== null);
  if (answered.length !== clarificationHistory.length || answered.some((code) => !seen.has(code))) {
    return { valid: false, reason: "clarification history incomplete" };
  }
  if (input.analysisIndex === 0 && clarificationHistory.length !== 0) return { valid: false, reason: "initial request has history" };

  const value = (legacy ? { ...input, schemaVersion: 4, operation: "generate" } : input) as unknown as AnalysisRequestEnvelope;
  return { valid: true, value };
}
