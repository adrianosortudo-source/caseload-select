export type PracticeArea =
  | 'corporate'
  | 'real_estate'
  | 'family'
  | 'immigration'
  | 'employment'
  | 'criminal'
  | 'personal_injury'
  | 'estates'
  | 'unknown';

export type MatterType =
  | 'business_setup_advisory'
  | 'shareholder_dispute'
  | 'unpaid_invoice'
  | 'contract_dispute'
  | 'vendor_supplier_dispute'
  | 'corporate_money_control'
  | 'corporate_general'
  // Real estate
  | 'commercial_real_estate'
  | 'residential_purchase_sale'
  | 'real_estate_litigation'
  | 'landlord_tenant'
  | 'construction_lien'
  | 'preconstruction_condo'
  | 'mortgage_dispute'
  | 'real_estate_general'
  // Out of scope (detected but not yet supported)
  | 'out_of_scope'
  | 'unknown';

export type DisputeFamily =
  | 'ownership_control'
  | 'payment_collection'
  | 'vendor_supplier'
  | 'agreement_performance'
  | 'financial_irregularity'
  | 'general_business'
  // Real estate families
  | 'real_estate_transaction'
  | 'real_estate_dispute'
  | 'tenancy'
  | 'construction_payment'
  | 'general_real_estate'
  | 'unknown';

export type Band = 'A' | 'B' | 'C' | 'D';

export type StepType =
  | 'clarify'
  | 'continue'
  | 'recover'
  | 'deepen'
  | 'present_insight'
  | 'capture_contact'
  | 'stop';

export type SlotTier = 'core' | 'proof' | 'strategic' | 'qualification' | 'contact';

export type QuestionGroup =
  | 'standing'
  | 'value'
  | 'proof'
  | 'risk'
  | 'control'
  | 'status'
  | 'contact'
  | 'advisory'
  | 'ownership_proof'
  | 'agreement_proof'
  | 'payment_proof'
  | 'delivery_proof'
  | 'access_proof'
  | 'generic'
  | 'routing'
  | 'vendor'
  | 'irregularity'
  | 'company_role_group'
  // Real estate groups
  | 'transaction_stage'
  | 'property'
  | 'parties'
  | 'closing'
  | 'lien'
  | 'tenancy_terms'
  | 'tenancy_dispute'
  | 'preconstruction'
  | 'readiness';

export type DecisionGap =
  | 'ownership'
  | 'ownership_proof'
  | 'access'
  | 'money_misuse'
  | 'value'
  | 'payment'
  | 'delivery_proof'
  | 'agreement_proof'
  | 'risk'
  | 'urgency'
  | 'advisory_path'
  | 'co_owner_count'
  | 'advisory_concern'
  | 'advisory_actionability'
  | 'advisory_specific_task'
  | 'advisory_timing'
  | 'business_activity_type'
  | 'business_stage'
  | 'setup_needs'
  | 'business_location'
  | 'start_timeline'
  | 'contact'
  | 'dispute_subtype'
  | 'company_role'
  | 'financial_irregularity'
  | 'vendor_billing'
  | 'irregularity_evidence'
  // Setup advisory depth
  | 'revenue_expectation'
  | 'employees_planned'
  | 'regulated_industry'
  | 'cross_border_work'
  | 'ip_planned'
  // Real estate transaction depth
  | 'closing_timeline'
  | 'mortgage_situation'
  | 'representation_status'
  // Real estate dispute depth
  | 'limitation_concern'
  | 'settlement_attempted'
  // Universal lead readiness (asked at end of any matter chain)
  | 'hiring_timeline'
  | 'other_counsel'
  | 'decision_authority'
  // Real estate gaps
  | 'transaction_stage'
  | 'property_type'
  | 'closing_status'
  | 'real_estate_subtype'
  | 'lien_timing'
  | 'lien_evidence'
  | 'tenancy_type'
  | 'tenancy_issue'
  | 'lease_proof'
  | 'developer_status'
  | 'mortgage_status'
  | 'litigation_subject'
  | 'party_role'
  | 'none';

export type SlotMetaSource = 'explicit' | 'answered' | 'inferred' | 'unknown';

export type AdvisorySubtrack = 'solo_setup' | 'partner_setup' | 'buy_in_or_joining' | 'unknown';

export interface LeadSummary {
  intro: string;        // 1-2 sentences in plain language about what they're dealing with
  points: string[];     // bullets of key confirmed facts in their language
  closing: string;      // what kind of help the firm typically provides for this
}

export type IntentFamily =
  | 'setup_advisory'
  | 'business_dispute'
  | 'real_estate_transaction'
  | 'real_estate_dispute'
  | 'unknown';

export interface SlotMeta {
  source: SlotMetaSource;
  evidence?: string;
  confidence?: number;
}

export interface SlotEvidence {
  value: string;
  matched_pattern: string;
  confidence: number;
  source: 'explicit' | 'inferred';
}

export interface RawSignals {
  mentions_urgency: boolean;
  mentions_money: boolean;
  mentions_access: boolean;
  mentions_ownership: boolean;
  mentions_documents: boolean;
  mentions_payment: boolean;
  mentions_agreement: boolean;
  mentions_vendor: boolean;
  mentions_fraud: boolean;
  // Real estate signals
  mentions_property: boolean;
  mentions_closing: boolean;
  mentions_lease: boolean;
  mentions_construction: boolean;
  mentions_mortgage: boolean;
  mentions_preconstruction: boolean;
  input_length: number;
}

