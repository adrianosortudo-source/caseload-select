// Builds the response schema and slot catalogue that the LLM uses to extract
// facts from a lead's free-text description. The schema is derived directly
// from SLOT_REGISTRY so the registry stays the single source of truth.
//
// Output shape targets Google Gemini's responseSchema format:
//   - properties have type: 'string' (lowercase)
//   - nullable: true to permit "value not extractable"
//   - enum lists the chip options for single-select slots

import { SLOT_REGISTRY, getSlotsForMatter } from '../slotRegistry';
import { ALL_CANONICAL_MATTER_TYPES } from '../extractor';
import type { MatterType, SlotDefinition } from '../types';

export interface ExtractionSlot {
  id: string;
  question: string;
  input_type: 'single_select' | 'free_text';
  options?: string[];
  description: string;
}

/**
 * Special field id used to inject a top-level matter classifier into the
 * LLM schema when the regex fast-path returned matter_type='unknown'. The
 * leading double underscore signals "engine-internal field" — it's not in
 * the slot registry, doesn't render in any UI, and gets special-cased in
 * mergeLlmResults to update state.matter_type instead of state.slots.
 *
 * This is the global fix for the "regex doesn't know that synonym" failure
 * mode: when the regex misses, the LLM picks the matter type directly
 * from the canonical list using its language-understanding instead of
 * keyword-matching a finite pattern list.
 */
export const MATTER_TYPE_CLASSIFIER_FIELD = '__matter_type';

/**
 * Always-injected synthetic field. The LLM is authoritative for language
 * detection (DR-039 — unified classification pipeline). On EVERY
 * extraction call, the LLM returns the lead's language as an ISO 639-1
 * code from the supported set, or 'en' as the default for English /
 * unrecognised input. `mergeLlmResults` writes this back into
 * `state.language` on every call.
 *
 * Supersedes DR-035 (franc + Gemini hybrid detection) and DR-029 (LLM
 * only fires when regex misses). Now the LLM extraction always runs and
 * always reports the language.
 *
 * Same double-underscore convention as MATTER_TYPE_CLASSIFIER_FIELD: the
 * field is engine-internal, doesn't render in any UI, and gets
 * special-cased in mergeLlmResults to update state.language instead of
 * state.slots.
 */
export const LANGUAGE_DETECTOR_FIELD = '__detected_language';

// Slots that should never be filled by the LLM extractor (per-id allowlist).
//
// Two categories:
//
// 1. Contact details — collected through the explicit form, never inferred.
//
// 2. Universal readiness chain — these are conversion questions about the
//    lead's internal state and future intent (when they want to retain, who
//    else they have contacted, who decides). They are not facts about the
//    matter. The lead MUST answer them through chips; the LLM cannot infer
//    them from a matter description, and any inference is a hallucination
//    that contaminates the band calculation.
const EXCLUDED_FROM_LLM = new Set([
  'client_name',
  'client_phone',
  'client_email',
  'hiring_timeline',
  'other_counsel',
  'decision_authority',
]);

// Tiers blocked from LLM extraction by default. Both produce the
// "absence-implies-no" failure mode — the model fills binary qualification
// or proof slots with "No" / "Just exploring" / "Not yet" because the lead
// did not address that topic, and the brief surfaces those as facts.
//
// Per-slot override: set `llm_extractable: true` on a SlotDefinition to
// re-include it. Set `llm_extractable: false` on any tier to force-exclude.
const TIERS_BLOCKED_BY_DEFAULT = new Set<SlotDefinition['tier']>([
  'proof',
  'qualification',
]);

function isLlmAllowed(slot: SlotDefinition): boolean {
  if (EXCLUDED_FROM_LLM.has(slot.id)) return false;
  if (slot.llm_extractable === false) return false;
  if (slot.llm_extractable === true) return true;
  return !TIERS_BLOCKED_BY_DEFAULT.has(slot.tier);
}

