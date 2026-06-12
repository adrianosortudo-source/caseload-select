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
  // Employment (Phase A general lane added 2026-05-21; Phase B sub-types
  // added 2026-05-22). Routing: keyword extractor maps sub-shape signals
  // to the specific sub-type when confident; falls back to
  // employment_general when the matter shape isn't clear enough yet.
  | 'wrongful_dismissal'
  | 'severance_review'
  | 'harassment_complaint'
  | 'wage_recovery'
  | 'employment_contract_review'
  | 'employment_general'
  // Estates (Phase A general lane added 2026-05-21; Phase B sub-types
  // added 2026-05-22).
  | 'will_drafting'
  | 'power_of_attorney'
  | 'probate'
  | 'estate_dispute'
  | 'estates_general'
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
  // Employment family (Phase A: single catch-all)
  | 'general_employment'
  // Estates family (Phase A: single catch-all)
  | 'general_estates'
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
  // Generic matter-qualification sentinel for matter types whose core slots
  // are not yet wired into the gap chain via their own resolve-by-id slot.
  // Estates Phase B (will_drafting, power_of_attorney, probate, estate_dispute,
  // estates_general) and employment Phase B (wrongful_dismissal,
  // severance_review, harassment_complaint, wage_recovery,
  // employment_contract_review, employment_general) gate on this. The selector
  // never sees a `resolves: 'matter_qualification'` slot, so it picks by
  // tier+priority — which is correct for these matter types because every
  // gating slot is `tier: 'core'` with sane decision_value + priority.
  | 'matter_qualification'
  | 'none';

/**
 * Provenance class for slot values in EngineState.slot_meta.
 *
 * The 2026-06-07 split (after the DRG launch-week "i need a will" failure
 * mode): the engine must never let LLM-derived values masquerade as facts
 * the user actually provided. The model can prefill a slot from a
 * 4-word description, but that is a HINT, not an answered question.
 *
 * Global engine rule:
 *   A slot is only "answered" (for the purpose of suppressing a follow-up
 *   question, counting toward completeness, or rendering on the lawyer
 *   brief as user-provided) if the user actually answered it. Not if the
 *   model guessed it. Not if it is the most likely next answer. Not if it
 *   is inferred from matter type.
 *
 * The `isUserAnswered` predicate in selector.ts is the single canonical
 * gate. Every "is this filled" check (slotIsAnswered, groupAlreadyAnswered,
 * isResolved, computeCoreCompleteness, getMatterGap blocks) routes through
 * it.
 *
 * Values:
 *
 *  - `'explicit'`: regex evidence pass (slotEvidence.ts) and initial
 *    classification (extractor.ts). The user's literal text matched a
 *    pattern; the value is a span out of the user's input. Counts as
 *    user-answered.
 *
 *  - `'answered'`: user pressed a UI button (control.ts:applyAnswer) or
 *    answered a multi-turn channel question. The most direct form of
 *    user-answered. Counts.
 *
 *  - `'inferred'`: LEGACY. Pre-2026-06-07 the LLM extractor used this
 *    value, conflating LLM guesses with regex evidence. Existing
 *    screened_leads rows still carry it. Treated as user-answered for
 *    backward compat with stored rows; new code paths use the more
 *    specific values below.
 *
 *  - `'llm_inferred'`: LLM extraction in mergeLlmResults. The model
 *    returned a value, possibly without textual evidence in the user's
 *    description. The engine records the value as a hint but DOES NOT
 *    treat it as answered: the brief still surfaces it (clearly labelled
 *    as inferred), but the follow-up question is still asked.
 *
 *  - `'system_metadata'`: carrier-confirmed system-provided value. Used
 *    for caller-ID phone numbers (voice intake) and WhatsApp wa_id (the
 *    phone the carrier verified at handshake time). The user did not say
 *    it through the intake channel but the carrier confirmed it. Counts
 *    as answered: reachable identity.
 *
 *  - `'profile_metadata'`: profile-name pre-fill from a Meta channel
 *    (WhatsApp profile name, Messenger first+last, Instagram display name)
 *    or from a voice agent's caller_name field. The user did not type or
 *    confirm this name; only the profile system reported it. Profile
 *    names are routinely weak ("A D" initials, single first names, "User
 *    1234"), so the engine does NOT treat profile_metadata as answered
 *    when the captured value fails the weak-name heuristic in
 *    `isWeakName` (selector.ts). A strong profile-metadata name passes
 *    isUserAnswered so the engine doesn't ask twice, but the brief still
 *    surfaces honest "From {channel} profile" provenance, never claiming
 *    the lead typed it in the thread. Reachability vs identity: phone is
 *    reachability (system_metadata, always answered); name is identity
 *    (profile_metadata, answered only when not weak).
 *
 *  - `'unknown'`: placeholder for slots with a value of unknown
 *    provenance (defensive coding). Treated as NOT answered.
 */
export type SlotMetaSource =
  | 'explicit'
  | 'answered'
  | 'inferred'
  | 'llm_inferred'
  | 'system_metadata'
  | 'profile_metadata'
  | 'unknown';

