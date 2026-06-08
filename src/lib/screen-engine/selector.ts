import type { EngineState, SlotDefinition, DecisionGap } from './types';
import { SLOT_REGISTRY } from './slotRegistry';

// ─── Decision gap logic ────────────────────────────────────────────────────

export function getDecisionGap(state: EngineState): DecisionGap {
  const matterGap = getMatterGap(state);
  if (matterGap !== 'none') return matterGap;

  // After matter-specific gaps are resolved, ask universal readiness questions
  // (skip for out_of_scope where we forward without qualifying further).
  if (state.matter_type === 'out_of_scope' || state.matter_type === 'unknown') return 'none';
  if (!isResolved(state, 'hiring_timeline')) return 'hiring_timeline';
  if (!isResolved(state, 'other_counsel')) return 'other_counsel';
  if (!isResolved(state, 'decision_authority')) return 'decision_authority';
  return 'none';
}

function getMatterGap(state: EngineState): DecisionGap {
  const { matter_type, advisory_subtrack } = state;

  if (matter_type === 'out_of_scope') return 'none';

  if (matter_type === 'corporate_general') {
    if (!isResolved(state, 'dispute_subtype')) return 'dispute_subtype';
    if (!isResolved(state, 'company_role')) return 'company_role';
    return 'none';
  }

  if (matter_type === 'shareholder_dispute') {
    if (!isResolved(state, 'access')) return 'access';
    if (state.raw.mentions_money && !isResolved(state, 'money_misuse')) return 'money_misuse';
    if (!isResolved(state, 'ownership_proof')) return 'ownership_proof';
    if (!isResolved(state, 'ownership')) return 'ownership';
    if (!isResolved(state, 'value')) return 'value';
    if (!isResolved(state, 'risk')) return 'risk';
    if (state.raw.mentions_urgency && !isResolved(state, 'urgency')) return 'urgency';
    return 'none';
  }

  if (matter_type === 'unpaid_invoice') {
    if (!isResolved(state, 'value')) return 'value';
    if (!isResolved(state, 'delivery_proof')) return 'delivery_proof';
    if (!isResolved(state, 'payment')) return 'payment';
    if (!isResolved(state, 'agreement_proof')) return 'agreement_proof';
    if (!isResolved(state, 'risk')) return 'risk';
    if (state.raw.mentions_urgency && !isResolved(state, 'urgency')) return 'urgency';
    return 'none';
  }

  if (matter_type === 'contract_dispute') {
    if (!isResolved(state, 'agreement_proof')) return 'agreement_proof';
    if (!isResolved(state, 'value')) return 'value';
    if (!isResolved(state, 'risk')) return 'risk';
    if (state.raw.mentions_urgency && !isResolved(state, 'urgency')) return 'urgency';
    return 'none';
  }

  if (matter_type === 'vendor_supplier_dispute') {
    if (!isResolved(state, 'value')) return 'value';
    if (!isResolved(state, 'vendor_billing')) return 'vendor_billing';
    if (!isResolved(state, 'risk')) return 'risk';
    if (!isResolved(state, 'agreement_proof')) return 'agreement_proof';
    if (!isResolved(state, 'delivery_proof')) return 'delivery_proof';
    return 'none';
  }

  if (matter_type === 'corporate_money_control') {
    if (!isResolved(state, 'company_role')) return 'company_role';
    if (!isResolved(state, 'financial_irregularity')) return 'financial_irregularity';
    if (!isResolved(state, 'value')) return 'value';
    if (!isResolved(state, 'irregularity_evidence')) return 'irregularity_evidence';
    if (!isResolved(state, 'risk')) return 'risk';
    if (state.raw.mentions_urgency && !isResolved(state, 'urgency')) return 'urgency';
    return 'none';
  }

  // ─── Real estate ────────────────────────────────────────────────────────

  if (matter_type === 'real_estate_general') {
    if (!isResolved(state, 'real_estate_subtype')) return 'real_estate_subtype';
    return 'none';
  }

  if (matter_type === 'commercial_real_estate') {
    if (!isResolved(state, 'party_role')) return 'party_role';
    if (!isResolved(state, 'value')) return 'value';
    if (!isResolved(state, 'transaction_stage')) return 'transaction_stage';
    if (!isResolved(state, 'property_type')) return 'property_type';
    if (!isResolved(state, 'risk')) return 'risk';
    if (state.raw.mentions_urgency && !isResolved(state, 'urgency')) return 'urgency';
    return 'none';
  }

  if (matter_type === 'residential_purchase_sale') {
    if (!isResolved(state, 'party_role')) return 'party_role';
    if (!isResolved(state, 'value')) return 'value';
    if (!isResolved(state, 'transaction_stage')) return 'transaction_stage';
    if (!isResolved(state, 'property_type')) return 'property_type';
    if (!isResolved(state, 'risk')) return 'risk';
    if (!isResolved(state, 'closing_timeline')) return 'closing_timeline';
    if (!isResolved(state, 'mortgage_situation')) return 'mortgage_situation';
    if (state.raw.mentions_urgency && !isResolved(state, 'urgency')) return 'urgency';
    return 'none';
  }

  if (matter_type === 'real_estate_litigation') {
    if (!isResolved(state, 'litigation_subject')) return 'litigation_subject';
    if (!isResolved(state, 'value')) return 'value';
    if (!isResolved(state, 'party_role')) return 'party_role';
    if (!isResolved(state, 'agreement_proof')) return 'agreement_proof';
    if (!isResolved(state, 'risk')) return 'risk';
    if (!isResolved(state, 'limitation_concern')) return 'limitation_concern';
    if (!isResolved(state, 'settlement_attempted')) return 'settlement_attempted';
    if (state.raw.mentions_urgency && !isResolved(state, 'urgency')) return 'urgency';
    return 'none';
  }

  if (matter_type === 'landlord_tenant') {
    if (!isResolved(state, 'party_role')) return 'party_role';
    if (!isResolved(state, 'tenancy_type')) return 'tenancy_type';
    if (!isResolved(state, 'tenancy_issue')) return 'tenancy_issue';
    if (!isResolved(state, 'value')) return 'value';
    if (!isResolved(state, 'lease_proof')) return 'lease_proof';
    if (!isResolved(state, 'risk')) return 'risk';
    return 'none';
  }

  if (matter_type === 'construction_lien') {
    if (!isResolved(state, 'party_role')) return 'party_role';
    if (!isResolved(state, 'value')) return 'value';
    if (!isResolved(state, 'lien_timing')) return 'lien_timing';
    if (!isResolved(state, 'lien_evidence')) return 'lien_evidence';
    if (!isResolved(state, 'agreement_proof')) return 'agreement_proof';
    return 'none';
  }

  if (matter_type === 'preconstruction_condo') {
    if (!isResolved(state, 'party_role')) return 'party_role';
    if (!isResolved(state, 'litigation_subject')) return 'litigation_subject';
    if (!isResolved(state, 'value')) return 'value';
    if (!isResolved(state, 'developer_status')) return 'developer_status';
    if (!isResolved(state, 'agreement_proof')) return 'agreement_proof';
    if (state.raw.mentions_urgency && !isResolved(state, 'urgency')) return 'urgency';
    return 'none';
  }

  if (matter_type === 'mortgage_dispute') {
    if (!isResolved(state, 'party_role')) return 'party_role';
    if (!isResolved(state, 'mortgage_status')) return 'mortgage_status';
    if (!isResolved(state, 'value')) return 'value';
    if (!isResolved(state, 'agreement_proof')) return 'agreement_proof';
    if (!isResolved(state, 'risk')) return 'risk';
    if (state.raw.mentions_urgency && !isResolved(state, 'urgency')) return 'urgency';
    return 'none';
  }

  // ─── Estates Phase B ────────────────────────────────────────────────────
  //
  // Gap shape: each required core slot is checked directly via `hasValue`
  // rather than `isResolved(gap)` because none of these slots have a
  // matter-specific `resolves` field (they were authored with
  // `resolves: 'none'`). The chain returns the `'matter_qualification'`
  // sentinel until every required core slot is filled, which blocks
  // `shouldPresentInsight` from firing prematurely (it requires
  // `gap === 'none'`). The selector still picks the right slot by
  // tier+priority scoring (all gating slots are tier='core' with
  // decision_value 7+).
  //
  // Bug surfaced 2026-06-07: "i need a will" → engine asked 1 universal slot
  // (hiring_timeline) and jumped to REVIEW because no will-specific gap
  // existed. Same shape affects every matter type below.

  if (matter_type === 'will_drafting') {
    if (!isUserAnswered(state, 'marital_status')) return 'matter_qualification';
    if (!isUserAnswered(state, 'children_count')) return 'matter_qualification';
    if (!isUserAnswered(state, 'estate_complexity')) return 'value'; // resolves: 'value'
    if (!isUserAnswered(state, 'existing_will_status')) return 'matter_qualification';
    return 'none';
  }

  if (matter_type === 'power_of_attorney') {
    if (!isUserAnswered(state, 'poa_type')) return 'matter_qualification';
    if (!isUserAnswered(state, 'poa_urgency')) return 'urgency'; // resolves: 'urgency'
    if (!isUserAnswered(state, 'marital_status')) return 'matter_qualification';
    if (!isUserAnswered(state, 'poa_existing_documents')) return 'matter_qualification';
    return 'none';
  }

  if (matter_type === 'probate') {
    if (!isUserAnswered(state, 'relationship_to_deceased')) return 'matter_qualification';
    if (!isUserAnswered(state, 'will_status_probate')) return 'matter_qualification';
    if (!isUserAnswered(state, 'estate_value_band')) return 'value'; // resolves: 'value'
    if (!isUserAnswered(state, 'executor_role')) return 'matter_qualification';
    return 'none';
  }

  if (matter_type === 'estate_dispute') {
    if (!isUserAnswered(state, 'estate_dispute_type')) return 'matter_qualification';
    if (!isUserAnswered(state, 'estate_dispute_role')) return 'matter_qualification';
    if (!isUserAnswered(state, 'estate_value_band')) return 'value';
    if (!isUserAnswered(state, 'estate_court_status')) return 'matter_qualification';
    return 'none';
  }

  if (matter_type === 'estates_general') {
    // Routing catch-all — the only required slot is estates_problem_type,
    // which triggers re-classification into a sub-type (will_drafting /
    // power_of_attorney / probate / estate_dispute) via the LLM extractor's
    // __matter_type. After re-routing, the sub-type's chain fires next turn.
    if (!isUserAnswered(state, 'estates_problem_type')) return 'matter_qualification';
    return 'none';
  }

  // ─── Employment Phase B ─────────────────────────────────────────────────

  if (matter_type === 'wrongful_dismissal') {
    if (!isUserAnswered(state, 'tenure_band')) return 'matter_qualification';
    if (!isUserAnswered(state, 'dismissal_reason_given')) return 'matter_qualification';
    if (!isUserAnswered(state, 'salary_band')) return 'value'; // resolves: 'value'
    if (!isUserAnswered(state, 'severance_offered')) return 'matter_qualification';
    if (!isUserAnswered(state, 'signed_release')) return 'matter_qualification';
    return 'none';
  }

  if (matter_type === 'severance_review') {
    if (!isUserAnswered(state, 'severance_offer_amount')) return 'matter_qualification';
    if (!isUserAnswered(state, 'severance_deadline')) return 'urgency'; // resolves: 'urgency'
    if (!isUserAnswered(state, 'tenure_band')) return 'matter_qualification';
    if (!isUserAnswered(state, 'salary_band')) return 'value';
    if (!isUserAnswered(state, 'signed_release')) return 'matter_qualification';
    return 'none';
  }

  if (matter_type === 'harassment_complaint') {
    if (!isUserAnswered(state, 'harassment_type')) return 'matter_qualification';
    if (!isUserAnswered(state, 'harassment_employment_status')) return 'matter_qualification';
    if (!isUserAnswered(state, 'reported_to_hr')) return 'matter_qualification';
    return 'none';
  }

  if (matter_type === 'wage_recovery') {
    if (!isUserAnswered(state, 'wages_owed_band')) return 'value'; // resolves: 'value'
    if (!isUserAnswered(state, 'wages_type')) return 'matter_qualification';
    return 'none';
  }

  if (matter_type === 'employment_contract_review') {
    if (!isUserAnswered(state, 'contract_review_type')) return 'matter_qualification';
    if (!isUserAnswered(state, 'contract_review_timeline')) return 'urgency'; // resolves: 'urgency'
    if (!isUserAnswered(state, 'contract_review_concerns')) return 'matter_qualification';
    return 'none';
  }

  if (matter_type === 'employment_general') {
    // Routing catch-all — sub-type re-classification fires on the next turn
    // after employment_problem_type is answered.
    if (!isUserAnswered(state, 'employment_problem_type')) return 'matter_qualification';
    return 'none';
  }

  if (matter_type === 'business_setup_advisory') {
    if (!isResolved(state, 'advisory_path')) return 'advisory_path';
    if (!isResolved(state, 'co_owner_count') && advisory_subtrack !== 'buy_in_or_joining') {
      return 'co_owner_count';
    }

    if (advisory_subtrack === 'solo_setup') {
      if (!isResolved(state, 'agreement_proof')) return 'agreement_proof';
      if (!isResolved(state, 'business_activity_type')) return 'business_activity_type';
      if (!isResolved(state, 'business_stage')) return 'business_stage';
      if (!isResolved(state, 'setup_needs')) return 'setup_needs';
      if (!isResolved(state, 'regulated_industry')) return 'regulated_industry';
      if (!isResolved(state, 'revenue_expectation')) return 'revenue_expectation';
      if (!isResolved(state, 'cross_border_work')) return 'cross_border_work';
      if (!isResolved(state, 'employees_planned')) return 'employees_planned';
      if (!isResolved(state, 'ip_planned')) return 'ip_planned';
      if (!isResolved(state, 'business_location')) return 'business_location';
      return 'none';
    }

    if (advisory_subtrack === 'partner_setup') {
      if (!isResolved(state, 'agreement_proof')) return 'agreement_proof';
      if (!isResolved(state, 'ownership')) return 'ownership';
      if (!isResolved(state, 'advisory_concern')) return 'advisory_concern';
      if (!isResolved(state, 'business_activity_type')) return 'business_activity_type';
      if (!isResolved(state, 'business_stage')) return 'business_stage';
      if (!isResolved(state, 'regulated_industry')) return 'regulated_industry';
      if (!isResolved(state, 'revenue_expectation')) return 'revenue_expectation';
      if (!isResolved(state, 'cross_border_work')) return 'cross_border_work';
      if (!isResolved(state, 'employees_planned')) return 'employees_planned';
      if (!isResolved(state, 'business_location')) return 'business_location';
      return 'none';
    }

    if (advisory_subtrack === 'buy_in_or_joining') {
      if (!isResolved(state, 'agreement_proof')) return 'agreement_proof';
      if (!isResolved(state, 'advisory_timing')) return 'advisory_timing';
      if (!isResolved(state, 'business_location')) return 'business_location';
      return 'none';
    }

    if (!isResolved(state, 'advisory_path')) return 'advisory_path';
    if (!isResolved(state, 'co_owner_count')) return 'co_owner_count';
    return 'none';
  }

  return 'none';
}

