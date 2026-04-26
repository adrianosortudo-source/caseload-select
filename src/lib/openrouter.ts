/**
 * openrouter.ts  -  Centralized AI model router for CaseLoad Screen
 *
 * Intake screening (STANDARD/FLOOR/CLASSIFIER) → Google AI Studio direct API
 *   Uses GOOGLE_AI_API_KEY, draws from Google credits ($400 balance).
 *   OpenAI-compatible endpoint: generativelanguage.googleapis.com/v1beta/openai/
 *
 * Memo generation (MEMO) → OpenRouter → anthropic/claude-sonnet-4-5
 *   Kept on Sonnet for lawyer-facing output quality.
 *
 * Fallback → OpenRouter → openai/gpt-4o-mini (if Google AI unreachable)
 */

import OpenAI from "openai";

// ─────────────────────────────────────────────
// Model constants
// ─────────────────────────────────────────────

export const MODELS = {
  /** Standard intake screening  -  Gemini 2.5 Flash via Google AI Studio direct */
  STANDARD: "gemini-2.5-flash",
  /** Cost floor  -  Gemini 2.5 Flash Lite (cheaper, same generation) */
  FLOOR: "gemini-2.5-flash-lite",
  /** Classifier  -  fast PA classification, same speed tier as STANDARD */
  CLASSIFIER: "gemini-2.5-flash",
  /** Memo generation  -  lawyer-facing doc, kept on Sonnet for output quality */
  MEMO: "anthropic/claude-sonnet-4-5",
  /** Fallback if Google AI is unreachable  -  via OpenRouter */
  FALLBACK: "openai/gpt-4o-mini",
} as const;

// ─────────────────────────────────────────────
// OpenRouter client (OpenAI-compatible)
// Used for memo generation (Sonnet) and fallback.
// ─────────────────────────────────────────────

export const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  defaultHeaders: {
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_DOMAIN
      ? `https://${process.env.NEXT_PUBLIC_APP_DOMAIN}`
      : "https://caseloadselect.ca",
    "X-Title": "CaseLoad Screen",
  },
});

// ─────────────────────────────────────────────
// Google AI Studio client (OpenAI-compatible endpoint)
// Used for all intake screening, classifier, and rewrite calls.
// ─────────────────────────────────────────────

export const googleai = new OpenAI({
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  apiKey: process.env.GOOGLE_AI_API_KEY ?? "",
  maxRetries: 3, // default is 2; extra retry for transient 503s from Google AI
});

// ─────────────────────────────────────────────
// Spend check with 5-minute cache
// Tracks OpenRouter balance (used for memo generation cost monitoring).
// No longer gates intake model selection (intake runs on Google credits).
// ─────────────────────────────────────────────

interface SpendCache {
  usage: number;
  limit: number | null;
  fetchedAt: number;
}

let _spendCache: SpendCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getMonthlySpend(): Promise<{ usage: number; limit: number | null }> {
  const now = Date.now();

  // Return cached value if fresh
  if (_spendCache && now - _spendCache.fetchedAt < CACHE_TTL_MS) {
    return { usage: _spendCache.usage, limit: _spendCache.limit };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn("[openrouter] OPENROUTER_API_KEY not set  -  skipping spend check");
    return { usage: 0, limit: null };
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
      // Short timeout  -  don't block intake on this
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      console.warn(`[openrouter] Spend check failed: HTTP ${res.status}`);
      return _spendCache
        ? { usage: _spendCache.usage, limit: _spendCache.limit }
        : { usage: 0, limit: null };
    }

    const json = await res.json() as {
      data: { usage: number; limit: number | null };
    };

    _spendCache = {
      usage: json.data.usage ?? 0,
      limit: json.data.limit ?? null,
      fetchedAt: now,
    };

    return { usage: _spendCache.usage, limit: _spendCache.limit };
  } catch (err) {
    console.warn("[openrouter] Spend check error:", err);
    // Fail open  -  return last known value or zero
    return _spendCache
      ? { usage: _spendCache.usage, limit: _spendCache.limit }
      : { usage: 0, limit: null };
  }
}

// ─────────────────────────────────────────────
// Intake model resolver
// ─────────────────────────────────────────────

/**
 * Resolves the model to use for intake screening.
 *
 * Intake now runs on Google AI Studio (STANDARD = gemini-2.0-flash) which
 * draws from Google credits, so OpenRouter-spend tiering no longer applies.
 *
 * Override via env: OPENROUTER_MODEL_OVERRIDE (kept for backwards compat,
 * still useful for forcing a specific model in testing).
 */
export async function getIntakeModel(): Promise<string> {
  const modelOverride = process.env.OPENROUTER_MODEL_OVERRIDE;
  if (modelOverride) return modelOverride;
  return MODELS.STANDARD;
}

/**
 * Synchronous model resolver for contexts where async isn't available.
 */
export function getIntakeModelSync(): string {
  const modelOverride = process.env.OPENROUTER_MODEL_OVERRIDE;
  if (modelOverride) return modelOverride;
  return MODELS.STANDARD;
}
