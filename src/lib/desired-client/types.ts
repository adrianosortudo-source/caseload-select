export type AreaId =
  | "business" | "employment" | "family" | "property" | "estates"
  | "litigation" | "injury" | "immigration" | "criminal" | "regulatory"
  | "ip" | "nonprofit" | "other";
export type TriggerSuffix = "agreement" | "transaction" | "dispute" | "ongoing" | "exit" | "change" | "complaint" | "terms" | "separation" | "parenting" | "support_property" | "planning" | "purchase" | "sale" | "finance" | "issue" | "death" | "decisions" | "claim" | "proceeding" | "payment" | "incident" | "benefits" | "offer" | "move" | "status" | "hiring" | "decision" | "investigation" | "charge" | "release" | "application" | "hearing" | "compliance" | "protect" | "commercial" | "management" | "formation" | "governance" | "planned" | "problem" | "document";
export type TriggerId = `${AreaId}.${TriggerSuffix}`;

export type WorkId =
  | "business_agreements" | "business_acquisitions" | "business_owner_disputes" | "business_ongoing"
  | "employment_employee_exit" | "employment_employer_terms" | "employment_workplace_disputes" | "employment_employer_change"
  | "family_separation" | "family_parenting" | "family_support_property" | "family_planning"
  | "property_residential_purchase" | "property_residential_sale" | "property_commercial" | "property_refinance"
  | "estates_planning" | "estates_administration" | "estates_disputes" | "estates_decision_support"
  | "litigation_contract" | "litigation_property" | "litigation_debt" | "litigation_existing"
  | "injury_motor" | "injury_premises" | "injury_disability" | "injury_other_injury"
  | "immigration_temporary" | "immigration_permanent" | "immigration_employer" | "immigration_review"
  | "criminal_investigation" | "criminal_defence" | "criminal_bail" | "criminal_appeal"
  | "regulatory_licensing" | "regulatory_investigations" | "regulatory_hearings" | "regulatory_compliance"
  | "ip_trademarks" | "ip_inventions" | "ip_licensing" | "ip_disputes"
  | "nonprofit_formation" | "nonprofit_governance" | "nonprofit_agreements" | "nonprofit_ongoing"
  | "other_planning" | "other_transaction" | "other_dispute" | "other_ongoing";

export type RoleId =
  | "business_organization" | "business_owner" | "business_transaction_party"
  | "employment_employee" | "employment_employer"
  | "family_advice_seeker" | "family_existing_party"
  | "property_buyer" | "property_seller" | "property_owner"
  | "estates_planner" | "estates_representative" | "estates_affected"
  | "litigation_individual" | "litigation_organization"
  | "injury_injured" | "injury_representative"
  | "immigration_applicant" | "immigration_employer" | "immigration_representative"
  | "criminal_individual" | "criminal_representative"
  | "regulatory_professional" | "regulatory_organization" | "regulatory_affected"
  | "ip_creator" | "ip_organization" | "ip_rights_holder"
  | "nonprofit_organization" | "nonprofit_board" | "nonprofit_founder"
  | "other_individual" | "other_organization";

