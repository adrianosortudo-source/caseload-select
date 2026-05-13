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

// Retry policy for transient Gemini failures (429 rate limit, 5xx server,
// network errors). Bounded so a sustained outage degrades to regex-only
// extraction rather than blocking intake indefinitely.
const MAX_LLM_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [400, 1200]; // gaps before retry 2 and 3

export interface LlmExtractionResponse {
  extracted: Record<string, string | null>;
  mode: 'live' | 'disabled' | 'error' | 'degraded';
  reason?: string;
  tokens?: { prompt?: number; completion?: number };
  dropped?: Record<string, string>;
  /** Number of attempts made (1 = succeeded on first try; >1 = retried). */
  attempts?: number;
}

/**
 * True for errors that are worth retrying. Gemini SDK errors include the
 * HTTP status in the message ("[GoogleGenerativeAI Error]: 429 Too Many
 * Requests" etc.) or surface as fetch-style network errors. Treat 429
 * (rate limit / quota), 408 (timeout), 5xx (server), and ECONN errors as
 * transient. 400 / 401 / 403 / 404 are caller / config bugs, do not retry.
 */
function isTransientLlmError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b(429|408|500|502|503|504)\b/.test(msg)) return true;
  if (/(ECONN|ETIMEDOUT|fetch failed|network)/i.test(msg)) return true;
  if (/quota/i.test(msg)) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  // Bounded retry on transient Gemini failures. The previous implementation
  // ran a single generateContent() and any 429/5xx surfaced as mode='error',
  // which left the caller running regex-only extraction even when a quick
  // retry would have succeeded.
  let result: Awaited<ReturnType<typeof model.generateContent>> | null = null;
  let lastErr: unknown = null;
  let attempt = 0;

  try {
    for (attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
      try {
        result = await model.generateContent(userPrompt);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_LLM_ATTEMPTS && isTransientLlmError(err)) {
          const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 1200;
          console.warn(
            `[screen-llm-server] transient Gemini error on attempt ${attempt}, retrying in ${wait}ms:`,
            err instanceof Error ? err.message : String(err),
          );
          await sleep(wait);
          continue;
        }
        break;
      }
    }

    if (!result) {
      const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
      const transient = lastErr ? isTransientLlmError(lastErr) : false;
      return {
        extracted: {},
        mode: transient ? 'degraded' : 'error',
        reason,
        attempts: attempt,
      };
    }

    const raw = result.response.text();

    let parsed: Record<string, string | null> = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { extracted: {}, mode: 'error', reason: 'parse_failed', attempts: attempt };
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
      attempts: attempt,
      tokens: {
        prompt: usage?.promptTokenCount,
        completion: usage?.candidatesTokenCount,
      },
    };
  } catch (err) {
    // Unexpected post-LLM error (json shape, response normalization). Not
    // a Gemini transport failure; do not retry.
    return {
      extracted: {},
      mode: 'error',
      reason: err instanceof Error ? err.message : String(err),
      attempts: attempt,
    };
  }
}
