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
  return resolvers.some(s => hasValue(state, s.id));
}

function hasValue(state: EngineState, slotId: string): boolean {
  const val = state.slots[slotId];
  return val !== null && val !== undefined && val !== '';
}

// ─── Question group dedup — only blocks same-gap siblings ─────────────────

function groupAlreadyAnswered(state: EngineState, slot: SlotDefinition): boolean {
  const siblings = SLOT_REGISTRY.filter(
    s => s.question_group === slot.question_group &&
         s.resolves === slot.resolves &&
         s.id !== slot.id &&
         s.applies_to.includes(state.matter_type as never),
  );
  return siblings.some(s => hasValue(state, s.id));
}

function slotIsAnswered(state: EngineState, slot: SlotDefinition): boolean {
  return hasValue(state, slot.id);
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

// ─── Select next slot ─────────────────────────────────────────────────────

export function selectNextSlot(state: EngineState): SlotDefinition | null {
  if (state.matter_type === 'unknown') return null;

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
  const filled = coreSlots.filter(s => hasValue(state, s.id)).length;
  return Math.round((filled / coreSlots.length) * 100);
}

export { getDecisionGap as getCurrentGap };
