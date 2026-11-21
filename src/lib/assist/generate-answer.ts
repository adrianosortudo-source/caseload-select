import type { AiProvider } from '../ai/openai';
import { createIntakeJsonGenerator, isTransientGenerationError, hasGenerationKey } from '../ai/intake-generation';
import {
  ANSWER_MODEL,
  ANSWER_TEMPERATURE,
  ANSWER_RESPONSE_SCHEMA,
  buildAnswerSystemPrompt,
  buildAnswerUserPrompt,
  type AnswerModelResponse,
  type RetrievedChunk,
} from './answer-prompt';

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [400, 1200];

export type GenerateAnswerMode = 'live' | 'disabled' | 'error';

export interface GenerateAnswerResult {
  mode: GenerateAnswerMode;
  response?: AnswerModelResponse;
  model?: string;
  reason?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const KNOWN_INTENTS = new Set(['informational', 'case_specific', 'out_of_corpus']);

/**
 * Validates and narrows the raw parsed JSON to AnswerModelResponse. Returns
 * null on any shape violation (caller treats this as a parse failure, same
 * as invalid JSON), so a malformed model response never reaches the visitor
 * as a half-typed object.
 */
function toAnswerModelResponse(raw: unknown): AnswerModelResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.intent !== 'string' || !KNOWN_INTENTS.has(obj.intent)) return null;
  if (typeof obj.answer_html !== 'string') return null;
  if (!Array.isArray(obj.source_page_ids) || !obj.source_page_ids.every((id) => typeof id === 'string')) return null;
  return {
    intent: obj.intent as AnswerModelResponse['intent'],
    answer_html: obj.answer_html,
    source_page_ids: obj.source_page_ids as string[],
  };
}

export async function generateAnswer(
  question: string,
  firmName: string,
  chunks: RetrievedChunk[],
  provider: AiProvider,
): Promise<GenerateAnswerResult> {
  if (!hasGenerationKey(provider)) {
    return { mode: 'disabled', reason: 'Firm Assist generation key missing' };
  }

  const model = provider === 'openai' ? (process.env.FIRM_ASSIST_OPENAI_MODEL?.trim() || 'gpt-6-luna') : ANSWER_MODEL;
  const generate = createIntakeJsonGenerator({
    provider,
    model,
    instructions: buildAnswerSystemPrompt(firmName),
    name: 'firm_assist_answer',
    schema: ANSWER_RESPONSE_SCHEMA,
    temperature: ANSWER_TEMPERATURE,
    maxOutputTokens: 1536,
    timeoutMs: 12000,
  });
  const userPrompt = buildAnswerUserPrompt(question, chunks);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { text: raw } = await generate(userPrompt);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { mode: 'error', reason: 'parse_failed' };
      }
      const response = toAnswerModelResponse(parsed);
      if (!response) {
        return { mode: 'error', reason: 'invalid_response_shape' };
      }
      return { mode: 'live', response, model };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS && isTransientGenerationError(err)) {
        const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 1200;
        console.warn(`[assist/generate-answer] transient error on attempt ${attempt}, retrying in ${wait}ms:`, err instanceof Error ? err.message : String(err));
        await sleep(wait);
        continue;
      }
      break;
    }
  }

  return { mode: 'error', reason: lastErr instanceof Error ? lastErr.message : String(lastErr) };
}