// ─── Resolved check ───────────────────────────────────────────────────────

function isResolved(state: EngineState, gap: DecisionGap): boolean {
  const resolvers = SLOT_REGISTRY.filter(
    s => s.resolves === gap && s.applies_to.includes(state.matter_type as never),
  );
  // Provenance-aware: a slot only counts as resolving the gap when the
  // user actually answered it (or regex matched user text, or system
  // metadata supplied it). LLM guesses do not resolve gaps. See
  // isUserAnswered for the canonical predicate.
  return resolvers.some(s => isUserAnswered(state, s.id));
}

function hasValue(state: EngineState, slotId: string): boolean {
  const val = state.slots[slotId];
  return val !== null && val !== undefined && val !== '';
}

/**
 * Weak-name heuristic (2026-06-08). A captured "name" passes this check
 * only when it looks like an actual human name the firm could read aloud
 * and the lawyer could use to address the lead.
 *
 * Reachability vs identity: a metadata-derived phone number (WhatsApp
 * wa_id, voice caller ID) makes the lead reachable and counts as
 * answered. A metadata-derived NAME does not establish identity, because
 * profile systems routinely report values like "A D" (initials), single
 * letters, "WhatsApp User", or all-symbol handles. The engine treats
 * a profile_metadata name as NOT user-answered when this returns true,
 * so the bot asks for the name in the thread instead of overclaiming.
 *
 * Returns true when the name is weak (NOT answered). Returns false when
 * the name is strong enough to use.
 *
 * Heuristics applied:
 *  - empty / null / undefined → weak
 *  - trimmed length < 3 → weak (too short for any meaningful name)
 *  - every whitespace-separated token is a single character → weak
 *    (catches "A D", "J K L", "A", "A B")
 *  - single token of length <= 2 → weak (catches "Ad", "Jo", "Li")
 *  - fewer than 3 letter characters across the whole string → weak
 *    (catches "X1 2", "??!", "+1 416", numeric handles)
 *  - matches a known generic profile placeholder → weak
 *    ("user", "unknown", "{channel} user", "{channel} customer")
 */