export type GoalId = "understand" | "complete" | "resolve" | "protect" | "prepare" | "respond" | "unknown";
export type DecisionNeedId = "scope_cost" | "options" | "relevant_experience" | "process" | "response" | "heard" | "unknown";
export type FitSignalId = "service" | "stage" | "information" | "decision" | "scope" | "fees" | "timing" | "unknown";
export type ConcernId = "next" | "cost" | "consequences" | "time" | "worse" | "unheard";
export type ReasonId = "client_benefit" | "fees" | "skills" | "enjoyment" | "repeatable" | "further" | "direction" | "undecided";
export type ConditionId = "time" | "scope" | "information" | "decision" | "communication" | "support" | "unknown";
export type EvidenceId = "repeated" | "few" | "feedback" | "records" | "team" | "preference";
export type LimitId = "time" | "scope" | "support" | "communication" | "fees" | "none";
export type RouteId = "established" | "new" | "exploring";
export type TimingId = "planning" | "emerging" | "underway" | "deadline" | "varies" | "unknown";
export type ContactId = "owner" | "manager" | "adviser" | "other" | "unknown";
export type FeeEffortId = "worthwhile" | "scoped" | "difficult" | "unknown";
export type CollectedFeeId = "under2" | "2to5" | "5to15" | "15to50" | "50plus" | "unknown" | "private";
export type TeamHoursId = "upto5" | "6to15" | "16to40" | "41to100" | "over100" | "unknown";
export type PaymentId = "predictable" | "varies" | "uncertain" | "unknown";
export type CapacityId = "room" | "limited" | "change" | "unknown";
export type AimId = "more_current" | "narrower" | "new_area" | "new_model" | "unknown";
export type LessId = "within" | "outside" | "model" | "none";
export type OpportunitySourceId = "comparable_enquiries" | "retained_matters" | "professional_referrals" | "repeat_clients" | "website_search" | "other_source" | "no_evidence" | "unknown";
export type SuccessMeasureId = "retained_matters" | "contribution_effort" | "predictable_delivery" | "practice_mix_reputation" | "other" | "unknown";
export type EvidenceBasis = "firm_reported_recorded" | "firm_reported_estimate" | "firm_reported_experience" | "firm_reported_observation" | "client_reported" | "firm_preference" | "source_observed" | "hypothesis" | "unknown";
export type PracticeDirectionId = "grow_proven" | "narrow_specialty" | "explore_direction" | "improve_delivery" | "other" | "unknown";
export type PracticeExperienceId = "regular" | "occasional" | "adjacent" | "new" | "unknown";
export type DevelopmentNeedId = "expertise" | "support" | "process" | "capacity" | "unknown";
export type LessWorkReasonId = "preference" | "capacity" | "effort" | "financial" | "model" | "unknown";
export type ClientChoicePriorityId = "relevant_experience" | "clear_options" | "clear_fees" | "communication" | "availability" | "approach" | "language" | "community" | "other" | "unknown";
export type FirmStrengthId = "matter_experience" | "specialist_knowledge" | "clear_advice" | "practical_approach" | "responsive_service" | "language_or_community" | "other" | "unknown";
export type ClientInsightBasis = "client_feedback" | "firm_observation" | "firm_hypothesis" | "unknown";
export type InterviewStage = 1 | 2 | 3 | 4 | 5 | 6;
export type InterviewClarificationPurpose = "client_matter_specificity" | "client_goal_detail" | "firm_desirability" | "client_choice_criteria" | "strength_and_support" | "decision_pathway_observation" | "discovery_evidence" | "economics_effort_conflict" | "capacity_conflict";
export type WriteInKey = "timing" | "contact" | "goals" | "concerns" | "reasons" | "fee_effort" | "conditions" | "capacity" | "limit" | "aim" | "evidence" | "trigger" | "decision_needs" | "fit_signals";
export type ClarificationCode = "CLIENT_MATTER_UNCLEAR" | "VALUE_EFFORT_CONFLICT" | "CAPACITY_CONFLICT" | "REPEATABILITY_UNPROVEN" | "OPPORTUNITY_UNSUPPORTED";
export type ClarificationAnswer =
  | "choose_specific" | "keep_broad" | Exclude<GoalId, "unknown">
  | "limited_now" | "build_first" | "improve_model" | "reconsider_work"
  | "current_evidence" | "future_direction";

export interface ComparisonCandidate {
  work: WorkId;
  fee_effort: FeeEffortId;
  team_fit: "proven" | "stretch" | "unknown";
  capacity: CapacityId;
  evidence: "repeated" | "few" | "none";
}

export interface WorkComparison {
  a: ComparisonCandidate;
  b: ComparisonCandidate;
  selected: "a" | "b";
}

