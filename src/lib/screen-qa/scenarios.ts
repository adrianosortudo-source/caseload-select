import type { MatterType } from "@/lib/screen-engine/types";

export type ScreenQaLayer =
  | "engine"
  | "component"
  | "browser_preview"
  | "production_smoke";

export type ScreenQaAction =
  | { type: "answer"; slotId: string; value: string }
  | { type: "back" }
  | { type: "skip" }
  | { type: "restart" }
  | { type: "open_report" };

export type ScreenQaExpected = {
  route?: MatterType;
  maxQuestions: number;
  expectedAsked?: string[];
  forbiddenAsked?: string[];
  reportMustContain?: string[];
  reportMustNotContain?: string[];
  maxProgressiveRoutingSteps?: number;
};

export type ScreenQaFixture = {
  id: `QA-${string}`;
  title: string;
  layers: ScreenQaLayer[];
  locale: "en" | "pt";
  opening: string;
  actions: ScreenQaAction[];
  expected: ScreenQaExpected;
};

const answer = (slotId: string, value: string): ScreenQaAction => ({
  type: "answer",
  slotId,
  value,
});

/**
 * Fictional, deterministic Screen journeys. These are deliberately kept
 * outside the engine and slot registry so the same evidence pack can be used
 * by the unit runner, component tests, and later protected-preview checks.
 */
