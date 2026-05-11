// Client-side wrapper for the LLM extraction layer.
// Calls the serverless /api/extract endpoint, merges the results into the
// EngineState, and gracefully degrades to regex-only when the endpoint is
// unavailable or no API key is configured.

import type { EngineState, SupportedLanguage } from '../types';
import { computeBand } from '../band';
import { computeCoreCompleteness, getDecisionGap } from '../selector';
import { classificationForMatterType, isValidMatterType } from '../extractor';
import { MATTER_TYPE_CLASSIFIER_FIELD, LANGUAGE_DETECTOR_FIELD } from './schema';

const VALID_SUPPORTED_LANGUAGES = new Set<string>(['en', 'fr', 'es', 'pt', 'zh', 'ar']);

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
        language_needs_confirm: state.language_needs_confirm,
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

export function mergeLlmResults(
  state: EngineState,
  extracted: Record<string, string | null>,
): EngineState {
  // ── Classifier field first ────────────────────────────────────────────
  // When state.matter_type was 'unknown', the schema injected a synthetic
  // __matter_type field. If the LLM picked a valid bucket, update the
  // matter-type-driven state fields BEFORE merging slots so subsequent
  // logic (selectNextSlot, completeness) reads the new matter type.
  let working: EngineState = state;

  // ── Language confirm field ────────────────────────────────────────────────
  // When franc was uncertain, the schema injected __detected_language. Update
  // state.language if the LLM returned a valid supported language code.
  if (working.language_needs_confirm) {
    const llmLang = extracted[LANGUAGE_DETECTOR_FIELD];
    if (llmLang && typeof llmLang === 'string' && isValidSupportedLanguage(llmLang)) {
      working = {
        ...working,
        language: llmLang as SupportedLanguage,
        language_needs_confirm: undefined,
      };
    }
  }

  if (state.matter_type === 'unknown') {
    const llmMatter = extracted[MATTER_TYPE_CLASSIFIER_FIELD];
    if (
      llmMatter &&
      typeof llmMatter === 'string' &&
      isValidMatterType(llmMatter) &&
      llmMatter !== 'unknown' &&
      !isNonAnswer(llmMatter)
    ) {
      const classification = classificationForMatterType(llmMatter);
      working = { ...working, ...classification };
    }
  }

  const slots = { ...working.slots };
  const slotMeta = { ...working.slot_meta };
  let touched = 0;

  for (const [slotId, value] of Object.entries(extracted)) {
    // Skip the synthetic classifier field — already handled above.
    if (slotId === MATTER_TYPE_CLASSIFIER_FIELD) continue;

    if (value === null || value === '' || value === undefined) continue;
    // Drop non-answer literals — see comment block above.
    if (isNonAnswer(value)) continue;

    // Don't override regex-found values
    const existing = slots[slotId];
    const existingMeta = slotMeta[slotId];
    if (existing && existing !== '' && existingMeta && existingMeta.source === 'explicit') {
      continue;
    }

    slots[slotId] = value;
    slotMeta[slotId] = {
      source: 'inferred',
      evidence: 'LLM extraction from initial description',
      confidence: 0.7,
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