export function isWeakName(name: string | null | undefined): boolean {
  if (!name) return true;
  const trimmed = String(name).trim();
  if (trimmed.length < 3) return true;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.every((t) => t.length === 1)) return true;
  if (tokens.length === 1 && tokens[0].length <= 2) return true;
  const letterCount = (trimmed.match(/[a-zA-ZÀ-ÖØ-öø-ÿ]/g) || []).length;
  if (letterCount < 3) return true;
  const lower = trimmed.toLowerCase();
  const generic = new Set([
    'user',
    'unknown',
    'anonymous',
    'whatsapp user',
    'facebook user',
    'messenger user',
    'instagram user',
    'sms user',
    'google user',
    'gbp user',
    'whatsapp customer',
    'facebook customer',
    'instagram customer',
  ]);
  if (generic.has(lower)) return true;
  return false;
}

/**
 * The single canonical "is this slot answered" gate (2026-06-07 provenance
 * split).
 *
 * Global engine rule: a slot is only "answered" if the user actually
 * answered it. Not if the model guessed it. Not if it is the most likely
 * next answer. Not if it is inferred from matter type. Not if it is a
 * plausible package recommendation. See SlotMetaSource doc in types.ts
 * for the full taxonomy.
 *
 * Counts as user-answered:
 *  - `'answered'` (UI button press)
 *  - `'explicit'` (regex evidence span from user's literal text)
 *  - `'inferred'` (LEGACY: pre-2026-06-07 mixed bucket; retained for
 *    backward compat with stored screened_leads rows whose engine_state
 *    JSON carries this value)
 *  - `'system_metadata'` (caller ID, channel pre-fill; carrier-confirmed)
 *
 * Does NOT count:
 *  - `'llm_inferred'` (model guess from current intake; may have no span)
 *  - `'unknown'` (defensive placeholder)
 *
 * Used everywhere a slot's filled-ness gates engine behaviour:
 *  - slotIsAnswered (selectNextSlot candidate filter)
 *  - groupAlreadyAnswered (sibling-suppression check)
 *  - isResolved (decision-gap chain)
 *  - computeCoreCompleteness (insight-presentation threshold)
 *  - matter-specific getMatterGap blocks for estates + employment
 */
