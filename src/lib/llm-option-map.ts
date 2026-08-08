/**
 * Server-side LLM call for the option-mapping fallback (C3, 2026-08-07).
 * See llm-option-map-pure.ts for the rationale and the prompt/parse logic
 * this wraps.
 *
 * Mirrors screen-llm-server.ts's conventions deliberately: lives OUTSIDE
 * `src/lib/screen-engine/` (no engine-sync implications either way, but
 * consistency matters), same env var resolution (GOOGLE_AI_API_KEY first,
 * GEMINI_API_KEY fallback), same model, graceful `{value:null,
 * mode:'disabled'}` when no key is configured — the caller falls through
 * to the existing sticky re-ask unchanged.
 *
 * Retry policy differs on purpose: ONE retry (not screen-llm-server's
 * three). This call sits in the middle of a live chat turn — the lead is
 * waiting for a reply — so a slow, heavily-retried failure is worse than
 * falling through to the deterministic clarifier quickly.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  buildOptionMapSystemPrompt,
  buildOptionMapUserPrompt,
  buildOptionMapResponseSchema,
  parseOptionMapResponse,
  type OptionMapOption,
} from './llm-option-map-pure';

const MODEL = 'gemini-2.5-flash';
const TEMPERATURE = 0;
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 400;

export interface OptionMapArgs {
  questionLabel: string;
  options: OptionMapOption[];
  reply: string;
  language: string;
}

export interface OptionMapResult {
  value: string | null;
  mode: 'live' | 'disabled' | 'error';
}

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|408|500|502|503|504)\b/.test(msg) || /(ECONN|ETIMEDOUT|fetch failed|network|quota)/i.test(msg);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function llmMapOptionReply(args: OptionMapArgs): Promise<OptionMapResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { value: null, mode: 'disabled' };
  }

  if (!args.reply?.trim() || args.options.length === 0) {
    return { value: null, mode: 'error' };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: buildOptionMapSystemPrompt(),
    generationConfig: {
      temperature: TEMPERATURE,
      responseMimeType: 'application/json',
      responseSchema: buildOptionMapResponseSchema() as never,
    },
  });

  const userPrompt = buildOptionMapUserPrompt(args);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await model.generateContent(userPrompt);
      const parsed = parseOptionMapResponse(result.response.text());
      return { value: parsed.value, mode: 'live' };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS && isTransientError(err)) {
        console.warn(
          `[llm-option-map] transient error on attempt ${attempt}, retrying:`,
          err instanceof Error ? err.message : String(err),
        );
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }
      break;
    }
  }

  console.warn(
    '[llm-option-map] failed, falling through to deterministic clarifier:',
    lastErr instanceof Error ? lastErr.message : String(lastErr),
  );
  return { value: null, mode: 'error' };
}