export type AdvisorySubtrack = 'solo_setup' | 'partner_setup' | 'buy_in_or_joining' | 'unknown';

/**
 * How the CURRENT matter_type was determined (added 2026-06-11, DR-069).
 *
 * matter_type is the engine's most load-bearing classification: it selects
 * the question pack, the banding lane, the fee framing, and the entire
 * brief pack. Until DR-069 it carried no provenance at all, so downstream
 * surfaces could not tell a deterministic keyword classification from an
 * LLM guess from a lead-confirmed routing answer, and the brief asserted
 * all three with equal confidence.
 *
 *  - `'deterministic'`: the regex classifier in extractor.classify() set
 *    it from keyword signals in the lead's own words. High precision.
 *  - `'user_routing_answer'`: the lead answered a routing question
 *    (corporate_problem_type / real_estate_problem_type /
 *    employment_problem_type / estates_problem_type) and a
 *    rerouteFrom*General function applied their choice. The strongest
 *    provenance: the lead picked the bucket themselves.
 *  - `'llm_inferred'`: the LLM's __matter_type classifier promoted a
 *    routing catch-all to a specific sub-type. Permitted only on
 *    single-pass flows (voice transcript, operator replay) where no
 *    follow-up question is possible, and on the 'unknown' lane where the
 *    LLM is the only classifier (DR-039, multilingual). Briefs must
 *    surface this honestly: the lead never confirmed the classification.
 *  - `'unknown'`: states serialized before this field existed.
 */
export type MatterTypeProvenance =
  | 'deterministic'
  | 'user_routing_answer'
  | 'llm_inferred'
  | 'unknown';

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
  | 'employment'
  | 'estates'
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
  /**
   * Provenance of the current matter_type (DR-069). Set by initialiseState
   * ('deterministic'), upgraded by the rerouteFrom*General functions
   * ('user_routing_answer') and by the mergeLlmResults __matter_type
   * promotion ('llm_inferred'). Optional because states serialized before
   * 2026-06-11 lack it; readers treat absence as 'unknown'.
   */
  matter_type_provenance?: MatterTypeProvenance;
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
  /**
   * Detected lead language. Defaults to 'en' at `initialiseState`. The LLM
   * is authoritative: the schema's `__detected_language` field is always
   * required and the LLM's response sets this on every extraction call
   * (DR-039 — unified classification pipeline). The previous franc-based
   * pre-detection (DR-035) is removed.
   */
  language: SupportedLanguage;
  /**
   * Discovery follow-up counter (channel-intake-processor only).
   *
   * Increments each time the processor sends a discovery question to the
   * lead AFTER the contact-capture doctrine gate has already passed. Caps
   * brief depth on uncapped Meta channels (whatsapp / facebook / instagram)
   * so a lead with full contact pre-filled from sender metadata still
   * answers 2-3 enrichment questions instead of getting persisted on a
   * single-pass extraction.
   *
   * Distinct from `follow_up_count` on `channel_intake_sessions` which
   * tracks contact-capture follow-up attempts (max 3). The two counters
   * are separate phases: contact-capture runs to completion first; only
   * after the gate passes does discovery start with its own budget.
   *
   * Web / SMS / GBP / Voice never set this; their flows do not call the
   * channel processor's discovery loop (web/sms/gbp drive their own
   * dialogue client-side, voice is single-pass on the transcript).
   */
  discoveryFollowUpCount?: number;
  /**
   * Slot id the channel processor most recently asked the lead about,
   * via Phase C question send or capture_contact. Used by
   * `applyPendingSlotReply` on the NEXT inbound turn to route the
   * reply to the slot we ACTUALLY asked, independent of what the
   * engine's `getNextStep` currently prefers. Added 2026-06-09 (#172)
   * after a field repro where the engine's preferred next slot shifted
   * between turns (advisory_path asked → engine shifts to
   * capture_contact(client_name) on resume because of weak profile
   * name + contactCaptureStarted), and the user's reply to the
   * originally asked slot got lost.
   *
   * Cleared by `applyPendingSlotReply` once the reply is consumed,
   * and by the contact-extraction path once the name is captured.
   * Always set by Phase C before persisting the post-send session.
   *
   * Optional; absent on web / sandbox states.
   */
  pendingAskedSlotId?: string | null;
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
  /**
   * Channel-aware closing acknowledgment to send to the lead at the
   * terminal `stop` step. Populated by `buildClosingMessage(state)` in
   * `closing.ts`. Empty for web and voice (web renders its own done
   * page; voice closes verbally). Callers on Meta / SMS / GBP channels
   * surface this via the channel's Send API after persistence.
   */
  closingMessage?: string;
}

export interface BandResult {
  band: Band;
  confidence: number;
  reasoning: string;
  coreCompleteness: number;
}