export function isUserAnswered(state: EngineState, slotId: string): boolean {
  if (!hasValue(state, slotId)) return false;
  const meta = state.slot_meta[slotId];
  const source = meta?.source ?? 'unknown';
  if (source === 'llm_inferred') return false;
  if (source === 'unknown') return false;
  // Profile metadata identity check (2026-06-08): a profile-derived name
  // (WhatsApp/Messenger/IG profile, voice agent caller_name) is NOT a
  // user-answered identity when the captured value fails the weak-name
  // heuristic. The phone leg of the same channel (system_metadata) stays
  // answered because phone is reachability, not identity. Other slot ids
  // pass through profile_metadata unchanged for forward compat in case
  // future channels seed other fields.
  if (source === 'profile_metadata' && slotId === 'client_name') {
    const value = state.slots[slotId];
    if (isWeakName(typeof value === 'string' ? value : null)) return false;
  }
  return true;
}

// ─── Question group dedup — only blocks same-gap siblings ─────────────────
//
// The intent: when two slots ask redundant variants of the same decision-gap
// question (e.g. two ways to confirm 'ownership_proof'), asking one should
// suppress the other.
//
// BUT: slots with `resolves: 'none'` (the engine's "this slot is an
// independent fact, not a gap resolver" marker) must NEVER be considered
// siblings, even when they share a question_group label. Estates Phase B
// uses `question_group: 'standing'` for marital_status, children_count, and
// existing_will_status — three independent facts about the testator, all
// `resolves: 'none'`. With the old check, one LLM-inferred slot in that
// bucket would filter out the other two and the engine would skip them on
// purpose. Bug surfaced 2026-06-07 on the DRG "i need a will" smoke test:
// LLM inferred existing_will_status from a 1-word answer, and the engine
// skipped marital_status + children_count to fall through to hiring_timeline.
//
// The early `resolves === 'none'` short-circuit fixes that without touching
// any other matter chain (corporate/real_estate slots all carry specific
// resolves fields, so this branch never fires for them).
function groupAlreadyAnswered(state: EngineState, slot: SlotDefinition): boolean {
  if (slot.resolves === 'none') return false;
  const siblings = SLOT_REGISTRY.filter(
    s => s.question_group === slot.question_group &&
         s.resolves === slot.resolves &&
         s.id !== slot.id &&
         s.applies_to.includes(state.matter_type as never),
  );
  // Provenance-aware: a sibling only suppresses this slot when the user
  // actually answered the sibling. An LLM guess on a sibling does not
  // count as "covered." See isUserAnswered.
  return siblings.some(s => isUserAnswered(state, s.id));
}

