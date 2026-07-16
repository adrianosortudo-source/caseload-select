/**
 * Gemini answer generation for Firm Assist (DR-100). Retry policy and env
 * key resolution mirror screen-llm-server.ts and gemini-embed.ts.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
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
  reason?: string;
}

function resolveApiKey(): string | null {
  return process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? null;
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b(429|408|500|502|503|504)\b/.test(msg)) return true;
  if (/(ECONN|ETIMEDOUT|fetch failed|network)/i.test(msg)) return true;
  if (/quota/i.test(msg)) return true;
  return false;
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
): Promise<GenerateAnswerResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return { mode: 'disabled', reason: 'No Gemini API key configured (set GOOGLE_AI_API_KEY or GEMINI_API_KEY)' };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: ANSWER_MODEL,
    systemInstruction: buildAnswerSystemPrompt(firmName),
    generationConfig: {
      temperature: ANSWER_TEMPERATURE,
      responseMimeType: 'application/json',
      responseSchema: ANSWER_RESPONSE_SCHEMA as never,
    },
  });

  const userPrompt = buildAnswerUserPrompt(question, chunks);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await model.generateContent(userPrompt);
      const raw = result.response.text();
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
      return { mode: 'live', response };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS && isTransientError(err)) {
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
