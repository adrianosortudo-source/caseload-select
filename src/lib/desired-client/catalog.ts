import type {
  AimId, AreaId, AnswerReferencePath, CapacityId, CollectedFeeId, ComparisonCandidate,
  ConcernId, ConditionId, ContactId, DesiredClientAnswers, EvidenceId, FeeEffortId,
  GoalId, LessId, LimitId, PaymentId, ReasonId, RoleId, TeamHoursId, TimingId, WorkId,
} from "./types";

export interface AreaPack {
  label: string;
  works: Record<string, string>;
  roles: Record<string, string>;
}

export const AREA_ORDER: readonly AreaId[] = [
  "business", "employment", "family", "property", "estates", "litigation",
  "injury", "immigration", "criminal", "regulatory", "ip", "nonprofit", "other",
];

export const AREA_CATALOG: Record<AreaId, AreaPack> = {
  business: { label: "Business & commercial", works: {
    business_agreements: "Commercial agreement drafting and review", business_acquisitions: "Buying or selling a business",
    business_owner_disputes: "Disputes between business owners", business_ongoing: "Ongoing business counsel",
  }, roles: { business_organization: "Business or organization", business_owner: "Owner or founder", business_transaction_party: "Individual involved in a business transaction" } },
  employment: { label: "Employment", works: {
    employment_employee_exit: "Advice after employment ends", employment_employer_terms: "Employment agreements and workplace policies",
    employment_workplace_disputes: "Workplace complaints and disputes", employment_employer_change: "Advice during workforce changes",
  }, roles: { employment_employee: "Employee", employment_employer: "Employer" } },
  family: { label: "Family", works: {
    family_separation: "Separation agreements", family_parenting: "Parenting arrangements and changes",
    family_support_property: "Support and property issues", family_planning: "Relationship agreements for future planning",
  }, roles: { family_advice_seeker: "Person seeking advice", family_existing_party: "Person involved in an existing matter" } },
  property: { label: "Real estate", works: {
    property_residential_purchase: "Residential purchases", property_residential_sale: "Residential sales",
    property_commercial: "Commercial property transactions", property_refinance: "Refinancing and ownership changes",
  }, roles: { property_buyer: "Buyer", property_seller: "Seller", property_owner: "Property owner" } },
  estates: { label: "Wills & estates", works: {
    estates_planning: "Wills and estate planning", estates_administration: "Estate administration",
    estates_disputes: "Estate disputes", estates_decision_support: "Planning for future decision-making support",
  }, roles: { estates_planner: "Person planning ahead", estates_representative: "Estate representative", estates_affected: "Person affected by an estate matter" } },
  litigation: { label: "Civil litigation", works: {
    litigation_contract: "Contract disputes", litigation_property: "Property disputes", litigation_debt: "Debt recovery disputes",
    litigation_existing: "Taking over an existing civil dispute",
  }, roles: { litigation_individual: "Individual", litigation_organization: "Business or organization" } },
  injury: { label: "Personal injury", works: {
    injury_motor: "Motor vehicle injury claims", injury_premises: "Injuries involving property conditions",
    injury_disability: "Disability benefit disputes", injury_other_injury: "Other injury claims",
  }, roles: { injury_injured: "Person affected", injury_representative: "Representative arranging help" } },
  immigration: { label: "Immigration", works: {
    immigration_temporary: "Temporary residence applications", immigration_permanent: "Permanent residence applications",
    immigration_employer: "Employer immigration support", immigration_review: "Responses to decisions and review proceedings",
  }, roles: { immigration_applicant: "Individual applicant", immigration_employer: "Employer", immigration_representative: "Representative arranging help" } },
  criminal: { label: "Criminal", works: {
    criminal_investigation: "Advice during an investigation", criminal_defence: "Defence of a charge",
    criminal_bail: "Bail proceedings", criminal_appeal: "Appeals and review work",
  }, roles: { criminal_individual: "Person seeking advice for themselves", criminal_representative: "Person arranging help for someone" } },
  regulatory: { label: "Administrative / regulatory", works: {
    regulatory_licensing: "Licensing and registration", regulatory_investigations: "Professional or regulatory investigations",
    regulatory_hearings: "Hearings and reviews", regulatory_compliance: "Ongoing compliance advice",
  }, roles: { regulatory_professional: "Regulated professional", regulatory_organization: "Business or organization", regulatory_affected: "Individual affected by a decision" } },
  ip: { label: "Intellectual property", works: {
    ip_trademarks: "Trademark protection", ip_inventions: "Invention protection", ip_licensing: "Licensing and commercial agreements",
    ip_disputes: "Intellectual property disputes",
  }, roles: { ip_creator: "Creator or inventor", ip_organization: "Business or organization", ip_rights_holder: "Rights holder" } },
  nonprofit: { label: "Not-for-profit", works: {
    nonprofit_formation: "Establishing or restructuring an organization", nonprofit_governance: "Governance advice",
    nonprofit_agreements: "Agreements and transactions", nonprofit_ongoing: "Ongoing legal and compliance advice",
  }, roles: { nonprofit_organization: "Organization", nonprofit_board: "Board or leadership team", nonprofit_founder: "Person establishing an organization" } },
  other: { label: "Another practice area", works: {
    other_planning: "Advice and planning", other_transaction: "A defined transaction or process",
    other_dispute: "A dispute or contested process", other_ongoing: "An ongoing advisory relationship",
  }, roles: { other_individual: "Individual", other_organization: "Business or organization" } },
};