function slotIsAnswered(state: EngineState, slot: SlotDefinition): boolean {
  // Provenance-aware: only user-answered slots are filtered out of the
  // candidate pool. LLM guesses leave the slot available so the engine
  // can still ask the user to confirm.
  return isUserAnswered(state, slot.id);
}

// ─── Subtrack applicability ───────────────────────────────────────────────

function slotApplicableToSubtrack(state: EngineState, slot: SlotDefinition): boolean {
  if (!slot.applies_to_subtrack) return true;
  if (state.matter_type !== 'business_setup_advisory') return true;
  const sub = state.advisory_subtrack;
  if (sub === 'unknown') return true;
  return slot.applies_to_subtrack.includes(sub);
}

// ─── Slot scoring ─────────────────────────────────────────────────────────

function scoreSlot(slot: SlotDefinition, currentGap: DecisionGap): number {
  let score = slot.decision_value * 10;

  if (slot.resolves === currentGap) score += 1000;

  const tierBoost: Record<string, number> = {
    core: 50,
    proof: 40,
    strategic: 30,
    qualification: 20,
    contact: -9999,
  };
  score += tierBoost[slot.tier] ?? 0;

  if (slot.abstraction_level === 'abstract') score -= 50;
  if (slot.id === 'communications_exist') score -= 200;
  if (slot.resolves === 'urgency') score -= 500;
  if (slot.id.startsWith('desired_outcome')) score -= 100;

  score -= slot.priority;

  return score;
}