export const SCREEN_QA_FIXTURES: readonly ScreenQaFixture[] = [
  {
    id: "QA-01",
    title: "Contact request and structured clarify",
    layers: ["engine", "component", "browser_preview", "production_smoke"],
    locale: "en",
    opening: "I want to speak to a lawyer.",
    actions: [
      answer("clarify_area", "corporate_general"),
      answer("corporate_help_category", "Starting, buying, or restructuring a business"),
      answer("advisory_path", "Starting a new business"),
      answer("co_owner_count", "One partner"),
      answer("advisory_concern", "Deciding who owns what"),
      answer("advisory_actionability", "Planning soon"),
    ],
    expected: {
      route: "business_setup_advisory",
      maxQuestions: 8,
      expectedAsked: ["clarify_area", "corporate_help_category"],
      forbiddenAsked: ["corporate_dispute_problem_type", "corporate_internal_problem_type"],
      maxProgressiveRoutingSteps: 1,
    },
  },
  {
    id: "QA-02",
    title: "Unpaid fictional invoice",
    layers: ["engine"],
    locale: "en",
    opening:
      "Fictional scenario: a design client owes $28,000 on an unpaid invoice. We have a signed proposal, the invoice, and an email thread, but the client disputes the scope.",
    actions: [
      answer("amount_at_stake", "$25,000–$100,000"),
      answer("invoice_exists", "Yes"),
      answer("payment_status", "Nothing paid"),
      answer("proof_of_performance", "Yes"),
      answer("dispute_reason", "Says work was not done properly"),
      answer("desired_outcome_unpaid_invoice", "Get paid"),
      { type: "open_report" },
    ],
    expected: {
      route: "unpaid_invoice",
      maxQuestions: 8,
      forbiddenAsked: ["corporate_help_category", "corporate_dispute_problem_type"],
      reportMustContain: ["matter_snapshot", "resolved_facts_v2"],
      reportMustNotContain: ["corporate_help_category", "corporate_dispute_problem_type"],
    },
  },
  {
    id: "QA-03",
    title: "Fictional co-owner dispute",
    layers: ["engine"],
    locale: "en",
    opening:
      "Fictional scenario: my co-owner locked me out of the company accounts and is making decisions without me.",
    actions: [
      answer("client_role", "Business partner"),
      answer("counterparty_type", "Business partner"),
      answer("corporate_records_available", "No"),
      answer("management_exclusion", "Yes"),
      answer("desired_outcome_shareholder_dispute", "Regain access to records or accounts"),
    ],
    expected: {
      route: "shareholder_dispute",
      maxQuestions: 8,
      maxProgressiveRoutingSteps: 1,
      forbiddenAsked: ["corporate_dispute_problem_type"],
    },
  },
  {
    id: "QA-04",
    title: "Fictional co-founder formation",
    layers: ["engine", "component", "browser_preview", "production_smoke"],
    locale: "en",
    opening:
      "Fictional scenario: I am starting a business with a co-founder and want to set it up properly.",
    actions: [
      answer("advisory_path", "Starting a new business"),
      answer("co_owner_count", "One partner"),
      answer("advisory_concern", "Avoiding problems with a partner later"),
      answer("business_activity_type", "Software and technology"),
      answer("business_stage", "Still planning"),
      answer("ownership_split_discussed", "No"),
    ],
    expected: {
      route: "business_setup_advisory",
      maxQuestions: 8,
      forbiddenAsked: ["corporate_help_category", "corporate_dispute_problem_type", "corporate_internal_problem_type"],
      maxProgressiveRoutingSteps: 0,
    },
  },
  {
    id: "QA-05",
    title: "Fictional contract before signing",
    layers: ["engine"],
    locale: "en",
    opening:
      "Fictional scenario: I am starting a business and need a contract drafted before signing it this week.",
    actions: [
      answer("corporate_help_category", "Contracts or ongoing legal support"),
      answer("corporate_support_problem_type", "A contract I need drafted or reviewed before signing"),
      answer("contract_review_type", "A contractor or consulting agreement"),
      answer("contract_review_timeline", "This week"),
      answer("contract_review_concerns", "Intellectual property assignment"),
      answer("desired_outcome_contract_review", "Negotiate specific clauses"),
    ],
    expected: {
      route: "business_setup_advisory",
      maxQuestions: 8,
      maxProgressiveRoutingSteps: 1,
      forbiddenAsked: ["corporate_dispute_problem_type", "corporate_internal_problem_type"],
    },
  },
  {
    id: "QA-06",
    title: "Business free-text escape",
    layers: ["engine"],
    locale: "en",
    opening: "Fictional scenario: I have another kind of business question.",
    actions: [
      answer("corporate_help_category", "other: a fictional business question not listed"),
      answer("company_involvement", "Owner or founder"),
      answer("gca_engagement_shape", "A one-time project"),
    ],
    expected: {
      route: "corporate_general",
      maxQuestions: 8,
      expectedAsked: ["corporate_help_category"],
      forbiddenAsked: ["corporate_dispute_problem_type", "corporate_internal_problem_type", "corporate_support_problem_type"],
      maxProgressiveRoutingSteps: 0,
    },
  },
  {
    id: "QA-07",
    title: "Fictional urgent document deadline",
    layers: ["engine"],
    locale: "en",
    opening: "Fictional scenario: I received a severance offer today and need it reviewed before a deadline in 48 hours.",
    actions: [
      answer("severance_offer_amount", "3 to 6 months of pay"),
      answer("severance_deadline", "Yes, in the next few days"),
      answer("signed_release", "No, I have not signed anything"),
      answer("desired_outcome_severance_review", "Confirm the offer is fair before signing"),
      answer("client_role", "Employee"),
    ],
    expected: {
      route: "severance_review",
      maxQuestions: 8,
      reportMustNotContain: ["guaranteed response", "will win"],
    },
  },
  {
    id: "QA-08",
    title: "Fictional complete narrative",
    layers: ["engine"],
    locale: "en",
    opening:
      "Fictional scenario: my design client has an unpaid invoice for $28,000 under a signed proposal, work was delivered, emails document the dispute, and I want payment. There is no immediate deadline.",
    actions: [
      answer("amount_at_stake", "$25,000–$100,000"),
      answer("invoice_exists", "Yes"),
      answer("payment_status", "Nothing paid"),
      answer("proof_of_performance", "Yes"),
      answer("dispute_reason", "Says work was not done properly"),
      { type: "open_report" },
    ],
    expected: {
      route: "unpaid_invoice",
      maxQuestions: 8,
      forbiddenAsked: ["corporate_help_category", "corporate_dispute_problem_type"],
      reportMustContain: ["matter_snapshot", "resolved_facts_v2"],
    },
  },
  {
    id: "QA-09",
    title: "Fictional out-of-scope matter",
    layers: ["engine"],
    locale: "en",
    opening: "Fictional scenario: I need help with a family custody question.",
    actions: [
      answer("client_name", "Fictional Person"),
      answer("client_email", "fictional.person@example.test"),
    ],
    expected: {
      route: "out_of_scope",
      maxQuestions: 8,
      reportMustNotContain: ["qualified", "accepted", "guaranteed"],
    },
  },
  {
    id: "QA-10",
    title: "Portuguese contact request and business path",
    layers: ["engine", "component", "browser_preview", "production_smoke"],
    locale: "pt",
    opening: "Quero falar com um advogado sobre abrir uma empresa fictícia com um sócio.",
    actions: [
      answer("clarify_area", "corporate_general"),
      answer("corporate_help_category", "Starting, buying, or restructuring a business"),
      answer("advisory_path", "Starting a new business"),
      answer("co_owner_count", "One partner"),
      answer("advisory_concern", "Deciding who owns what"),
      answer("business_activity_type", "Software and technology"),
      answer("business_stage", "Still planning"),
    ],
    expected: {
      route: "business_setup_advisory",
      maxQuestions: 8,
      forbiddenAsked: ["corporate_dispute_problem_type"],
    },
  },
  {
    id: "QA-11",
    title: "Fictional navigation recovery",
    layers: ["engine", "component"],
    locale: "en",
    opening: "Fictional scenario: I am starting a business with one fictional partner.",
    actions: [
      answer("advisory_path", "Starting a new business"),
      { type: "back" },
      answer("advisory_path", "Starting a new business"),
      { type: "skip" },
      { type: "restart" },
      answer("advisory_path", "Starting a new business"),
      { type: "open_report" },
    ],
    expected: {
      route: "business_setup_advisory",
      maxQuestions: 8,
      expectedAsked: ["co_owner_count"],
      forbiddenAsked: ["corporate_help_category", "corporate_dispute_problem_type"],
    },
  },
  {
    id: "QA-12",
    title: "Fictional long report in marketing iframe",
    layers: ["component", "browser_preview", "production_smoke"],
    locale: "en",
    opening:
      "Fictional scenario: our design studio has a $28,000 unpaid invoice, a signed proposal, delivery records, a disputed scope, and a fictional co-owner who needs the report reviewed.",
    actions: [
      answer("amount_at_stake", "$25,000–$100,000"),
      answer("invoice_exists", "Yes"),
      answer("payment_status", "Nothing paid"),
      answer("proof_of_performance", "Yes"),
      answer("dispute_reason", "Says work was not done properly"),
      answer("desired_outcome_unpaid_invoice", "Get paid"),
      { type: "open_report" },
    ],
    expected: {
      route: "unpaid_invoice",
      maxQuestions: 8,
      reportMustContain: ["matter_snapshot", "resolved_facts_v2", "inferred_signals"],
      reportMustNotContain: ["corporate_help_category", "corporate_dispute_problem_type"],
    },
  },
];

export function getScreenQaFixture(id: string): ScreenQaFixture {
  const fixture = SCREEN_QA_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Unknown Screen QA fixture: ${id}`);
  return fixture;
}