// ── Routing catch-all promotion (Phase C parity with chip UI) ───────────
//
// When the regex classifier landed at a *_general routing catch-all
// (corporate_general / real_estate_general / employment_general /
// estates_general), inject a SCOPED classifier slot so the LLM can offer
// a sub-type pick from the lead's turn-1 free text.
//
// DR-069 (2026-06-11): the merge gates the promotion. On INTERACTIVE
// channels (web widget, Meta, realtime voice), mergeLlmResults keeps the
// matter at the catch-all so the routing question gets asked and the
// lead's answer routes via rerouteFrom*General. On SINGLE-PASS callers
// (voice webhook, promote replay, admin reclassify) the promotion fires
// and stamps matter_type_provenance='llm_inferred'; the brief surfaces
// the AI-inferred classification honestly. The schema injection itself
// is channel-independent: it gives the LLM the option list either way,
// and the merge decides what to do with the pick.
//
// Peer sets mirror the chip routing slots in extractor.ts
// rerouteFromCorporateGeneral / rerouteFromRealEstateGeneral /
// rerouteFromEmploymentGeneral / rerouteFromEstatesGeneral. The current
// matter type is included so the LLM can confidently STAY at the
// catch-all when the lead's description is genuinely ambiguous.
const ROUTING_PEER_SETS: Partial<Record<MatterType, MatterType[]>> = {
  corporate_general: [
    'corporate_general',
    'shareholder_dispute',
    'unpaid_invoice',
    'vendor_supplier_dispute',
    'corporate_money_control',
    'contract_dispute',
    'general_counsel_advisory',
  ],
  real_estate_general: [
    'real_estate_general',
    'commercial_real_estate',
    'residential_purchase_sale',
    'real_estate_litigation',
    'landlord_tenant',
    'construction_lien',
    'preconstruction_condo',
    'mortgage_dispute',
  ],
  employment_general: [
    'employment_general',
    'wrongful_dismissal',
    'severance_review',
    'harassment_complaint',
    'wage_recovery',
    'employment_contract_review',
  ],
  estates_general: [
    'estates_general',
    'will_drafting',
    'power_of_attorney',
    'probate',
    'estate_dispute',
  ],
};

export function getExtractableSlots(matterType: MatterType): ExtractionSlot[] {
  // Language detector slot is ALWAYS at the head of the catalogue (DR-039).
  // The LLM resolves language on every call, not just when an upstream
  // detector was uncertain.
  const prefix: ExtractionSlot[] = [languageDetectorSlot()];

  // For unknown matter, return routing-level slots so the LLM can help
  // disambiguate within an area. Plus inject the special matter-type
  // classifier field so the LLM picks the top-level bucket from the
  // canonical list.
  if (matterType === 'unknown') {
    const slots = SLOT_REGISTRY.filter(
      (s) => s.tier === 'core' || s.question_group === 'routing',
    );
    const result: ExtractionSlot[] = [...prefix, matterTypeClassifierSlot()];
    for (const slot of slots) {
      if (isLlmAllowed(slot)) result.push(slotToExtractionSlot(slot));
    }
    return result;
  }

  // Routing catch-all: inject a SCOPED classifier so the LLM can offer a
  // sub-type pick from turn-1 text. Merge logic in llm/extractor.ts
  // gates the actual promotion on the channel (DR-069): interactive
  // channels keep the catch-all and ask the routing question; single-
  // pass callers apply classificationForMatterType and stamp llm_inferred.
  const peers = ROUTING_PEER_SETS[matterType];
  if (peers) {
    return [
      ...prefix,
      routingClassifierSlot(matterType, peers),
      ...getSlotsForMatter(matterType).filter(isLlmAllowed).map(slotToExtractionSlot),
    ];
  }

  return [
    ...prefix,
    ...getSlotsForMatter(matterType).filter(isLlmAllowed).map(slotToExtractionSlot),
  ];
}

/**
 * Scoped classifier slot for routing catch-alls. The peer set is the
 * routing slot's destinations from extractor.ts (rerouteFromXGeneral)
 * plus the routing catch-all itself (so the LLM can confidently stay
 * at the catch-all when the description is genuinely ambiguous).
 *
 * The peer-set scoping prevents Gemini from hijacking a corporate
 * matter into an unrelated practice area — the only legal transitions
 * are within the same practice area, plus staying put.
 */
function routingClassifierSlot(currentMatterType: MatterType, peers: MatterType[]): ExtractionSlot {
  return {
    id: MATTER_TYPE_CLASSIFIER_FIELD,
    question:
      `CLASSIFICATION TASK, not extraction. The lead's matter was initially classified as '${currentMatterType}', a ROUTING CATCH-ALL. Your job is to PROMOTE to a specific sub-type when the description gives you a real signal. Be decisive when the lead's words name the problem. Examples of strong signals: "shareholder", "co-founder", "business partner", "buyout offer", "40% ownership" → shareholder_dispute. "invoice", "client owes us money", "they haven't paid" → unpaid_invoice. "vendor billed us wrong", "supplier overcharged" → vendor_supplier_dispute. "embezzlement", "financial irregularities", "missing funds" → corporate_money_control. "contract broken", "agreement violated", "breach of contract" → contract_dispute. "on-call lawyer", "fractional counsel", "lawyer on retainer", "review this contract before I sign", "keep my corporate records up to date" → general_counsel_advisory. "tenant", "landlord", "lease dispute", "rent issue" → landlord_tenant. "closing on a house", "buying a condo", "selling our home" → residential_purchase_sale. "commercial property", "commercial lease", "leasing space for a business" → commercial_real_estate. "construction lien", "unpaid contractor" → construction_lien. "mortgage default", "power of sale" → mortgage_dispute. "deposit dispute", "deal fell through" → real_estate_litigation. "pre-construction condo", "builder delay" → preconstruction_condo. Decisive does not mean forced (rule 2a): never promote to a sub-type that adds or changes a material fact the lead did not state. Return '${currentMatterType}' itself when the description has no signal, or when none of the listed sub-types accurately matches what the lead described.`,
    input_type: 'single_select',
    options: peers,
    description: 'Tier: classifier. Group: routing.',
  };
}

