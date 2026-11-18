import { createIntakeJsonGenerator, isTransientGenerationError, hasGenerationKey, intakeModel, operationalIntakeProvider } from './ai/intake-generation';
import type { EngineState, MatterType } from './screen-engine/types';
import { getExtractableSlots, buildResponseSchema } from './screen-engine/llm/schema';
import { buildSystemPrompt, buildUserPrompt } from './screen-engine/llm/prompt';

const MODEL = 'gemini-2.5-flash';
const TEMPERATURE = 0.1;
const MAX_DESCRIPTION_LENGTH = 4000;

// Retry policy for transient provider failures (429 rate limit, 5xx server,
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
  maxDescriptionLength = MAX_DESCRIPTION_LENGTH,
  provider = operationalIntakeProvider(),
  onRawModelText?: (text: string) => void,
): Promise<LlmExtractionResponse> {
  if (!hasGenerationKey(provider)) {
    return {
      extracted: {},
      mode: 'disabled',
      reason: provider === 'openai' ? 'OpenAI API key missing' : 'No Gemini API key configured (set GOOGLE_AI_API_KEY or GEMINI_API_KEY)',
    };
  }

  const trimmed = (description ?? '').slice(0, maxDescriptionLength);
  if (!trimmed.trim()) {
    return { extracted: {}, mode: 'error', reason: 'empty description' };
  }

  const matterType: MatterType = state.matter_type ?? 'unknown';
  const slots = getExtractableSlots(matterType, state.family_enabled === true);
  if (slots.length === 0) {
    return { extracted: {}, mode: 'live', reason: 'no_applicable_slots' };
  }

  const responseSchema = buildResponseSchema(slots);
  const basePrompt = buildSystemPrompt();
  const systemPrompt = provider === 'openai'
    ? basePrompt + '\nFor legal status, report only what the caller expressly confirms. Plans to sign or file later do not establish whether anything was previously signed or filed. Leave signed_release null unless the caller explicitly reports signing or not signing. An absence answer covering multiple documents requires explicit confirmation for every document. A missing court order alone leaves the agreement status unknown.'
    : basePrompt;
  const userPrompt = buildUserPrompt(trimmed, matterType, slots);

  const generate = createIntakeJsonGenerator({
    provider,
    model: provider === 'openai' ? intakeModel() : MODEL,
    name: 'screen_extraction',
    instructions: systemPrompt,
    schema: responseSchema,
    temperature: TEMPERATURE,
    maxOutputTokens: 4096,
    timeoutMs: 12000,
  });
  let result: Awaited<ReturnType<typeof generate>> | null = null;
  let lastErr: unknown = null;
  let attempt = 0;

  try {
    for (attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
      try {
        result = await generate(userPrompt);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_LLM_ATTEMPTS && isTransientGenerationError(err)) {
          const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 1200;
          console.warn(
            `[screen-llm-server] transient provider error on attempt ${attempt}, retrying in ${wait}ms:`,
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
      const transient = lastErr ? isTransientGenerationError(lastErr) : false;
      return {
        extracted: {},
        mode: transient ? 'degraded' : 'error',
        reason,
        attempts: attempt,
      };
    }

    const raw = result.text;
    onRawModelText?.(raw);

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
      s.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').trim();
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

    return {
      extracted: cleaned,
      dropped,
      mode: 'live',
      attempts: attempt,
      tokens: {
        prompt: result.inputTokens,
        completion: result.outputTokens,
      },
    };
  } catch (err) {
    // Unexpected post-LLM error (json shape, response normalization). Not
    // a transport failure; do not retry.
    return {
      extracted: {},
      mode: 'error',
      reason: err instanceof Error ? err.message : String(err),
      attempts: attempt,
    };
  }
}