export interface PendingComparisonCandidate {
  work: WorkId;
  fee_effort: FeeEffortId | null;
  team_fit: "proven" | "stretch" | "unknown" | null;
  capacity: CapacityId | null;
  evidence: "repeated" | "few" | "none" | null;
}
export interface PendingWorkComparison {
  a: PendingComparisonCandidate | null;
  b: PendingComparisonCandidate | null;
  selected: "a" | "b";
}
export interface DesiredClientAnswers {
  schema_version: "dcm-v3.3";
  revision: number;
  interview: { ai_clarification_consent: boolean; clarification_count: number; clarified_stages: InterviewStage[]; followups: InterviewClarificationAnswer[] };
  /** Optional for drafts saved before write-in answers were introduced. */
  write_ins?: Partial<Record<WriteInKey, string>>;
  focus: {
    area: AreaId | null;
    work: WorkId | "other" | null;
    work_other: string;
    service_area: string;
    certainty: "chosen" | "provisional" | null;
    route: RouteId | null;
    comparison: WorkComparison | null;
  };
  practice: { direction: PracticeDirectionId | null; firm_type: string; capability: string; enjoys: string; experience: PracticeExperienceId | null; development_needs: DevelopmentNeedId[]; client_strength: FirmStrengthId | null; client_strength_effect: string; client_strength_support: string };
  client_context: { geography: string; relevant_circumstances: string; community_focus: string; language_service_needs: string; repeat_matter_pattern: string; discovery_behaviour: string };
  situation: {
    trigger: TriggerId | "unknown" | null;
    timing: TimingId | null;
    role: RoleId | "other" | "unknown" | null;
    role_other: string;
    contact: ContactId | null;
  };
  client: { goals: GoalId[]; goal_detail: string; concerns: ConcernId[]; decision_needs: DecisionNeedId[]; decision_context: string; pathway_basis: ClientInsightBasis | null; choice_priorities: ClientChoicePriorityId[]; choice_detail: string; choice_basis: ClientInsightBasis | null };
  value: {
    reasons: ReasonId[];
    fee_effort: FeeEffortId | null;
    collected_fee: CollectedFeeId | null;
    team_hours: TeamHoursId | null;
    payment: PaymentId | null;
    payment_context: string;
    payment_context_basis: ClientInsightBasis | null;
    currency: string;
    fee_amount: string;
    direct_cost_amount: string;
    amount_basis: "recorded" | "estimated" | "unknown" | null;
    amount_scope: "per_matter" | "range" | "other" | null;
  };
  delivery: { conditions: ConditionId[]; capacity: CapacityId | null; limit: LimitId | null; fit_signals: FitSignalId[] };
  direction: { aim: AimId | null; evidence: EvidenceId[]; less: LessId | null; less_reason: LessWorkReasonId | null; less_note: string };
  opportunity: { sources: OpportunitySourceId[]; data_basis: "recorded" | "estimated" | "unknown" | null; source_detail: string; period: string; enquiry_count: string; retained_count: string; conversion: string; acquisition_cost: string; uncertainty: string };
  repeatability: { success_measure: SuccessMeasureId | null; success_other: string; target: string; review_period: string; additional_matters: string; staffing_constraint: string };
  clarifications: Record<ClarificationCode, ClarificationAnswer | null>;
}

export type AnswerReferencePath =
  | "client.goal_detail" | "client.decision_context" | "client.pathway_basis" | "client.choice_priorities" | "client.choice_detail" | "client.choice_basis" | "practice.client_strength" | "practice.client_strength_effect" | "practice.client_strength_support" | "client_context.discovery_behaviour"
  | `write_ins.${WriteInKey}`
  | "focus.area" | "focus.work" | "focus.work_other" | "focus.service_area" | "focus.certainty" | "focus.route"
  | "practice.direction" | "practice.firm_type" | "practice.capability" | "practice.enjoys" | "practice.experience" | "practice.development_needs"
  | "client_context.geography" | "client_context.relevant_circumstances" | "client_context.community_focus" | "client_context.language_service_needs" | "client_context.repeat_matter_pattern"
  | "situation.trigger" | "situation.timing" | "situation.role" | "situation.role_other" | "situation.contact"
  | "client.goals" | "client.concerns" | "client.decision_needs" | "value.reasons" | "value.fee_effort" | "value.collected_fee"
  | "value.team_hours" | "value.payment" | "value.payment_context" | "value.payment_context_basis" | "value.currency" | "value.fee_amount" | "value.direct_cost_amount" | "value.amount_basis" | "value.amount_scope"
  | "delivery.conditions" | "delivery.capacity" | "delivery.limit" | "delivery.fit_signals"
  | "direction.aim" | "direction.evidence" | "direction.less" | "direction.less_reason" | "direction.less_note"
  | "opportunity.sources" | "opportunity.data_basis" | "opportunity.source_detail" | "opportunity.period" | "opportunity.enquiry_count" | "opportunity.retained_count" | "opportunity.conversion" | "opportunity.acquisition_cost" | "opportunity.uncertainty"
  | "repeatability.success_measure" | "repeatability.success_other" | "repeatability.target" | "repeatability.review_period" | "repeatability.additional_matters" | "repeatability.staffing_constraint"
  | `clarifications.${ClarificationCode}`
  | `interview.followups.${number}`
  | `focus.comparison.${"a" | "b"}.${"work" | "fee_effort" | "team_fit" | "capacity" | "evidence"}`;