export function getWorkOptions(area: AreaId) {
  return [...Object.entries(AREA_CATALOG[area].works).map(([id, label]) => ({ id: id as WorkId, label })), { id: "other" as const, label: "Another type of work" }];
}
export function getRoleOptions(area: AreaId) {
  return [...Object.entries(AREA_CATALOG[area].roles).map(([id, label]) => ({ id: id as RoleId, label })), { id: "other" as const, label: "Another role" }, { id: "unknown" as const, label: "Not sure yet" }];
}
export function getAreaLabel(id: AreaId): string { return AREA_CATALOG[id].label; }
export function getWorkLabel(area: AreaId, id: WorkId | "other"): string { return id === "other" ? "Another type of work" : AREA_CATALOG[area].works[id] ?? "Type of work still to specify"; }
export function getRoleLabel(area: AreaId, id: RoleId | "other" | "unknown"): string {
  if (id === "other") return "Another role";
  if (id === "unknown") return "Not sure yet";
  return AREA_CATALOG[area].roles[id] ?? "Client role still to specify";
}
export function getRoleOtherLabel(): string { return "Describe the role in a few words"; }
export const CONTACT_ROLE_IDS = new Set<RoleId>([
  "business_organization", "business_owner", "employment_employer", "litigation_organization", "immigration_employer",
  "regulatory_organization", "ip_organization", "ip_rights_holder", "nonprofit_organization", "nonprofit_board",
  "nonprofit_founder", "other_organization",
]);
export const GOAL_LABELS: Record<GoalId, string> = {
  understand: "Understand the options and decide what to do", complete: "Complete a planned transaction or process",
  resolve: "Resolve a disagreement", protect: "Protect something important", prepare: "Prepare for a future change",
  respond: "Meet an obligation or respond to a process", unknown: "Not sure yet",
};
export const CONCERN_LABELS: Record<ConcernId, string> = {
  next: "I don't know what happens next", cost: "I'm worried about the cost", consequences: "I'm worried about the consequences",
  time: "I need to know how long this could take", worse: "I want to avoid making the situation worse",
  unheard: "I haven't heard this directly yet",
};
export const REASON_LABELS: Record<ReasonId, string> = {
  client_benefit: "It lets us make a useful difference for the client", fees: "The fee usually supports the effort",
  skills: "It uses work we do well", enjoyment: "The team enjoys doing it", repeatable: "We can deliver it consistently",
  further: "It can lead to further work or referrals", direction: "It supports the practice we want to build",
  undecided: "We're still deciding",
};
export const CONDITION_LABELS: Record<ConditionId, string> = {
  time: "Enough time to prepare", scope: "A clearly agreed scope", information: "Access to the information we need",
  decision: "A clear person responsible for decisions", communication: "A workable communication schedule",
  support: "Access to particular skills or support", unknown: "We're still establishing the process",
};
export const EVIDENCE_LABELS: Record<EvidenceId, string> = {
  repeated: "Several matters we have handled", few: "A small number of examples", feedback: "Feedback from clients",
  records: "Fee and time records", team: "Experience of people on the team", preference: "Mainly our preference at this stage",
};
export const LIMIT_LABELS: Record<LimitId, string> = {
  time: "Too little preparation time", scope: "Scope expands without agreement", support: "Delivery needs exceed available skills or support",
  communication: "The communication demands exceed our service model", fees: "The fee does not support the effort", none: "No consistent pattern yet",
};
export const TIMING_LABELS: Record<TimingId, string> = {
  planning: "Before a planned decision or change", emerging: "When a problem first appears", underway: "When the matter is already underway",
  deadline: "When a deadline is close", varies: "At different stages", unknown: "Not sure yet",
};
export const TIMING_PHRASES: Record<TimingId, string> = {
  planning: "before a planned decision or change", emerging: "when a problem first appears", underway: "when the matter is already underway",
  deadline: "when a deadline is close", varies: "at different stages", unknown: "at a stage still to be established",
};
export const CONTACT_LABELS: Record<ContactId, string> = {
  owner: "Owner or founder", manager: "Manager or executive", adviser: "Internal legal or professional adviser",
  other: "Someone else", unknown: "Not sure yet",
};
export const FEE_EFFORT_LABELS: Record<FeeEffortId, string> = {
  worthwhile: "Usually worthwhile", scoped: "Worthwhile when the scope is clear",
  difficult: "Often more effort than the fee supports", unknown: "We haven't established this yet",
};
export const COLLECTED_FEE_LABELS: Record<CollectedFeeId, string> = {
  under2: "Under C$2,000", "2to5": "C$2,000 to under C$5,000", "5to15": "C$5,000 to under C$15,000",
  "15to50": "C$15,000 to under C$50,000", "50plus": "C$50,000 or more", unknown: "Not established", private: "Prefer not to answer",
};
export const TEAM_HOURS_LABELS: Record<TeamHoursId, string> = {
  upto5: "Up to 5 hours", "6to15": "More than 5, up to 15 hours", "16to40": "More than 15, up to 40 hours",
  "41to100": "More than 40, up to 100 hours", over100: "More than 100 hours", unknown: "Not established",
};
export const PAYMENT_LABELS: Record<PaymentId, string> = {
  predictable: "Usually predictable", varies: "Depends on the matter", uncertain: "Often uncertain", unknown: "Not established",
};
export const CAPACITY_LABELS: Record<CapacityId, string> = {
  room: "Yes, with the current team", limited: "A limited amount", change: "Only after we change capacity or support",
  unknown: "We need to establish that",
};
export const AIM_LABELS: Record<AimId, string> = {
  more_current: "More of the work we already handle well", narrower: "A clearer focus within our current practice",
  new_area: "A new area we are developing", new_model: "A different way of serving existing clients",
  unknown: "We're still choosing a direction",
};
export const LESS_LABELS: Record<LessId, string> = {
  within: "Other work within this practice area", outside: "Work outside this practice area",
  model: "Work that needs a delivery model we do not offer", none: "Nothing identified yet",
};
export const ROUTE_LABELS = {
  established: "We already do it and want more", new: "We are building toward it", exploring: "We are deciding whether to pursue it",
} as const;
export const COMPARISON_FEE_LABELS = {
  worthwhile: "Usually worthwhile", scoped: "Works with clear scope", difficult: "Often not worthwhile", unknown: "Not established",
} as const;
export const COMPARISON_TEAM_LABELS = { proven: "We have demonstrated capability", stretch: "We need to develop capability or support", unknown: "Not established" } as const;
export const COMPARISON_CAPACITY_LABELS = { room: "Room for more", limited: "Limited room", change: "Changes needed first", unknown: "Not established" } as const;
export const COMPARISON_EVIDENCE_LABELS = { repeated: "Repeated experience", few: "A few examples", none: "Mainly an expectation" } as const;
export function getReasonLabel(id: ReasonId, route: "established" | "new" | "exploring" | null): string {
  if (route !== "established" && id === "fees") return "We expect the fee to support the effort";
  if (route !== "established" && id === "repeatable") return "We expect to deliver it consistently";
  return REASON_LABELS[id];
}
export function getFeeEffortLabel(id: FeeEffortId, route: "established" | "new" | "exploring" | null): string {
  if (route !== "established") {
    if (id === "worthwhile") return "We expect it to be worthwhile";
    if (id === "scoped") return "We expect it to work with a clear scope";
    if (id === "difficult") return "We are concerned about the effort required";
  }
  return FEE_EFFORT_LABELS[id];
}
export function isKnownArea(value: unknown): value is AreaId {
  return typeof value === "string" && (AREA_ORDER as readonly string[]).includes(value);
}
export function isKnownWork(area: AreaId, value: unknown): value is WorkId {
  return typeof value === "string" && Object.hasOwn(AREA_CATALOG[area].works, value);
}