/**
 * The synthetic language detector slot. Always injected (DR-039). The
 * option set includes English explicitly so the LLM can confirm 'en'
 * rather than returning null and relying on the engine's default.
 * Returning null on this field is reserved for languages outside the
 * supported set; mergeLlmResults treats null as "keep state.language as
 * is" (defaults to 'en' from initialiseState).
 */
function languageDetectorSlot(): ExtractionSlot {
  return {
    id: LANGUAGE_DETECTOR_FIELD,
    question:
      "Identify the language of the lead's description. Return the ISO 639-1 code of the lead's language: 'en' for English, 'fr' for French, 'es' for Spanish, 'pt' for Portuguese, 'zh' for Mandarin or Simplified Chinese, 'ar' for Arabic. Return null only if the language is outside this supported set.",
    input_type: 'single_select',
    options: ['en', 'fr', 'es', 'pt', 'zh', 'ar'],
    description: 'Tier: classifier. Group: routing.',
  };
}

/**
 * The synthetic classifier slot. Question text frames the task explicitly
 * as classification, not extraction, so the model picks a best-fit even
 * when the lead used a synonym, layperson phrasing, or a typo. Returning
 * null only for genuinely ambiguous descriptions.
 */
function matterTypeClassifierSlot(): ExtractionSlot {
  return {
    id: MATTER_TYPE_CLASSIFIER_FIELD,
    question:
      "Top-level classification task. Pick the matter-type bucket that best fits the lead's description, even if the lead used a synonym, typo, or layperson phrasing. Return null only if the description is genuinely too vague to map to any bucket. Examples: 'I want to start a corporation' / 'opening a business' / 'incorporating with a partner' → business_setup_advisory. 'I need an on-call lawyer for my business' / 'fractional general counsel' / 'review this contract before I sign' / 'keep my corporate records up to date' → general_counsel_advisory. 'I need a document notarized' / 'commissioner of oaths' / 'certified copy' / 'witness my signature' → notary_services. 'closing on a house' / 'buying a condo' / 'selling our home' → residential_purchase_sale. 'I was fired' / 'wrongful dismissal' / 'severance package' / 'workplace harassment' / 'unpaid wages' / 'employment contract' → employment_general. 'need a will' / 'estate planning' / 'power of attorney' / 'applying for probate' / 'contest a will' / 'when my mother passed' → estates_general. 'family matter' / 'divorce' / 'custody' / 'criminal charges' / 'car accident injury' → out_of_scope. Rule 2a applies: when the practice area is clear but no specific sub-type accurately matches what the lead described, return the area's general bucket (corporate_general, real_estate_general, employment_general, estates_general) rather than a specific sub-type that adds facts the lead did not state.",
    input_type: 'single_select',
    options: [...ALL_CANONICAL_MATTER_TYPES],
    description: 'Tier: classifier. Group: routing.',
  };
}

function slotToExtractionSlot(slot: SlotDefinition): ExtractionSlot {
  return {
    id: slot.id,
    question: slot.question,
    input_type: slot.input_type,
    options: slot.options?.map(o => o.value),
    description: describeSlot(slot),
  };
}

function describeSlot(slot: SlotDefinition): string {
  return `Tier: ${slot.tier}. Group: ${slot.question_group}.`;
}

// Builds the Gemini responseSchema for a given set of slots.
//
// Each slot is declared as a nullable string. We deliberately do NOT use the
// schema's `enum` constraint for single-select slots: Gemini enforces enum
// strictly and returns null when the model cannot produce the option exactly
// (notably, it struggles to reproduce the en-dash character in dollar ranges).
//
// Instead, the prompt instructs the model on valid options, and the API
// handler validates the response server-side with fuzzy matching that
// normalizes hyphen variants back to the canonical enum string.
export function buildResponseSchema(slots: ExtractionSlot[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const slot of slots) {
    properties[slot.id] = {
      type: 'string',
      nullable: true,
      description: slot.question,
    };
  }
  return {
    type: 'object',
    properties,
    required: slots.map(s => s.id),
  };
}
