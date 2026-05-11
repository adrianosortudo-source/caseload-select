/**
 * Server-side LLM extractor for the screen engine.
 *
 * Lives OUTSIDE `src/lib/screen-engine/` so the engine port can stay a
 * byte-for-byte mirror of the sandbox (the sandbox's `llm/extractor.ts`
 * does `fetch('/api/extract')` because it runs in the browser; this file
 * is the server-side equivalent that talks to Gemini directly).
 *
 * Public shape mirrors the sandbox's `llmExtract` return so the consumer
 * (voice-intake endpoint) can pipe the result into the engine's
 * `mergeLlmResults` without adapter glue.
 *
 * Mirrors `CaseLoadScreen_2.0_2026-05-03/api/extract.ts` request shape:
 *   { description, matter_type, already_extracted } → { extracted, mode }
 *
 * Graceful degradation: if GEMINI_API_KEY is missing, returns
 * `{ extracted: {}, mode: 'disabled' }`. The caller proceeds with
 * regex-only extraction and the brief is best-effort.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { EngineState, MatterType } from './screen-engine/types';
import { getExtractableSlots, buildResponseSchema } from './screen-engine/llm/schema';
import { buildSystemPrompt, buildUserPrompt } from './screen-engine/llm/prompt';

const MODEL = 'gemini-2.5-flash';
const TEMPERATURE = 0.1;
const MAX_DESCRIPTION_LENGTH = 4000;

export interface LlmExtractionResponse {
  extracted: Record<string, string | null>;
  mode: 'live' | 'disabled' | 'error';
  reason?: string;
  tokens?: { prompt?: number; completion?: number };
  dropped?: Record<string, string>;
}

/**
 * Server-side equivalent of the sandbox's `llmExtract`. Same input/output
 * shape; the caller does not need to know whether it ran via HTTP or
 * direct SDK.
 */
export async function llmExtractServer(
  description: string,
  state: EngineState,
): Promise<LlmExtractionResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { extracted: {}, mode: 'disabled', reason: 'GEMINI_API_KEY not configured' };
  }

  const trimmed = (description ?? '').slice(0, MAX_DESCRIPTION_LENGTH);
  if (!trimmed.trim()) {
    return { extracted: {}, mode: 'error', reason: 'empty description' };
  }

  const matterType: MatterType = state.matter_type ?? 'unknown';
  if (matterType === 'out_of_scope') {
    return { extracted: {}, mode: 'live', reason: 'out_of_scope' };
  }

  const slots = getExtractableSlots(matterType, state.language_needs_confirm);
  if (slots.length === 0) {
    return { extracted: {}, mode: 'live', reason: 'no_applicable_slots' };
  }

  const responseSchema = buildResponseSchema(slots);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(trimmed, matterType, slots);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature: TEMPERATURE,
        responseMimeType: 'application/json',
        responseSchema: responseSchema as never,
      },
    });

    const result = await model.generateContent(userPrompt);
    const raw = result.response.text();

    let parsed: Record<string, string | null> = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { extracted: {}, mode: 'error', reason: 'parse_failed' };
    }

    // Filter + normalize enums (same logic as sandbox's api/extract.ts)
    const slotsById = new Map(slots.map((s) => [s.id, s]));
    const cleaned: Record<string, string> = {};
    const dropped: Record<string, string> = {};
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
    for (const [k, v] of Object.entries(parsed)) {
      const slot = slotsById.get(k);
      if (!slot) continue;
      if (v === null || v === '' || v === undefined) continue;
      const value = String(v);
      if (slot.input_type === 'single_select' && slot.options) {
        if (slot.options.includes(value)) {
          cleaned[k] = value;
          continue;
        }
        const normValue = normalize(value);
        const canonical = slot.options.find((opt) => normalize(opt) === normValue);
        if (canonical) {
          cleaned[k] = canonical;
          continue;
        }
        dropped[k] = value;
        continue;
      }
      cleaned[k] = value;
    }

    const usage = result.response.usageMetadata;
    return {
      extracted: cleaned,
      dropped,
      mode: 'live',
      tokens: {
        prompt: usage?.promptTokenCount,
        completion: usage?.candidatesTokenCount,
      },
    };
  } catch (err) {
    return {
      extracted: {},
      mode: 'error',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