/**
 * Input channel that produced this state. Drives channel-aware behaviour
 * in selector / control logic. For example, SMS short-circuits the
 * post-insight question loop after a small budget because completing a
 * thin brief beats abandoning a deep one.
 *
 *   web        : website widget (default; full-depth flow)
 *   whatsapp   : WhatsApp Business
 *   sms        : plain SMS
 *   instagram  : Instagram DM
 *   facebook   : Facebook Messenger (same Meta API as Instagram)
 *   gbp        : Google Business Profile messaging (plain text, in-Maps)
 *   voice      : phone call routed through GHL Voice AI. The transcript
 *                arrives server-side on the call-end webhook and the
 *                engine runs a single-pass extraction on it, no follow-up
 *                dialogue. Tight question budget (DR-031), DR-033.
 */
export type Channel = 'web' | 'whatsapp' | 'sms' | 'instagram' | 'facebook' | 'gbp' | 'voice';

export type SupportedLanguage = 'en' | 'fr' | 'es' | 'pt' | 'zh' | 'ar';

export interface EngineState {
  input: string;
  practice_area: PracticeArea;
  matter_type: MatterType;
  intent_family: IntentFamily;
  dispute_family: DisputeFamily;
  advisory_subtrack: AdvisorySubtrack;
  slots: Record<string, string | null>;
  slot_meta: Record<string, SlotMeta>;
  slot_evidence: Record<string, SlotEvidence>;
  raw: RawSignals;
  band?: Band;
  confidence: number;
  coreCompleteness: number;
  currentGap?: DecisionGap;
  answeredQuestionGroups: string[];
  questionHistory: string[];
  insightShown: boolean;
  contactCaptureStarted: boolean;
  lead_id: string;
  submitted_at: string;
  /** Input channel; defaults to 'web' on extractor.initialiseState. */
  channel?: Channel;
  /** Detected lead language. Defaults to 'en'. Set by franc on turn 1 (DR-035). */
  language: SupportedLanguage;
  /** True when franc confidence < threshold; triggers Gemini language confirm on turn 1 (DR-035). */
  language_needs_confirm?: boolean;
  debug?: Record<string, unknown>;
}

export interface SlotOption {
  value: string;  // canonical English string — stored in state.slots, read by scoring
  label: string;  // English display string — shown to the lead (initially equals value)
}

export interface SlotDefinition {
  id: string;
  question: string;
  input_type: 'single_select' | 'free_text';
  options?: SlotOption[];
  applies_to: MatterType[];
  applies_to_subtrack?: AdvisorySubtrack[];
  tier: SlotTier;
  question_group: QuestionGroup;
  resolves: DecisionGap;
  decision_value: number;
  abstraction_level: 'concrete' | 'medium' | 'abstract';
  required: boolean;
  priority: number;
  evidence_patterns?: {
    yes?: string[];
    no?: string[];
    partial?: string[];
    not_sure?: string[];
    unpaid?: string[];
    partially_paid?: string[];
    disputed?: string[];
    quality_issue?: string[];
    denial?: string[];
    urgent?: string[];
    [key: string]: string[] | undefined;
  };
  allow_repeat_after_answer?: boolean;
  /**
   * Per-slot override for the LLM extraction layer.
   *
   *   undefined → fall through to tier-based default
   *               (`proof` and `qualification` tiers are blocked from LLM
   *               extraction by default — they're the absence-implies-no
   *               pattern that produces noisy "Inferred from context" rows
   *               on the lawyer brief; everything else is allowed.)
   *   false     → never let the LLM fill this slot
   *   true      → force the LLM to consider this slot regardless of tier
   *
   * Intended for the rare proof/qualification slot that genuinely
   * benefits from free-text extraction (e.g. when the lead's narrative
   * commonly contains the answer verbatim). Default behaviour is the
   * conservative one — the lead answers in-conversation.
   */
  llm_extractable?: boolean;
}

export interface NextStep {
  type: StepType;
  slot?: SlotDefinition;
  message?: string;
  bridgeText?: string;
}

export interface BandResult {
  band: Band;
  confidence: number;
  reasoning: string;
  coreCompleteness: number;
}

export type FactSource = 'stated' | 'confirmed' | 'inferred' | 'unknown';

export interface ResolvedFact {
  label: string;
  value: string;
  source: FactSource;
}

export interface AxisBreakdown {
  score: number;       // 0-10
  reasons: string[];   // human-readable contributors
}

export interface FourAxisScores {
  value: number;        // 0-10
  complexity: number;   // 0-10 (drag, not lift)
  urgency: number;      // 0-10
  readiness: number;    // 0-10
  readinessAnswered: boolean;
}

export interface AxisReasoning {
  value: AxisBreakdown;
  complexity: AxisBreakdown;
  urgency: AxisBreakdown;
  readiness: AxisBreakdown;
  readinessAnswered: boolean;
}

export interface LawyerReport {
  // Lead metadata
  lead_id: string;
  submitted_at: string;
  // Headline
  matter_snapshot: string;
  lawyer_time_priority: string;
  band: Band;
  band_reasoning_bullets: string[];
  confidence_calibration: string;
  four_axis: FourAxisScores;
  axis_reasoning: AxisReasoning;
  // Truth and provenance
  truth_warnings: string[];
  // Practical brief
  likely_legal_services: string[];
  fee_estimate: string;
  why_it_matters: string;
  cross_sell_opportunities: string[];
  // Strategic depth
  strategic_considerations: string[];
  what_to_confirm: string[];
  call_openers: string[];
  best_next_question: string;
  // Facts
  resolved_facts_v2: ResolvedFact[];
  resolved_facts: Record<string, string>;
  inferred_signals: string[];
  open_questions: string[];
  risk_flags: string[];
}