/**
 * Provenance taxonomy for captured facts (locked 2026-06-02).
 *
 * The 6 canonical values, in PRECEDENCE order (highest trust first):
 *   1. confirmed_by_caller_after_readback - agent readback + explicit caller "yes"
 *   2. spelled_by_caller                  - caller spelled it out character-by-character
 *   3. explicit_from_caller               - caller spoke it verbatim in this call
 *   4. system_metadata                    - from telephony metadata (e.g. GHL caller-ID fromNumber)
 *   5. inferred_from_transcript           - app classifier derived from transcript context
 *   6. unknown                            - no signal captured
 *
 * Legacy values ('stated', 'confirmed', 'inferred') remain as type members for
 * backward compatibility with persisted screened_leads rows. New writes should
 * use the canonical 6 values. The brief renderer (screen-brief-html.ts) maps
 * both old and new values to lawyer-facing labels.
 *
 * Per operator direction 2026-06-02: do NOT overclaim. Code that promotes a
 * later candidate value over an earlier one without true readback-confirmation
 * detection should tag the result as 'explicit_from_caller', NOT as
 * 'confirmed_by_caller_after_readback'. The stronger label is reserved for
 * code paths that have detected readback + caller affirmation in the transcript.
 */
export type FactSource =
  | 'confirmed_by_caller_after_readback'
  | 'spelled_by_caller'
  | 'explicit_from_caller'
  | 'system_metadata'
  | 'profile_metadata'
  | 'inferred_from_transcript'
  // AI extraction from the lead's free text (DR-069, 2026-06-11). Before
  // this member existed, buildResolvedFactsV2 collapsed llm_inferred slot
  // fills to 'unknown', so the brief could say a fact was shaky but not
  // WHY. The renderer already carries a dedicated chip for this value.
  | 'llm_inferred'
  | 'unknown'
  // Legacy values, kept for backward compatibility with existing DB rows.
  // New code should NOT emit these. The brief renderer maps them to lawyer
  // labels.
  | 'stated'
  | 'confirmed'
  | 'inferred';

/**
 * Precedence map for FactSource. Higher number wins when reconciling multiple
 * candidate values for the same field.
 *
 * Used by the finalization/merge layer (e.g. contact-extraction.ts) to decide
 * whether a later candidate should overwrite an earlier captured value.
 *
 * Legacy values are mapped to their nearest canonical equivalent so existing
 * DB rows participate correctly in precedence comparisons during read.
 */
export const FACT_SOURCE_PRECEDENCE: Record<FactSource, number> = {
  confirmed_by_caller_after_readback: 6,
  spelled_by_caller: 5,
  explicit_from_caller: 4,
  system_metadata: 3,
  // profile_metadata (2026-06-08, #169): below system_metadata (carrier
  // verified) and explicit_from_caller (lead typed it), above
  // inferred_from_transcript (no source signal at all). A later
  // explicit_from_caller value, e.g. the lead typing their real name
  // after the engine asked, overrides a weak profile_metadata seed.
  profile_metadata: 2,
  inferred_from_transcript: 1,
  // llm_inferred (DR-069): an AI guess from free text. Same trust floor as
  // inferred_from_transcript; any user-grounded or metadata source beats it.
  llm_inferred: 1,
  unknown: 0,
  // Legacy mappings (read-only, never emitted by new code):
  confirmed: 6,      // old 'confirmed' implied readback acknowledgement
  stated: 4,         // old 'stated' was "caller said it"
  inferred: 1,       // old 'inferred' was app-derived
};

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
  /**
   * Contact-capture doctrine gate (adopted 2026-05-15).
   *
   * True when the engine has captured client_name AND at least one of
   * client_email or client_phone. False otherwise.
   *
   * Receivers branch on this:
   *   - true  → row is a screened lead, lands in `screened_leads`, lawyer sees it
   *   - false → row is an unconfirmed inquiry, lands in `unconfirmed_inquiries`,
   *             NEVER reaches the lawyer's triage portal
   *
   * Computed by `buildReport()` via `lib/contact-doctrine.isContactComplete`.
   */
  contact_complete: boolean;
  /**
   * Business setup advisory subtrack (added 2026-06-07).
   *
   * Mirrors `EngineState.advisory_subtrack` into the persisted brief so
   * retrospective queries, admin reclassify, and band-recompute paths
   * can see the subtrack without re-running the classifier from raw
   * slots. Critical for the business_setup_advisory band gate (band.ts):
   * the gate's suppression and promotion both depend on whether the
   * file is solo_setup vs partner_setup vs buy_in_or_joining.
   *
   * For non-advisory matter types this is 'unknown' (the engine default).
   */
  advisory_subtrack: AdvisorySubtrack;
  /**
   * How the matter_type was determined (added 2026-06-11, DR-069).
   *
   * Mirrors `EngineState.matter_type_provenance` into the persisted brief,
   * following the DR-054 rule: every state field a downstream decision
   * needs must be on LawyerReport, or serialization drops it. Downstream
   * consumers: the brief renderer (cover-headline honesty chip when the
   * classification is 'llm_inferred'), triage queries, and any future
   * GHL workflow branching on classification confidence.
   *
   * 'unknown' for states serialized before this field existed.
   */
  matter_type_provenance: MatterTypeProvenance;
}
