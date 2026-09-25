export type AreaId =
  | "business" | "employment" | "family" | "property" | "estates"
  | "litigation" | "injury" | "immigration" | "criminal" | "regulatory"
  | "ip" | "nonprofit" | "other";

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
export type WriteInKey = "timing" | "contact" | "goals" | "concerns" | "reasons" | "fee_effort" | "conditions" | "capacity" | "limit" | "aim" | "evidence";
export type ClarificationCode = "FOCUS_UNCLEAR" | "CLIENT_GOAL_UNCLEAR" | "CURRENT_CAPACITY_CONFLICT" | "FEE_EFFORT_CONFLICT" | "EXPERIENCE_DIRECTION_CONFLICT";
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
  schema_version: "dcm-v2.1";
  revision: number;
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
  situation: {
    timing: TimingId | null;
    role: RoleId | "other" | "unknown" | null;
    role_other: string;
    contact: ContactId | null;
  };
  client: { goals: GoalId[]; concerns: ConcernId[] };
  value: {
    reasons: ReasonId[];
    fee_effort: FeeEffortId | null;
    collected_fee: CollectedFeeId | null;
    team_hours: TeamHoursId | null;
    payment: PaymentId | null;
  };
  delivery: { conditions: ConditionId[]; capacity: CapacityId | null; limit: LimitId | null };
  direction: { aim: AimId | null; evidence: EvidenceId[]; less: LessId | null; less_note: string };
  clarifications: Record<ClarificationCode, ClarificationAnswer | null>;
}

export type AnswerReferencePath =
  | `write_ins.${WriteInKey}`
  | "focus.area" | "focus.work" | "focus.work_other" | "focus.service_area" | "focus.certainty" | "focus.route"
  | "situation.timing" | "situation.role" | "situation.role_other" | "situation.contact"
  | "client.goals" | "client.concerns" | "value.reasons" | "value.fee_effort" | "value.collected_fee"
  | "value.team_hours" | "value.payment" | "delivery.conditions" | "delivery.capacity" | "delivery.limit"
  | "direction.aim" | "direction.evidence" | "direction.less" | "direction.less_note"
  | `clarifications.${ClarificationCode}`
  | `focus.comparison.${"a" | "b"}.${"work" | "fee_effort" | "team_fit" | "capacity" | "evidence"}`;

export type StatementKind = "experience" | "preference" | "hypothesis" | "unknown" | "suggestion";
export interface DesiredClientStatement {
  text: string;
  kind: StatementKind;
  source_answer_ids: AnswerReferencePath[];
}
export interface DesiredClientBrief {
  definition: DesiredClientStatement;
  client_goals: DesiredClientStatement[];
  firm_reasons: DesiredClientStatement[];
  delivery_conditions: DesiredClientStatement[];
  evidence: DesiredClientStatement[];
  open_questions: DesiredClientStatement[];
  marketing: {
    topic: DesiredClientStatement;
    inquiry_question: DesiredClientStatement;
    validation_step: DesiredClientStatement;
  };
  work_to_promote_less: DesiredClientStatement[];
}
export interface AnalysisResult {
  brief: DesiredClientBrief;
  clarification_code: ClarificationCode | null;
}
export interface AnalysisRequestEnvelope {
  schemaVersion: 2;
  requestId: string;
  answerRevision: number;
  reviewRunId: string;
  analysisIndex: 0 | 1 | 2;
  aiConsent: true;
  answers: DesiredClientAnswers;
  clarifications: Array<{ code: ClarificationCode; answer: string }>;
}
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
  error: { code: AnalysisFailureCode };
}
export interface SavedBrief {
  brief: DesiredClientBrief;
  sourceBriefRevision: number;
  generatedAt: string;
  wordingReviewed: boolean;
  mode: "ai" | "structured";
  openClarificationCode?: ClarificationCode;
}
export interface SavedDraft {
  schemaVersion: 2;
  answers: DesiredClientAnswers;
  currentStage: number;
  lastEditedAt: string;
  expiresAt: string;
  savedBrief?: SavedBrief;
}
