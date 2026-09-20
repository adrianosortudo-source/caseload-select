/**
 * Why Your Firm · Assist
 *
 * A lawyer writes a custom differentiator in their own words and presses
 * "Tighten this claim". This module validates that request, asks Gemini for a
 * tighter version in JSON mode, and validates what comes back.
 *
 * ADVISORY ONLY, AND THAT IS THE WHOLE POSTURE
 * The deterministic filter in compliance.ts stays the gate, in the browser and
 * again on the server when the brief is assembled. Nothing here blocks a
 * claim, rewrites one without being asked, or decides anything on the lawyer's
 * behalf. A failed call costs the lawyer nothing: their wording stands and
 * every check still runs (copy.assist.unavailable says exactly that).
 *
 * NOTHING IS STORED
 * The claim is processed and dropped. No database, no analytics row, and no
 * log line carrying the lawyer's text, including on the retry path: the tool's
 * privacy line (copy.tool.privacyNoGateAssist) names this one send as its only
 * exception, and it promises the text is not kept.
 *
 * Env key resolution, the mode union, and the transient-error retry mirror the
 * sibling Gemini call sites (assist/generate-answer.ts,
 * firm-voice-builder/gemini.ts); duplicated per the same decision those made,
 * since no shared client exists in this app.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { COMPLIANCE_RULES } from "./compliance";
import { CATEGORIES, type Category } from "./differentiators";
import {
  ASSIST_RESPONSE_SCHEMA,
  buildAssistSystemPrompt,
  buildAssistUserPrompt,
} from "./assist-prompt";

const MODEL = process.env.WHY_YOUR_FIRM_ASSIST_MODEL ?? "gemini-2.5-flash";
// Disciplined rewriting of one sentence the lawyer already wrote, not creative
// writing: low temperature, unlike the Firm Voice Builder tool's 0.8.
const TEMPERATURE = 0.2;
// One sentence, one category id, and at most five one-line notes. 1024 tokens
// is already generous for that.
const MAX_OUTPUT_TOKENS = 1024;

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [400, 1200];

/** Matches the client-side field caps; anything longer is not a claim. */
export const MAX_CLAIM_LENGTH = 500;
export const MAX_PROOF_LENGTH = 500;
/** The suggestion is advisory, so an over-long concern list is trimmed, not rejected. */
export const MAX_CONCERNS = 5;

export interface AssistRequest {
  claim: string;
  proof?: string;
}

export interface AssistConcern {
  ruleId: string;
  note: string;
}

export interface AssistResult {
  tightenedClaim: string;
  category: Category;
  concerns: AssistConcern[];
}

export type AssistMode = "live" | "disabled" | "error";

export interface RunAssistResult {
  mode: AssistMode;
  result?: AssistResult;
  reason?: string;
}

export type ValidateAssistBodyResult =
  | { valid: true; value: AssistRequest }
  | { valid: false; error: string };

/** The eight ids the tool knows, derived so the two lists cannot drift apart. */
const VALID_CATEGORY_IDS: ReadonlySet<string> = new Set(CATEGORIES.map((c) => c.id));
/** R1 to R5, derived from the filter itself for the same reason. */
const VALID_RULE_IDS: ReadonlySet<string> = new Set(COMPLIANCE_RULES.map((r) => r.id));

/**
 * Validates a POST body against the assist contract. Pure: no clock, no
 * randomness, no environment reads.
 *
 * `proof` is optional and may be absent or undefined. When present it must be
 * a string, so a client sending null gets a clear 400 rather than a silent
 * coercion.
 */
export function validateAssistBody(body: unknown): ValidateAssistBodyResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, error: "body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;

  if (typeof obj.claim !== "string") {
    return { valid: false, error: "claim is required and must be a string" };
  }
  const claim = obj.claim.trim();
  if (claim.length === 0) {
    return { valid: false, error: "claim must not be empty" };
  }
  if (claim.length > MAX_CLAIM_LENGTH) {
    return { valid: false, error: `claim must be ${MAX_CLAIM_LENGTH} characters or fewer` };
  }

  if (!("proof" in obj) || obj.proof === undefined) {
    return { valid: true, value: { claim } };
  }
  if (typeof obj.proof !== "string") {
    return { valid: false, error: "proof must be a string when provided" };
  }
  const proof = obj.proof.trim();
  if (proof.length > MAX_PROOF_LENGTH) {
    return { valid: false, error: `proof must be ${MAX_PROOF_LENGTH} characters or fewer` };
  }
  return proof.length === 0
    ? { valid: true, value: { claim } }
    : { valid: true, value: { claim, proof } };
}

/**
 * Narrows the raw parsed model JSON to an AssistResult, or null when the shape
 * is wrong. Pure.
 *
 * A null return is treated by the caller as a parse failure, the same as
 * invalid JSON, so a half-formed suggestion never reaches the lawyer.
 *
 * Concerns are filtered rather than fatal: an entry naming a rule this build
 * does not carry, or carrying an empty note, is dropped and the rest of the
 * suggestion stands, capped at MAX_CONCERNS. Losing one advisory line is not
 * worth discarding a good rewrite, and the deterministic filter reports the
 * real verdicts regardless of what the model listed here.
 */
export function toAssistResult(parsed: unknown): AssistResult | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.tightenedClaim !== "string") return null;
  const tightenedClaim = obj.tightenedClaim.trim();
  if (tightenedClaim.length === 0) return null;

  if (typeof obj.category !== "string" || !VALID_CATEGORY_IDS.has(obj.category)) return null;

  if (!Array.isArray(obj.concerns)) return null;
  const concerns: AssistConcern[] = [];
  for (const entry of obj.concerns) {
    if (concerns.length >= MAX_CONCERNS) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.ruleId !== "string" || !VALID_RULE_IDS.has(candidate.ruleId)) continue;
    if (typeof candidate.note !== "string") continue;
    const note = candidate.note.trim();
    if (note.length === 0) continue;
    concerns.push({ ruleId: candidate.ruleId, note });
  }

  return { tightenedClaim, category: obj.category as Category, concerns };
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

/**
 * Runs one assist call. Returns a mode rather than throwing, so the route can
 * map an unconfigured deployment (disabled) and a model failure (error) to
 * different statuses without wrapping the whole request in a try/catch.
 */
export async function runAssist(req: AssistRequest): Promise<RunAssistResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return {
      mode: "disabled",
      reason: "No Gemini API key configured (set GOOGLE_AI_API_KEY or GEMINI_API_KEY)",
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: buildAssistSystemPrompt(),
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      responseSchema: ASSIST_RESPONSE_SCHEMA as never,
    },
  });

  const userPrompt = buildAssistUserPrompt(req.claim, req.proof);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await model.generateContent(userPrompt);
      const raw = response.response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { mode: "error", reason: "parse_failed" };
      }
      const result = toAssistResult(parsed);
      if (!result) {
        return { mode: "error", reason: "invalid_response_shape" };
      }
      return { mode: "live", result };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS && isTransientError(err)) {
        const wait = RETRY_BACKOFF_MS[attempt - 1] ?? 1200;
        // Log only fixed operational metadata. Provider errors can echo part
        // of the request, so neither the error object nor its message belongs
        // in logs when the request contains a lawyer's wording.
        console.warn("[why-your-firm/assist] transient provider error; retrying", {
          attempt,
          waitMs: wait,
        });
        await sleep(wait);
        continue;
      }
      break;
    }
  }

  return { mode: "error", reason: lastErr instanceof Error ? lastErr.message : String(lastErr) };
}