// ─── Matter-aware question order (2026-06-07) ─────────────────────────────
//
// The default `scoreSlot` ranks by decision_value + tier + priority. That
// optimises for the SCORER (high decision_value first), not for the lead
// experience. For will_drafting it asks `estate_complexity` (dv 8) before
// `existing_will_status` (dv 6), which feels backwards to a user who just
// typed "i need a will": they get a complexity-classification question
// before being asked whether this is a first will or an update.
//
// MATTER_SPECIFIC_SLOT_ORDER lets us override the scorer for specific
// matter types so the question sequence matches how a good intake
// coordinator would think. Ordering criteria (per Codex/operator audit):
//   1. Momentum: easiest meaningful answer first
//   2. Scope before complexity: what they want, before how complex it is
//   3. User language over legal framing
//   4. Highest routing value early (sub-type indicators)
//   5. Low regret: ask things rarely wasted, defer specialist questions
//
// When the matter type has an entry in this map, selectNextSlot walks the
// list in order and returns the first unanswered, applicable slot. When
// no entry exists, or the explicit order is exhausted (all listed slots
// answered or N/A), the default scoreSlot path takes over so universal
// readiness slots (hiring_timeline, other_counsel, decision_authority)
// can still fire at the end.
//
// Adding new entries: study the matter's slot set in slotRegistry, list
// IDs in the order a coordinator would ask them in conversation. The map
// is launch-week-scoped to the 9 DRG matter types. Corporate / real
// estate / business_setup_advisory keep the scorer-default order until
// we audit each in the same way.