export type StatementKind = "experience" | "preference" | "hypothesis" | "unknown" | "suggestion";
export interface DesiredClientStatement {
  text: string;
  kind: StatementKind;
  source_answer_ids: AnswerReferencePath[];
}
export interface LegacyDesiredClientBriefV1 {
  report_version: "dcm-blueprint-v1";
  portrait: DesiredClientStatement;
  client_need: DesiredClientStatement;
  firm_value: DesiredClientStatement;
  open_questions: DesiredClientStatement[];
  marketing: {
    message: DesiredClientStatement;
    content: DesiredClientStatement;
    next_step: DesiredClientStatement;
  };
}
export interface EvidenceLinkedStatement extends DesiredClientStatement { evidence_basis: EvidenceBasis; }
export interface EvidenceCard { claims: EvidenceLinkedStatement[]; }
export interface DesiredClientBriefV2 {
  report_version: "dcm-blueprint-v2";
  definition_sentence: string;
  definition_components: { firm: EvidenceLinkedStatement; client_matter: EvidenceLinkedStatement; reasons: EvidenceLinkedStatement; outcome: EvidenceLinkedStatement };
  practice_context: EvidenceCard;
  desired_client_matter: EvidenceCard;
  value_rationale: EvidenceCard;
  relevance_signals: EvidenceCard;
  opportunity_evidence: EvidenceCard;
  repeatability: EvidenceCard;
  open_questions: EvidenceLinkedStatement[];
}
export interface PracticeContextCard {
  current_practice: EvidenceLinkedStatement;
  work_to_grow: EvidenceLinkedStatement;
  experience_supporting_direction: EvidenceLinkedStatement;
  development_needs: EvidenceLinkedStatement;
  marketing_emphasis_to_reduce: EvidenceLinkedStatement;
}
export interface DesiredClientBrief {
  report_version: "dcm-blueprint-v3";
  definition_sentence: string;
  definition_components: { firm: EvidenceLinkedStatement; client_matter: EvidenceLinkedStatement; reasons: EvidenceLinkedStatement; outcome: EvidenceLinkedStatement };
  practice_context: PracticeContextCard;
  desired_client_matter: EvidenceCard;
  value_rationale: EvidenceCard;
  relevance_signals: EvidenceCard;
  opportunity_evidence: EvidenceCard;
  repeatability: EvidenceCard;
  open_questions: EvidenceLinkedStatement[];
}
export interface ClientDecisionPathway { trigger:EvidenceLinkedStatement; first_contact:EvidenceLinkedStatement; decision:EvidenceLinkedStatement; desired_progress:EvidenceLinkedStatement; }
export interface DesiredClientBriefV4 {
  report_version: "dcm-blueprint-v4";
  definition_sentence: string;
  definition_components: { client: EvidenceLinkedStatement; client_matter: EvidenceLinkedStatement; reasons: EvidenceLinkedStatement; outcome: EvidenceLinkedStatement };
  client_and_matter: EvidenceCard;
  client_goals_needs: EvidenceCard;
  why_firm_wants_work: EvidenceCard;
  why_client_chooses_firm: EvidenceCard;
  decision_pathway: ClientDecisionPathway;
  recognizable_circumstances: EvidenceCard;
  evidence_and_open_questions: EvidenceCard;
}
export type SavedBriefContent = DesiredClientBriefV4 | DesiredClientBrief | DesiredClientBriefV2 | LegacyDesiredClientBriefV1;
/** Used only by the explicitly validated v2.1 local migration path. */
export interface LegacyDesiredClientBrief {
  definition: DesiredClientStatement;
  client_goals: DesiredClientStatement[];
  firm_reasons: DesiredClientStatement[];
  delivery_conditions: DesiredClientStatement[];
  evidence: DesiredClientStatement[];
  open_questions: DesiredClientStatement[];
  marketing: { topic: DesiredClientStatement; inquiry_question: DesiredClientStatement; validation_step: DesiredClientStatement };
  work_to_promote_less: DesiredClientStatement[];
}
export interface AnalysisResult {
  brief: DesiredClientBriefV4;
  clarification_code: ClarificationCode | null;
}
export interface AnalysisRequestEnvelope {
  schemaVersion: 4;
  operation: "generate";
  requestId: string;
  answerRevision: number;
  reviewRunId: string;
  analysisIndex: 0 | 1 | 2;
  aiConsent: true;
  answers: DesiredClientAnswers;
  clarifications: Array<{ code: ClarificationCode; answer: string }>;
}
export interface InterviewClarificationAnswer { id:string; stage:InterviewStage; purpose:InterviewClarificationPurpose; source_answer_ids:AnswerReferencePath[]; source_answer_fingerprint?:string; question:string; answer:string; choiceId?:string; skipped:boolean; reflection?:string; }

