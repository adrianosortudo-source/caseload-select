// Client-side wrapper for the LLM extraction layer.
// Calls the serverless /api/extract endpoint, merges the results into the
// EngineState, and gracefully degrades to regex-only when the endpoint is
// unavailable or no API key is configured.

import type { EngineState, MatterType, SupportedLanguage } from '../types';
import { computeBand } from '../band';
import { computeCoreCompleteness, getDecisionGap } from '../selector';
import { classificationForMatterType, isValidMatterType } from '../extractor';
import { SLOT_REGISTRY } from '../slotRegistry';
import { MATTER_TYPE_CLASSIFIER_FIELD, LANGUAGE_DETECTOR_FIELD } from './schema';

const VALID_SUPPORTED_LANGUAGES = new Set<string>(['en', 'fr', 'es', 'pt', 'zh', 'ar']);

// Matter types that act as routing catch-alls — the LLM's __matter_type
// classifier is allowed to PROMOTE these to a more specific sub-type
// when the schema injected the classifier slot. Mirrors the chip-UI
// routing question that the web widget asks on these matter types.
const ROUTING_CATCH_ALL_MATTER_TYPES: ReadonlySet<MatterType> = new Set([
  'unknown',
  'corporate_general',
  'real_estate_general',
  'employment_general',
  'estates_general',
]);

function isValidSupportedLanguage(value: string): boolean {
  return VALID_SUPPORTED_LANGUAGES.has(value);
}

export interface LlmExtractionResponse {
  extracted: Record<string, string | null>;
  mode: 'live' | 'disabled' | 'error';
  reason?: string;
  tokens?: { prompt?: number; completion?: number };
}

const REQUEST_TIMEOUT_MS = 12_000;