const MATTER_SPECIFIC_SLOT_ORDER: Record<string, readonly string[]> = {
  // ESTATES
  will_drafting: [
    'existing_will_status',          // "Is this your first will, or updating?"
    'marital_status',                // family standing
    'children_count',                // dependants
    'estate_complexity',             // scope of assets (complexity last)
    'desired_outcome_will_drafting', // strategic intent
  ],
  power_of_attorney: [
    'poa_type',                      // what kind of POA
    'poa_existing_documents',        // existing docs
    'poa_urgency',                   // trigger / timing
    'marital_status',                // family standing
  ],
  probate: [
    'will_status_probate',           // is there a will (most decisive)
    'relationship_to_deceased',      // standing
    'executor_role',                 // role in estate
    'estate_value_band',             // value (later, after standing)
  ],
  estate_dispute: [
    'estate_dispute_role',           // who they are in the dispute
    'estate_dispute_type',           // what the dispute is about
    'estate_court_status',           // procedural posture
    'estate_value_band',             // value (later)
    'desired_outcome_estate_dispute',
  ],

  // EMPLOYMENT
  wrongful_dismissal: [
    'signed_release',                // most urgent: have they signed anything?
    'tenure_band',                   // tenure (Bardal driver)
    'dismissal_reason_given',        // why
    'severance_offered',             // current state
    'salary_band',                   // value (later)
    'desired_outcome_wrongful_dismissal',
  ],
  severance_review: [
    'signed_release',                // signed already?
    'severance_deadline',            // urgency
    'severance_offer_amount',        // the offer itself
    'tenure_band',                   // context for adequacy
    'salary_band',                   // value (later)
    'desired_outcome_severance_review',
  ],
  harassment_complaint: [
    'harassment_employment_status',  // are they still there
    'harassment_type',               // what kind
    'reported_to_hr',                // procedural posture
    'desired_outcome_harassment',
  ],
  wage_recovery: [
    'wages_type',                    // what kind of pay
    'wages_owed_band',               // how much
    'desired_outcome_wage_recovery',
  ],
  employment_contract_review: [
    'contract_review_type',          // what kind of contract
    'contract_review_timeline',      // urgency
    'contract_review_concerns',      // specific concern
    'desired_outcome_contract_review',
  ],
};

function pickByExplicitOrder(state: EngineState): SlotDefinition | null {
  const order = MATTER_SPECIFIC_SLOT_ORDER[state.matter_type];
  if (!order) return null;
  for (const slotId of order) {
    const slot = SLOT_REGISTRY.find(s => s.id === slotId);
    if (!slot) continue;
    if (slot.tier === 'contact') continue;
    if (!slot.applies_to.includes(state.matter_type as never)) continue;
    if (!slotApplicableToSubtrack(state, slot)) continue;
    // groupAlreadyAnswered is intentionally NOT consulted here: the
    // explicit order is authoritative. resolves:'none' slots are already
    // exempted from group-dedup, and matter-specific resolvers won't
    // collide because each slot ID appears at most once in the order.
    if (isUserAnswered(state, slot.id)) continue;
    return slot;
  }
  // Order exhausted: every listed slot is either answered or N/A. Fall
  // through to the default scoring path so universal slots can fire.
  return null;
}

// ─── Select next slot ─────────────────────────────────────────────────────

export function selectNextSlot(state: EngineState): SlotDefinition | null {
  if (state.matter_type === 'unknown') return null;

  // Matter-aware explicit order takes precedence over scoreSlot for the
  // listed matter types. This is how the user-facing question sequence
  // matches a coordinator's mental model rather than the scorer's.
  const explicit = pickByExplicitOrder(state);
  if (explicit) return explicit;

  const currentGap = getDecisionGap(state);

  const candidates = SLOT_REGISTRY.filter(slot => {
    if (slot.tier === 'contact') return false;
    if (!slot.applies_to.includes(state.matter_type as never)) return false;
    if (!slotApplicableToSubtrack(state, slot)) return false;
    if (slotIsAnswered(state, slot)) return false;
    if (groupAlreadyAnswered(state, slot)) return false;

    if (state.advisory_subtrack === 'solo_setup' && slot.id === 'ownership_split_discussed') return false;

    return true;
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => scoreSlot(b, currentGap) - scoreSlot(a, currentGap));

  const best = candidates[0];

  if (currentGap !== 'none' && best.resolves !== currentGap) {
    const gapResolver = candidates.find(s => s.resolves === currentGap);
    if (gapResolver) return gapResolver;
  }

  return best;
}

// ─── Core completeness ────────────────────────────────────────────────────

export function computeCoreCompleteness(state: EngineState): number {
  const coreSlots = SLOT_REGISTRY.filter(
    s => s.tier === 'core' && s.applies_to.includes(state.matter_type as never),
  );
  if (coreSlots.length === 0) return 0;
  // Provenance-aware: completeness reflects only what the USER answered
  // (UI press, regex evidence span, or system metadata). LLM guesses do
  // not push the percentage upward, so insight-presentation does not
  // fire prematurely on a thin description with a chatty model.
  const filled = coreSlots.filter(s => isUserAnswered(state, s.id)).length;
  return Math.round((filled / coreSlots.length) * 100);
}

export { getDecisionGap as getCurrentGap };