/** A compact, deterministic stamp for the exact answers that supported a follow-up. */
export function interviewClarificationSourceFingerprint(answers:DesiredClientAnswers, paths:readonly AnswerReferencePath[]):string {
  const values=paths.map((path)=>[path,path.split(".").reduce<unknown>((value,key)=>value&&typeof value==="object"?(value as Record<string,unknown>)[key]:undefined,answers)]);
  const source=JSON.stringify(values);
  let a=0x811c9dc5,b=0x9e3779b9;
  for(let i=0;i<source.length;i++){const code=source.charCodeAt(i);a=Math.imul(a^code,0x01000193);b=Math.imul(b^code,0x85ebca6b);}
  return `${(a>>>0).toString(16).padStart(8,"0")}${(b>>>0).toString(16).padStart(8,"0")}`;
}
export function isInterviewClarificationCurrent(answer:InterviewClarificationAnswer, answers:DesiredClientAnswers):boolean {
  return typeof answer.source_answer_fingerprint==="string"&&answer.source_answer_fingerprint===interviewClarificationSourceFingerprint(answers,answer.source_answer_ids);
}
export interface InterviewClarificationRequestEnvelope { schemaVersion:4; operation:"clarify"; requestId:string; answerRevision:number; interviewRunId:string; clarificationIndex:0|1|2; stage:InterviewStage; aiConsent:true; answers:DesiredClientAnswers; }
export type InterviewClarificationPrompt = { outcome:"ask"; id:string; stage:InterviewStage; purpose:InterviewClarificationPurpose; source_answer_ids:AnswerReferencePath[]; question:string; choices:Array<{id:string;label:string}>; reflection:string } | { outcome:"continue"; reason:string };
export interface InterviewClarificationSuccessEnvelope { ok:true; requestId:string; answerRevision:number; interviewRunId:string; prompt:InterviewClarificationPrompt; }
export type AnalysisFailureCode = "INVALID_REQUEST" | "ORIGIN_DENIED" | "TOO_LARGE" | "RATE_LIMITED" | "AI_DISABLED" | "AI_UNAVAILABLE" | "INVALID_AI_OUTPUT";
export interface AnalysisSuccessEnvelope {
  ok: true;
  requestId: string;
  answerRevision: number;
  reviewRunId: string;
  result: AnalysisResult;
}
export interface AnalysisFailureEnvelope {
  ok: false;
  requestId: string;
  error: { code: AnalysisFailureCode; diagnostic?: { field: string; reason: string } };
}
export interface SavedBrief {
  brief: SavedBriefContent;
  sourceAnswersVersion?: "dcm-v2.2" | "dcm-v3.0" | "dcm-v3.1" | "dcm-v3.2" | "dcm-v3.3";
  sourceAnswersSnapshot?: unknown;
  sourceBriefRevision: number;
  generatedAt: string;
  wordingReviewed: boolean;
  mode: "ai" | "structured";
  refreshedFrom?: { generatedAt: string; wordingReviewed: boolean; mode: "ai" | "structured" };
  openClarificationCode?: ClarificationCode;
}
export interface SavedDraft {
  schemaVersion: 2;
  answers: DesiredClientAnswers;
  currentStage: number;
  lastEditedAt: string;
  expiresAt: string;
  savedBrief?: SavedBrief;
  reportNeedsRegeneration?: boolean;
}

export interface ScreenProposalQuestion {
  id: string;
  question: string;
  desired_condition: string | null;
  target_status: "firm_preference" | "needs_definition";
  source_answer_ids: AnswerReferencePath[];
  use: "scope_review" | "service_review" | "time_review" | "next_step";
  missing_action: "clarify";
}
export interface ScreenProposalRow {
  id: "matter_fit" | "value_delivery" | "timing" | "readiness";
  label: string;
  questions: ScreenProposalQuestion[];
  ask_summary: string;
  use_summary: string;
}
export interface ProposedScreenProfile {
  schema_version: "dcm-screen-proposal-v1";
  answer_revision: number;
  generated_at: string;
  status: "proposal";
  activation: "not_activated";
  wording_reviewed: boolean;
  rows: [ScreenProposalRow, ScreenProposalRow, ScreenProposalRow, ScreenProposalRow];
}