export async function llmExtract(
  description: string,
  state: EngineState,
): Promise<LlmExtractionResponse> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        matter_type: state.matter_type,
        already_extracted: state.slots,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { extracted: {}, mode: 'error', reason: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return {
      extracted: data.extracted ?? {},
      mode: data.mode ?? 'live',
      reason: data.reason,
      tokens: data.tokens,
    };
  } catch (err) {
    return {
      extracted: {},
      mode: 'error',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// Merges LLM-extracted slot values into state. Critically:
//  • Regex pass results stay authoritative — LLM never overrides what regex
//    already found (those are deterministic, pattern-matched, high-trust).
//  • LLM only fills slots that are still empty after the regex pass.
//  • LLM-filled slots are marked source: 'inferred' so the brief can show
//    provenance honestly.
//  • Non-answer values ("Not sure", "Not sure yet", "I don't know", etc.)
//    are dropped at merge time. The system prompt's NULL RULE asks the
//    model to return null for unstated topics, but Gemini sometimes picks
//    a literal "Not sure" option as a safe fallback. Treating those as
//    null keeps the brief honest — slots stay empty rather than filling
//    the lawyer view with low-signal "inferred" non-answers.
//
//  Exception (task #96 fix, 2026-05-26): when the lead's own text contains
//  explicit uncertainty markers ("not sure", "don't know", "no idea",
//  "haven't decided", "still figuring out", etc.), the LLM's "Not sure"
//  extraction IS the lead's literal answer — keep it. Filtering in that
//  case is what produced the felt-bug "Phase C discovery asks slots
//  already inferred from turn 1": the lead said "not sure on amount",
//  the LLM correctly extracted "Not sure" for amount_at_stake, the
//  merge dropped it, and the discovery loop then asked the same question.
const NON_ANSWER_LITERALS = new Set([
  'not sure',
  'not sure yet',
  'not yet',
  "i don't know",
  'i dont know',
  'unsure',
  'no response',
  'unknown',
  'n/a',
  'na',
  'none',
  'not applicable',
]);

function isNonAnswer(value: string): boolean {
  return NON_ANSWER_LITERALS.has(value.trim().toLowerCase());
}

/**
 * Detect explicit uncertainty in the lead's own text. When present, the
 * LLM's "Not sure" / "Unknown" / "I don't know" extractions are treated
 * as the lead's actual answer and are PRESERVED through the merge,
 * rather than filtered as Gemini hedging. See the comment block above
 * NON_ANSWER_LITERALS for full rationale.
 *
 * Markers cover common phrasings of uncertainty. Word-boundary-ish:
 * matches as substrings inside the lowered text. False positive risk is
 * low because these phrases are conversationally rare outside a true
 * uncertainty context.
 */
const UNCERTAINTY_MARKERS: readonly string[] = [
  'not sure',
  "don't know",
  'dont know',
  'no idea',
  "haven't decided",
  'havent decided',
  'still figuring',
  "haven't figured",
  'havent figured',
  'unsure',
  'unclear',
  'tbd',
  'to be determined',
  "can't say",
  'cant say',
  'no clue',
];

export function leadExpressedUncertainty(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return UNCERTAINTY_MARKERS.some((m) => lower.includes(m));
}

/**
 * True when the given slot has the given value listed as one of its
 * `single_select` options (case-insensitive). The preservation gate
 * for non-answer literals (Codex pushback 2026-05-26): we only keep an
 * LLM-extracted "Not sure" / "Unknown" / etc. when (a) the lead's text
 * shows uncertainty AND (b) the slot's own option set legitimises that
 * value. Without the second check, "I'm not sure on the amount" would
 * incorrectly preserve "Not sure" for every slot the LLM hedged on
 * (e.g. relationship_to_other_party = "Not sure" when the lead already
 * said "my business partner").
 *
 * Free-text slots return false here because there's no option set to
 * validate against — the historical filter behaviour is preserved for
 * those (drop non-answer literals).
 */
function slotOptionsIncludeValue(slotId: string, value: string): boolean {
  const slot = SLOT_REGISTRY.find((s) => s.id === slotId);
  if (!slot) return false;
  if (slot.input_type !== 'single_select') return false;
  if (!slot.options || slot.options.length === 0) return false;
  const target = value.trim().toLowerCase();
  for (const opt of slot.options) {
    const optValue = typeof opt === 'string' ? opt : opt.value;
    if (typeof optValue === 'string' && optValue.toLowerCase() === target) return true;
  }
  return false;
}

export function mergeLlmResults(
  state: EngineState,
  extracted: Record<string, string | null>,
): EngineState {
  let working: EngineState = state;

  // ── Language field (DR-039) ──────────────────────────────────────────
  // The LLM is authoritative for language detection. The schema's
  // __detected_language field is ALWAYS present (see schema.ts) and the
  // LLM returns the ISO 639-1 code on every call. Update state.language
  // when the LLM returned a valid supported code. Null / unsupported is
  // a no-op (state.language stays as initialised, defaulting to 'en').
  const llmLang = extracted[LANGUAGE_DETECTOR_FIELD];
  if (llmLang && typeof llmLang === 'string' && isValidSupportedLanguage(llmLang)) {
    working = { ...working, language: llmLang as SupportedLanguage };
  }

  // ── Classifier field ──────────────────────────────────────────────────
  // When state.matter_type was a routing catch-all (unknown, or one of
  // the *_general buckets like corporate_general / real_estate_general),
  // the schema injected the synthetic __matter_type field. If the LLM
  // picked a valid SPECIFIC bucket, update the matter-type-driven state
  // fields BEFORE merging slots so subsequent logic (selectNextSlot,
  // completeness) reads the new matter type.
  //
  // The LLM wins over a regex routing catch-all because the LLM
  // understands multilingual context and synonyms the keyword patterns
  // miss. For *_general buckets specifically, this mirrors the chip-UI
  // path: applyAnswer(state, routingSlotId, value) calls
  // rerouteFromCorporateGeneral / rerouteFromRealEstateGeneral when a
  // chip is clicked. classificationForMatterType reproduces the same
  // intent_family + dispute_family + advisory_subtrack derivation.
  //
  // Safety: schema.ts ROUTING_PEER_SETS scopes the LLM's choice to
  // within-practice-area sub-types, so Gemini cannot hijack a corporate
  // matter into wrongful_dismissal. The isValidMatterType guard here is
  // a belt-and-suspenders check; the practice-area filter in the
  // schema's option list is the primary defence.
  if (ROUTING_CATCH_ALL_MATTER_TYPES.has(state.matter_type)) {
    const llmMatter = extracted[MATTER_TYPE_CLASSIFIER_FIELD];
    if (
      llmMatter &&
      typeof llmMatter === 'string' &&
      isValidMatterType(llmMatter) &&
      llmMatter !== 'unknown' &&
      llmMatter !== state.matter_type &&
      !isNonAnswer(llmMatter)
    ) {
      const classification = classificationForMatterType(llmMatter);
      working = { ...working, ...classification };
    }
  }

  const slots = { ...working.slots };
  const slotMeta = { ...working.slot_meta };
  let touched = 0;

  // Pre-compute: does the lead's text show explicit uncertainty? If yes,
  // "Not sure" extractions are preserved as legitimate answers (the lead
  // literally said they don't know). If no, "Not sure" is treated as
  // Gemini hedging and dropped, preserving the historical behaviour.
  // See NON_ANSWER_LITERALS comment block + task #96.
  const leadUncertain = leadExpressedUncertainty(working.input);

  for (const [slotId, value] of Object.entries(extracted)) {
    // Skip the synthetic classifier field — already handled above.
    if (slotId === MATTER_TYPE_CLASSIFIER_FIELD) continue;
    // Skip the synthetic language-confirm field — already handled above. Not
    // skipping it here would let mergeLlmResults persist a language code
    // (e.g. "fr") as if it were a user's slot answer, leaking detector
    // output into state.slots.
    if (slotId === LANGUAGE_DETECTOR_FIELD) continue;

    if (value === null || value === '' || value === undefined) continue;
    // Drop non-answer literals — except when BOTH (a) the lead's own
    // text shows uncertainty AND (b) the slot's own option set
    // explicitly includes this value. The two-gate check (Codex
    // pushback 2026-05-26) prevents an uncertainty marker about one
    // topic from preserving "Not sure" hedges across every other
    // slot the LLM might have returned a non-answer for.
    const nonAnswer = isNonAnswer(value);
    if (nonAnswer) {
      if (!leadUncertain) continue;
      if (!slotOptionsIncludeValue(slotId, value)) continue;
    }

    // Don't override regex-found values
    const existing = slots[slotId];
    const existingMeta = slotMeta[slotId];
    if (existing && existing !== '' && existingMeta && existingMeta.source === 'explicit') {
      continue;
    }

    slots[slotId] = value;
    slotMeta[slotId] = {
      // 2026-06-07 provenance split: every LLM extraction is tagged
      // `llm_inferred`. This is THE key change: gating predicates
      // (isUserAnswered) treat this source as NOT-answered, so the
      // engine keeps asking the user, even when the model has a guess.
      // The value stays in state for the brief and for downstream
      // ranking, but it does not suppress a follow-up question.
      source: 'llm_inferred',
      evidence: nonAnswer
        ? 'LLM extraction (lead expressed uncertainty in text)'
        : 'LLM extraction from initial description',
      confidence: nonAnswer ? 0.6 : 0.7,
    };
    touched++;
  }

  // If we updated the matter type but didn't merge any slots, still
  // return the post-classification state.
  if (touched === 0) return working;

  let updated: EngineState = {
    ...working,
    slots,
    slot_meta: slotMeta,
  };

  // Recompute derived state since slot values changed
  updated = { ...updated, coreCompleteness: computeCoreCompleteness(updated) };
  const bandResult = computeBand(updated);
  updated = {
    ...updated,
    band: bandResult.band,
    confidence: bandResult.confidence,
    currentGap: getDecisionGap(updated),
  };

  return updated;
}
