/**
 * Gemini call for the Firm Voice Builder interactive tool. Retry policy and
 * env key resolution mirror the sibling call sites (screen-llm-server.ts,
 * assist/generate-answer.ts); duplicated here rather than factored into a
 * shared wrapper per BUILD_PLAN_firm_voice_builder_tool_v1.md decision tree
 * D1 (no existing shared client found; each site already rolls its own).
 *
 * Unlike the extraction call sites, this is a genuine expressive multi-turn
 * conversation (the interview itself, plus creative calibration writing and
 * the final profile), not a structured-extraction call, so no JSON response
 * schema is used. The model emits plain text carrying the [SECTION:n] tag
 * and, on the final turn, the profile markers (system-prompt.ts).
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_PROMPT } from "./system-prompt";
import type { GeminiContent } from "./turn";

const MODEL = process.env.FIRM_VOICE_BUILDER_MODEL ?? "gemini-2.5-flash";
// Conversational and creative (calibration alternatives, proof-of-work
// pieces, matching a lawyer's rhythm), not factual extraction, so a higher
// temperature than the assist Q&A tool's 0.2.
const TEMPERATURE = 0.8;
const MAX_OUTPUT_TOKENS = 16_384;

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [400, 1200];

export type FirmVoiceTurnMode = "live" | "disabled" | "error";

export interface FirmVoiceTurnResult {
  mode: FirmVoiceTurnMode;
  text?: string;
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

export async function runFirmVoiceBuilderTurn(contents: GeminiContent[]): Promise<FirmVoiceTurnResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return { mode: "disabled", reason: "No Gemini API key configured (set GOOGLE_AI_API_KEY or GEMINI_API_KEY)" };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await model.generateContent({ contents: contents as never });
      const text = result.response.text();
      if (!text || !text.trim()) {
        return { mode: "error", reason: "empty response from model" };
      }
      return { mode: "live", text };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS && isTransientError(err)) {
        const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 1200;
        console.warn(
          `[firm-voice-builder/gemini] transient error on attempt ${attempt}, retrying in ${wait}ms:`,
          err instanceof Error ? err.message : String(err),
        );
        await sleep(wait);
        continue;
      }
      break;
    }
  }

  return { mode: "error", reason: lastErr instanceof Error ? lastErr.message : String(lastErr) };
}