const CLARIFICATION_LABELS: Record<string, string> = {
  choose_specific: "Choose a type of work", keep_broad: "Keep this broad for now", limited_now: "A limited amount now",
  build_first: "Build capacity before increasing demand", improve_model: "The economics need to improve",
  reconsider_work: "The work needs reconsideration", current_evidence: "Work we already handle",
  future_direction: "A direction we are building", ...GOAL_LABELS,
};
const UNKNOWN_VALUES = new Set(["unknown", "undecided", "private"]);

function getPathValue(answers: DesiredClientAnswers, path: AnswerReferencePath): unknown {
  const [top, second, third, fourth] = path.split(".");
  if (top === "focus" && second === "comparison") {
    const comparison = answers.focus.comparison;
    if (!comparison || comparison.selected !== third) return undefined;
    return comparison[third as "a" | "b"][fourth as keyof ComparisonCandidate];
  }
  const root = answers as unknown as Record<string, unknown>;
  const group = root[top] as Record<string, unknown> | undefined;
  if (!group) return undefined;
  if (top === "clarifications") return group[second];
  return group[second];
}

function labelReference(path: AnswerReferencePath, value: unknown, answers: DesiredClientAnswers): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => labelReference(path, item, answers) ?? String(item)).join(", ");
  if (typeof value !== "string") return String(value);
  if (path === "focus.area") return isKnownArea(value) ? AREA_CATALOG[value].label : value;
  if (path === "focus.work") return isKnownArea(answers.focus.area) ? getWorkLabel(answers.focus.area, value as WorkId | "other") : value;
  if (path === "situation.role") return isKnownArea(answers.focus.area) ? getRoleLabel(answers.focus.area, value as RoleId | "other" | "unknown") : value;
  if (path === "value.reasons") return getReasonLabel(value as ReasonId, answers.focus.route);
  if (path === "value.fee_effort") return getFeeEffortLabel(value as FeeEffortId, answers.focus.route);
  if (path === "value.collected_fee") return COLLECTED_FEE_LABELS[value as CollectedFeeId];
  if (path === "value.team_hours") return TEAM_HOURS_LABELS[value as TeamHoursId];
  if (path === "value.payment") return PAYMENT_LABELS[value as PaymentId];
  if (path === "client.goals") return GOAL_LABELS[value as GoalId];
  if (path === "client.concerns") return CONCERN_LABELS[value as ConcernId];
  if (path === "situation.timing") return TIMING_LABELS[value as TimingId];
  if (path === "situation.contact") return CONTACT_LABELS[value as ContactId];
  if (path === "delivery.conditions") return CONDITION_LABELS[value as ConditionId];
  if (path === "delivery.capacity") return CAPACITY_LABELS[value as CapacityId];
  if (path === "delivery.limit") return LIMIT_LABELS[value as LimitId];
  if (path === "direction.aim") return AIM_LABELS[value as AimId];
  if (path === "direction.evidence") return EVIDENCE_LABELS[value as EvidenceId];
  if (path === "direction.less") return LESS_LABELS[value as LessId];
  if (path === "focus.route") return ROUTE_LABELS[value as keyof typeof ROUTE_LABELS];
  if (path.startsWith("clarifications.")) return CLARIFICATION_LABELS[value] ?? value;
  if (path.startsWith("focus.comparison.")) {
    if (path.endsWith(".work") && isKnownArea(answers.focus.area)) return getWorkLabel(answers.focus.area, value as WorkId);
    if (path.endsWith(".fee_effort")) return COMPARISON_FEE_LABELS[value as keyof typeof COMPARISON_FEE_LABELS];
    if (path.endsWith(".team_fit")) return COMPARISON_TEAM_LABELS[value as keyof typeof COMPARISON_TEAM_LABELS];
    if (path.endsWith(".capacity")) return COMPARISON_CAPACITY_LABELS[value as keyof typeof COMPARISON_CAPACITY_LABELS];
    if (path.endsWith(".evidence")) return COMPARISON_EVIDENCE_LABELS[value as keyof typeof COMPARISON_EVIDENCE_LABELS];
  }
  return value;
}
export interface AnswerReferenceResolution {
  value: string | null;
  present: boolean;
  unknown: boolean;
}
export function resolveAnswerReference(path: AnswerReferencePath, answers: DesiredClientAnswers): AnswerReferenceResolution {
  const raw = getPathValue(answers, path);
  const present = raw !== undefined;
  const normalizedEmpty = typeof raw === "string" && raw.trim().length === 0;
  const unknown = !present || raw === null || normalizedEmpty || (Array.isArray(raw) && (raw.length === 0 || raw.some((item) => typeof item === "string" && UNKNOWN_VALUES.has(item))))
    || (typeof raw === "string" && UNKNOWN_VALUES.has(raw));
  const value = labelReference(path, raw, answers);
  return { value: value?.trim() || null, present, unknown };
}
export function getAnswerLabel(path: AnswerReferencePath, answers: DesiredClientAnswers): string | null {
  return resolveAnswerReference(path, answers).value;
}
export function getCandidateOptionLabel(candidate: ComparisonCandidate, field: keyof ComparisonCandidate, area: AreaId): string {
  const value = candidate[field];
  if (field === "work") return getWorkLabel(area, value as WorkId);
  if (field === "fee_effort") return COMPARISON_FEE_LABELS[value as keyof typeof COMPARISON_FEE_LABELS];
  if (field === "team_fit") return COMPARISON_TEAM_LABELS[value as keyof typeof COMPARISON_TEAM_LABELS];
  if (field === "capacity") return COMPARISON_CAPACITY_LABELS[value as keyof typeof COMPARISON_CAPACITY_LABELS];
  return COMPARISON_EVIDENCE_LABELS[value as keyof typeof COMPARISON_EVIDENCE_LABELS];
}
