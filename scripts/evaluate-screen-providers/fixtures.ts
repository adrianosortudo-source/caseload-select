import type { MatterType } from "../../src/lib/screen-engine/types";

type ExpectedValue = string | null | RegExp;
export interface Fixture {
  id: string;
  matter: MatterType;
  description: string;
  expected: Record<string, ExpectedValue>;
  language: string;
}

// Synthetic descriptions written for this evaluation. A null expectation means
// the caller never supplied that fact. It must stay unanswered.
function fixture(id: string, matter: MatterType, description: string, expected: Fixture["expected"], language = "en"): Fixture {
  return { id, matter, description, expected, language };
}

export const fixtures: Fixture[] = [
  fixture("invoice-small", "unpaid_invoice", "A buyer still owes my studio $1,350 for a completed delivery.", { amount_at_stake: "Under $5,000", dispute_reason: null }),
  fixture("invoice-mid", "unpaid_invoice", "A customer refuses to pay our $18,450 invoice. They say our team did not do the work properly.", { amount_at_stake: "$5,000–$25,000", dispute_reason: "Says work was not done properly" }),
  fixture("invoice-large-fr", "unpaid_invoice", "Un client refuse de régler ma facture de 43 000 dollars. Il prétend avoir déjà payé la totalité.", { amount_at_stake: "$25,000–$100,000", dispute_reason: "Says they already paid" }, "fr"),
  fixture("invoice-six-figures", "unpaid_invoice", "The unpaid invoice is for $135,000. The client denies that we had any agreement at all.", { amount_at_stake: "Over $100,000", dispute_reason: "Says there was no agreement" }),
  fixture("invoice-no-amount", "unpaid_invoice", "I sent the buyer an invoice for materials and it is overdue.", { amount_at_stake: null, dispute_reason: null }),
  fixture("invoice-distractor", "unpaid_invoice", "A past dispute for $60,000 was settled and is unrelated. This buyer owes me only $1,200 on our current invoice.", { amount_at_stake: "Under $5,000", dispute_reason: null }),
  fixture("family-separation", "family_general", "I would like help separating from my spouse.", { family_help_sought: "Separation or divorce", family_children: null, family_existing_order: null, family_timing: null, family_jurisdiction: null }),
  fixture("family-parenting", "family_general", "We live in Ontario. I need help with the parenting schedule for my two children.", { family_children: "Yes", family_jurisdiction: "Ontario", family_help_sought: "Parenting or decision-making", family_timing: null, family_existing_order: null }),
  fixture("family-no-children", "family_general", "We are filing for divorce in Ontario. We have no children and no court order or written agreement.", { family_children: "No", family_existing_order: "Neither", family_jurisdiction: "Ontario", family_timing: null }),
  fixture("family-no-order-only", "family_general", "I need help with spousal support. No court order exists. I haven't explained anything about agreements.", { family_help_sought: "Child or spousal support", family_existing_order: null, family_timing: null, family_children: null }),
  fixture("family-court-date", "family_general", "I want to change an existing parenting court order for my daughter. The next court hearing is on December 12, 2026.", { family_existing_order: "Court order", family_children: "Yes", family_timing: /(?:Dec(?:ember)?\s+12|12\s+Dec|2026-12-12)/i }),
  fixture("family-outside-on", "family_general", "My family case is in Quebec, outside Ontario. I need legal help with a written separation agreement that we already signed.", { family_jurisdiction: "Outside Ontario", family_existing_order: "Written agreement", family_timing: null, family_children: null }),
  fixture("family-parenting-fr", "family_general", "Notre famille vit en Ontario. Je cherche de l’aide pour organiser le calendrier parental de mes deux enfants.", { family_jurisdiction: "Ontario", family_children: "Yes", family_timing: null, family_existing_order: null }, "fr"),
  fixture("family-divorce-es", "family_general", "Quiero divorciarme de mi pareja. El caso está en Ontario.", { family_jurisdiction: "Ontario", family_help_sought: "Separation or divorce", family_children: null, family_existing_order: null, family_timing: null }, "es"),
  fixture("employment-no-details", "wrongful_dismissal", "My employer terminated me last month. I would like to talk about the dismissal.", { tenure_band: null, salary_band: null, signed_release: null, severance_offered: null, dismissal_reason_given: null }),
  fixture("employment-bands", "wrongful_dismissal", "My employment was terminated because of a restructuring. I worked there for six years and earned $72,000 a year.", { tenure_band: "4 to 7 years", salary_band: "$50,000 to $100,000", dismissal_reason_given: "Restructuring or layoff", signed_release: null, severance_offered: null }),
  fixture("employment-cause", "wrongful_dismissal", "They fired me for alleged cause. I have not signed anything, and the company has made no severance offer yet.", { dismissal_reason_given: "Cause was alleged", signed_release: "No, I have not signed anything", severance_offered: "No offer yet", salary_band: null, tenure_band: null }),
  fixture("employment-long", "wrongful_dismissal", "After twenty years earning $140,000 a year I was dismissed. I was offered severance verbally, and never got it in writing.", { tenure_band: "15+ years", salary_band: "$100,000 to $200,000", severance_offered: "Yes, but only verbally", signed_release: null }),
  fixture("severance-no-date", "severance_review", "My employer offered to pay four months of salary for a release. I want someone to confirm whether the offer is fair before I sign.", { severance_offer_amount: "3 to 6 months of pay", severance_deadline: null, salary_band: null }),
  fixture("severance-deadline", "severance_review", "My severance package expires tomorrow. I haven't signed anything. I want to negotiate a better package.", { severance_deadline: "Yes, in the next few days", signed_release: "No, I have not signed anything", desired_outcome_severance_review: "Negotiate a better package", salary_band: null }),
  fixture("wages-small", "wage_recovery", "My employer owes me $800, entirely in unpaid overtime.", { wages_owed_band: "Under $2,000", wages_type: "Overtime" }),
  fixture("wages-middle", "wage_recovery", "I'm due $6,000 in unpaid vacation pay.", { wages_owed_band: "$2,000 to $10,000", wages_type: "Vacation pay" }),
  fixture("wages-large-es", "wage_recovery", "Mi empleador me debe 26.000 dólares en comisiones de ventas. Solo reclamo las comisiones.", { wages_owed_band: "$10,000 to $50,000", wages_type: "Commission or bonus" }, "es"),
  fixture("wages-no-amount", "wage_recovery", "I want to recover the overtime my boss has never paid me.", { wages_type: "Overtime", wages_owed_band: null }),
  fixture("tenancy-repairs", "landlord_tenant", "I'm a tenant in a residential apartment. The landlord has ignored my requests to repair a leaking ceiling.", { tenancy_party: "Tenant", tenancy_issue: "Damage or repairs", tenancy_type: "Residential (house, condo, apartment)", tenancy_amount: null, tenancy_notice_status: null }),
  fixture("tenancy-arrears", "landlord_tenant", "I own and rent out a retail store. My commercial tenant owes me $23,000 in unpaid rent. I have served a formal notice on them.", { tenancy_party: "Landlord", tenancy_issue: "Unpaid rent", tenancy_amount: "$5,000–$25,000", tenancy_notice_status: "Formal notice given to the other side" }),
  fixture("will-planning", "will_drafting", "I am married with three children. I need a simple will. I have never had a will before.", { marital_status: "Married", children_count: "Two or three", existing_will_status: "No, I have never had one", desired_outcome_will_drafting: "Simple will", estate_complexity: null }),
  fixture("will-update", "will_drafting", "I am widowed. I have no children. My will is outdated and I would like a new one.", { marital_status: "Widowed", children_count: "None", existing_will_status: "Yes, but it is outdated", estate_complexity: null }),
  fixture("residential-buy", "residential_purchase_sale", "I am buying a condo for $720,000. I haven't made an offer yet.", { residential_role: "Buying", residential_property_type: "Condo", residential_re_amount: "$500,000–$1M", residential_re_stage: "Offer not yet made" }),
  fixture("residential-no-deadline", "residential_purchase_sale", "I am selling a townhouse and want help with the paperwork.", { residential_role: "Selling", residential_property_type: "Townhouse", residential_re_amount: null, residential_re_stage: null }),
];

// These affect money, legal status, jurisdiction, or the urgency of intake.
// Any invented value (including one from a different band) is a critical error.
export const critical = new Set([
  "amount_at_stake", "family_existing_order", "family_jurisdiction", "family_timing", "family_children",
  "tenure_band", "salary_band", "signed_release", "severance_offered", "dismissal_reason_given",
  "severance_offer_amount", "severance_deadline", "wages_owed_band", "tenancy_amount", "tenancy_notice_status",
  "estate_complexity", "children_count", "existing_will_status", "residential_re_amount", "residential_re_stage",
]);
