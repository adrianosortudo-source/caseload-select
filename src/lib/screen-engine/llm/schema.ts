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
 * Injected when franc language confidence < threshold on turn 1. Asks the LLM
 * to confirm the detected language from the supported set. Returns null for
 * English (no indicator needed) or languages outside the supported set.
 * Same double-underscore convention as MATTER_TYPE_CLASSIFIER_FIELD.
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

export function getExtractableSlots(matterType: MatterType, languageNeedsConfirm?: boolean): ExtractionSlot[] {
  // Language confirm slot goes first so the LLM resolves language before
  // attempting slot extraction. Only injected when franc was uncertain.
  const prefix: ExtractionSlot[] = languageNeedsConfirm ? [languageDetectorSlot()] : [];

  // For unknown matter, return routing-level slots so the LLM can help
  // disambiguate within an area. Plus inject the special matter-type
  // classifier field at the head of the catalogue so the LLM picks the
  // top-level bucket from the canonical list.
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

  return [
    ...prefix,
    ...getSlotsForMatter(matterType).filter(isLlmAllowed).map(slotToExtractionSlot),
  ];
}

/**
 * The synthetic language detector slot. Injected when franc confidence is low.
 * Options are the five non-English supported languages; null means English.
 */
function languageDetectorSlot(): ExtractionSlot {
  return {
    id: LANGUAGE_DETECTOR_FIELD,
    question:
      "Identify the language of the lead's description. Return one of the option codes if the lead wrote in that language; return null if English or if the language is not in the supported set.",
    input_type: 'single_select',
    options: ['fr', 'es', 'pt', 'zh', 'ar'],
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
      "Top-level classification task. Pick the matter-type bucket that best fits the lead's description, even if the lead used a synonym, typo, or layperson phrasing. Return null only if the description is genuinely too vague to map to any bucket. For 'I want to start a corporation' or 'opening a business' or 'incorporating with a partner', pick business_setup_advisory. For 'closing on a house' or 'buying a condo' or 'selling our home', pick residential_purchase_sale. For 'family matter' or 'divorce' or 'custody' or 'criminal' or 'personal injury', pick out_of_scope.",
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
