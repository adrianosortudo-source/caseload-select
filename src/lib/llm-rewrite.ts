/**
 * LLM Question Rewrite System
 *
 * Extends the /api/screen GPT call so the model reasons over the candidate
 * question pool instead of being used only as a classifier. On each round
 * GPT returns:
 *
 *   - resolved_questions:   questions implicitly answered in free text, with
 *                           an inferred option value and a confidence score
 *   - questions_to_ask:     rewritten text for candidate questions that
 *                           should still be asked, option values frozen
 *   - suppressed_questions: candidates that no longer make sense given the
 *                           client's narrative
 *
 * Question IDs, option values, and CPI weights never change. Only the
 * surface text gets rewritten. This keeps scoring determinism and LSO
 * compliance intact while giving the intake the contextual intelligence
 * raw GPT can provide.
 *
 * Mode control via env var LLM_QUESTION_REWRITE:
 *   "off"    - feature disabled (default)
 *   "shadow" - injects the prompt, logs rewrites, does NOT apply them
 *   "on"     - injects the prompt, applies rewrites after LSO validation
 *
 * Confidence threshold for auto-resolve: 0.8
 * Anything below the threshold is discarded and the question is asked.
 */

import type { Question } from "@/lib/screen-prompt";
import { googleai, MODELS } from "@/lib/openrouter";

export type RewriteMode = "off" | "shadow" | "on";

export const CONFIDENCE_THRESHOLD = 0.8;

/**
 * Read rewrite mode from environment. Defaults to "off" when unset or
 * when the value is not one we recognise. Accepts "on" | "true" | "1"
 * for active mode so ops can flip it via whatever convention fits.
 */
export function getRewriteMode(): RewriteMode {
  const raw = (process.env.LLM_QUESTION_REWRITE ?? "off").toLowerCase().trim();
  if (raw === "shadow") return "shadow";
  if (raw === "on" || raw === "true" || raw === "1") return "on";
  return "off";
}

/**
 * LSO Rule 4.2-1 compliance denylist. Each pattern is matched against
 * rewritten_text before it is rendered. A match rejects the rewrite and
 * the canonical question text is served instead.
 *
 * Categories:
 *   - Outcome promises / guarantees
 *   - Case-strength claims
 *   - Specialist / expert language
 *   - Superlatives about lawyers or the firm
 *   - Result prediction
 *   - Damages promises
 */
export const LSO_DENYLIST: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bguarantee(?:d|s)?\b/i, label: "guarantee" },
  { pattern: /\byou\s+(?:will|'ll)\s+(?:win|get|receive|be\s+awarded|recover)\b/i, label: "outcome promise" },
  { pattern: /\b(?:strong|solid|winning|slam[- ]?dunk|rock[- ]?solid)\s+case\b/i, label: "case strength claim" },
  { pattern: /\byou\s+(?:have|'ve\s+got)\s+(?:a\s+)?(?:strong|solid|great|winnable)\s+(?:claim|case)\b/i, label: "case strength claim" },
  { pattern: /\bspecial(?:ists?|izing|ization|ise|ises|ised)\b/i, label: "specialist claim" },
  { pattern: /\b(?:legal\s+)?expert(?:s|ise)?\b/i, label: "expert claim" },
  { pattern: /\b(?:best|top|leading|premier|#\s*1|number\s+one)\s+(?:lawyer|attorney|firm|counsel)\b/i, label: "superlative" },
  { pattern: /\bthe\s+(?:judge|court|jury)\s+will\b/i, label: "result prediction" },
  { pattern: /\b(?:sue|pursue|claim)\s+.{0,30}\bfor\s+(?:millions?|thousands?|\$\s*\d)/i, label: "damages promise" },
  { pattern: /\brisk[- ]free\b/i, label: "risk-free claim" },
];

export interface ResolvedQuestion {
  id: string;
  inferred_value: string;
  evidence?: string;
  confidence: number;
}

export interface RewrittenQuestion {
  id: string;
  rewritten_text: string;
  rationale?: string;
}

export interface SuppressedQuestion {
  id: string;
  reason?: string;
}

export interface RewritePayload {
  resolved_questions?: ResolvedQuestion[];
  questions_to_ask?: RewrittenQuestion[];
  suppressed_questions?: SuppressedQuestion[];
}

/**
 * Validate rewritten text. Returns { ok: true } when safe to render,
 * { ok: false, reason } with the failing rule when not. The reason is
 * logged for auditing so false positives can be tracked.
 */
export function validateRewrite(text: string): { ok: true } | { ok: false; reason: string } {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, reason: "empty or non-string" };
  }
  if (text.length > 400) {
    return { ok: false, reason: "too long (> 400 chars)" };
  }
  // Em dashes violate the house copy rules.
  if (/[\u2014\u2013]/.test(text)) {
    return { ok: false, reason: "em or en dash" };
  }
  for (const { pattern, label } of LSO_DENYLIST) {
    if (pattern.test(text)) {
      return { ok: false, reason: `LSO denylist: ${label}` };
    }
  }
  return { ok: true };
}

/**
 * Build the candidate pool from the active question set. Drops questions
 * already answered (present as keys in the confirmed map). No priority
 * or eligibility filtering is applied here — that happens downstream in
 * question-selector. GPT gets to see the full remaining set and can
 * choose which are resolved, suppressed, or asked.
 */
export function candidatesFromQuestionSet(
  questions: Question[],
  confirmed: Record<string, unknown>,
): Question[] {
  return questions.filter(q => !(q.id in confirmed));
}

/**
 * Build the prompt chunk listing candidates and the rewrite contract. The
 * full system prompt appends this block right before the GPT call. Only
 * emits content when there is at least one candidate.
 */
export function buildRewritePromptChunk(candidates: Question[], subType: string | null): string {
  if (candidates.length === 0) return "";

  const lines = candidates.map(q => {
    const opts = (q.options ?? [])
      .map(o => `${o.value}="${o.label}"`)
      .join(" | ");
    const optsLine = opts.length > 0 ? `\n    Options: ${opts}` : "\n    (free text)";
    return `  [${q.id}] ${q.text}${optsLine}`;
  }).join("\n\n");

  const header = subType ? ` (${subType})` : "";

  return (
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
    `\nCANDIDATE QUESTIONS${header} — REWRITE / RESOLVE / SUPPRESS (MANDATORY)\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `This block OVERRIDES the "no extra keys" rule in the OUTPUT SCHEMA. You MUST populate resolved_questions, questions_to_ask, and suppressed_questions as top-level arrays in your JSON response. Every candidate id below MUST appear in exactly ONE of the three arrays. The union of the three arrays MUST equal the candidate pool.\n\n` +
    `Decision rules for each candidate:\n` +
    `  (1) resolved_questions    - the client has already answered it, directly or by strong implication, anywhere in the conversation. Return the matching option value plus the text that supports the inference.\n` +
    `  (2) suppressed_questions  - the question is no longer relevant given what the client said (e.g. asking whether the client is still employed after they said they were fired). Return a brief reason.\n` +
    `  (3) questions_to_ask      - the question should still be asked. Return a rewritten text that anchors on the client's own words, under 140 characters. Do NOT return the canonical text verbatim; rewrite it so it feels like a follow-up to the conversation.\n\n` +
    `Rules for rewritten_text:\n` +
    `  - Conversational plain English, second person.\n` +
    `  - Reference the client's own words when it adds clarity ("You said you were fired. What reason did they give?").\n` +
    `  - No outcome promises. No "specialist" or "expert". No superlatives ("best", "top"). No guarantees. No result predictions.\n` +
    `  - No em dashes, no en dashes. Use commas, semicolons, or parentheses.\n` +
    `  - Never invent new option values. Option IDs and values are frozen.\n\n` +
    `Rules for resolved_questions:\n` +
    `  - inferred_value MUST be one of the option values listed for that id (except for free-text questions).\n` +
    `  - confidence in [0.0, 1.0]. Only return when you are at least 0.8 confident.\n` +
    `  - evidence: quote or paraphrase the client's words that support the inference.\n\n` +
    `CANDIDATE POOL:\n` +
    lines +
    `\n\nOUTPUT CONTRACT (required top-level JSON fields):\n` +
    `  "resolved_questions":   [{ "id": "...", "inferred_value": "...", "evidence": "...", "confidence": 0.0 }]\n` +
    `  "questions_to_ask":     [{ "id": "...", "rewritten_text": "...", "rationale": "..." }]\n` +
    `  "suppressed_questions": [{ "id": "...", "reason": "..." }]\n\n` +
    `Return [] for any category with zero entries. Do NOT skip any candidate id. Classify each candidate strictly on evidence from the conversation: if the client already answered or the question is no longer relevant given what they described, place it in resolved_questions or suppressed_questions. Do not force candidates into questions_to_ask simply to avoid an empty array.\n\n` +
    `SUPPRESSION EXAMPLES:\n` +
    `  Slip-and-fall, client said "I didn't go to the hospital" → suppress questions about medical treatment received, treatment plans, income loss from injury.\n` +
    `  MVA, client said "I have no injuries requiring treatment" → suppress questions about treatment history, physiotherapy, specialist visits.\n` +
    `  Wrongful dismissal, client said "I was terminated 4 months ago on March 12" → resolve the termination-date question with inferred_value="2025-03-12", confidence=0.95.\n` +
    `  Employment, client said "I signed a severance agreement the same day" → resolve the release-status question with inferred_value="signed_have_copy" if they mention having it, confidence=0.85.`
  );
}

export interface ResolvedApplyLog {
  id: string;
  value: string;
  confidence: number;
  status: "applied" | "skipped";
  reason?: string;
}

/**
 * Apply resolved_questions to the confirmed answers map. Only entries
 * that pass all gates (known id, valid option value, confidence >= 0.8,
 * not already confirmed) are written. Returns an audit log so shadow
 * mode and production can both trace decisions.
 */
export function applyResolvedQuestions(
  resolved: ResolvedQuestion[] | undefined,
  candidates: Question[],
  confirmed: Record<string, unknown>,
): { applied: number; log: ResolvedApplyLog[] } {
  if (!resolved || resolved.length === 0) return { applied: 0, log: [] };

  const log: ResolvedApplyLog[] = [];
  let applied = 0;

  const candidateById = new Map(candidates.map(q => [q.id, q]));

  for (const r of resolved) {
    if (!r || typeof r.id !== "string") continue;
    const value = typeof r.inferred_value === "string" ? r.inferred_value : "";
    const confidence = typeof r.confidence === "number" ? r.confidence : 0;

    const question = candidateById.get(r.id);
    if (!question) {
      log.push({ id: r.id, value, confidence, status: "skipped", reason: "unknown id" });
      continue;
    }

    if (confidence < CONFIDENCE_THRESHOLD) {
      log.push({ id: r.id, value, confidence, status: "skipped", reason: "low confidence" });
      continue;
    }

    const options = question.options ?? [];
    const hasOptions = options.length > 0;
    if (hasOptions) {
      const validValues = options.map(o => o.value);
      if (!validValues.includes(value)) {
        log.push({ id: r.id, value, confidence, status: "skipped", reason: "value not in option set" });
        continue;
      }
    } else if (value.trim().length === 0) {
      log.push({ id: r.id, value, confidence, status: "skipped", reason: "empty free-text value" });
      continue;
    }

    if (r.id in confirmed) {
      log.push({ id: r.id, value, confidence, status: "skipped", reason: "already confirmed" });
      continue;
    }

    confirmed[r.id] = value;
    applied++;
    log.push({ id: r.id, value, confidence, status: "applied" });
  }

  return { applied, log };
}

export interface SuppressApplyLog {
  id: string;
  reason: string;
  status: "applied" | "skipped";
  skip_reason?: string;
}

/**
 * Apply suppressed_questions by writing the __implied__ sentinel to the
 * confirmed map. Same mechanism as question-selector's implied-answer
 * inference so downstream filtering works without changes.
 */
export function applySuppressedQuestions(
  suppressed: SuppressedQuestion[] | undefined,
  candidates: Question[],
  confirmed: Record<string, unknown>,
): { applied: number; log: SuppressApplyLog[] } {
  if (!suppressed || suppressed.length === 0) return { applied: 0, log: [] };

  const log: SuppressApplyLog[] = [];
  let applied = 0;

  const candidateIds = new Set(candidates.map(q => q.id));

  for (const s of suppressed) {
    if (!s || typeof s.id !== "string") continue;
    const reason = typeof s.reason === "string" && s.reason.length > 0 ? s.reason : "(no reason provided)";

    if (!candidateIds.has(s.id)) {
      log.push({ id: s.id, reason, status: "skipped", skip_reason: "unknown id" });
      continue;
    }

    if (s.id in confirmed) {
      log.push({ id: s.id, reason, status: "skipped", skip_reason: "already confirmed" });
      continue;
    }

    confirmed[s.id] = "__implied__";
    applied++;
    log.push({ id: s.id, reason, status: "applied" });
  }

  return { applied, log };
}

export interface RewriteApplyLog {
  id: string;
  status: "applied" | "rejected";
  reason?: string;
}

/**
 * Build a Map of question id → validated rewritten text. Entries that
 * fail the LSO denylist are rejected and the caller should render the
 * canonical text for those ids instead.
 */
export function buildRewriteMap(
  rewrites: RewrittenQuestion[] | undefined,
  candidateIds: Set<string>,
): { map: Map<string, string>; log: RewriteApplyLog[] } {
  const map = new Map<string, string>();
  const log: RewriteApplyLog[] = [];

  if (!rewrites) return { map, log };

  for (const r of rewrites) {
    if (!r || typeof r.id !== "string" || typeof r.rewritten_text !== "string") continue;

    if (!candidateIds.has(r.id)) {
      log.push({ id: r.id, status: "rejected", reason: "unknown id" });
      continue;
    }

    const validation = validateRewrite(r.rewritten_text);
    if (!validation.ok) {
      log.push({ id: r.id, status: "rejected", reason: validation.reason });
      continue;
    }

    map.set(r.id, r.rewritten_text.trim());
    log.push({ id: r.id, status: "applied" });
  }

  return { map, log };
}

/**
 * Overlay validated rewrites onto a list of shaped widget questions.
 * Mutates in place; returns the same reference. Only the text field
 * changes; id, options, and everything else are left alone.
 */
export function applyRewritesToQuestions<T extends { id: string; text: string }>(
  questions: T[],
  rewriteMap: Map<string, string>,
): T[] {
  if (rewriteMap.size === 0) return questions;
  for (const q of questions) {
    const rewritten = rewriteMap.get(q.id);
    if (rewritten && rewritten.length > 0) {
      q.text = rewritten;
    }
  }
  return questions;
}

// ──────────────────────────────────────────────────────────────────────────────
// Dedicated rewrite model call
// ──────────────────────────────────────────────────────────────────────────────
//
// The original design fed the candidate pool and the rewrite contract into the
// main screening prompt. gpt-4o-mini refused to populate the rewrite arrays
// from inside that combined prompt: it kept emitting its canonical next_question
// shape and leaving resolved_questions / questions_to_ask / suppressed_questions
// empty, no matter how strongly the contract was worded.
//
// This isolates the rewrite job into its own focused call using JSON mode.
// The model is given only the candidate pool, the conversation so far, and
// the three-array contract embedded in the system prompt. The output
// contract (shape + field names) is documented inline in buildRewritePromptChunk;
// parseRewriteResponse is tolerant of missing fields.
//
// Note: REWRITE_PAYLOAD_SCHEMA is retained for test fixtures and possible
// re-adoption if we migrate to a client that supports strict json_schema mode.
//
// The call is best-effort: any failure (network, parse, schema violation,
// API error) returns null and is logged. Callers treat null as "no rewrites
// for this turn" and render the canonical text. Intake never breaks because
// the rewrite call failed.
// ──────────────────────────────────────────────────────────────────────────────

/** JSON Schema for the rewrite payload (OpenAI structured outputs). */
export const REWRITE_PAYLOAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    resolved_questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          inferred_value: { type: "string" },
          evidence: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["id", "inferred_value", "evidence", "confidence"],
      },
    },
    questions_to_ask: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          rewritten_text: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["id", "rewritten_text", "rationale"],
      },
    },
    suppressed_questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["id", "reason"],
      },
    },
  },
  required: ["resolved_questions", "questions_to_ask", "suppressed_questions"],
} as const;

/** Compact conversation turn for the rewrite prompt. */
export interface RewriteTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RewriteCallInput {
  candidates: Question[];
  subType: string | null;
  /** The client's situation text (free-text they've said across turns, concatenated). */
  situation: string;
  /** Last few conversation turns for extra context. Caller should trim to ~6. */
  history?: RewriteTurn[];
  /** Per-call timeout in ms. Defaults to 8000 (the rewrite call runs in parallel with the main screening call). */
  timeoutMs?: number;
  /** Optional OpenAI client override for tests. Defaults to the shared googleai client. */
  client?: Pick<typeof googleai, "chat">;
  /** Optional model override. Defaults to MODELS.STANDARD (gemini-2.5-flash). */
  model?: string;
}

export interface RewriteCallResult {
  payload: RewritePayload;
  /** Raw JSON string returned by the model. Useful for shadow-mode logs. */
  raw: string;
  model: string;
}

/**
 * Build the system prompt for the dedicated rewrite call. Reuses the
 * existing CANDIDATE QUESTIONS chunk so the contract wording stays in
 * one place.
 */
export function buildRewriteSystemPrompt(candidates: Question[], subType: string | null): string {
  const preamble =
    `You are the question-rewrite module for a Canadian legal intake screener.\n` +
    `Your ONLY job is to look at the candidate question pool and the conversation so far, then decide for each candidate whether it is (1) already answered in free text, (2) no longer relevant, or (3) still needs to be asked (with a rewrite that anchors on the client's own words).\n` +
    `You are NOT running the intake. You never classify practice area, never score, never write follow-up questions outside the candidate pool, never invent new ids or option values.\n` +
    `Return ONLY the JSON object defined by the schema. Do not add commentary.\n` +
    `LSO Rule 4.2-1 applies: no outcome promises, no "specialist"/"expert" language, no superlatives, no guarantees, no result predictions, no em or en dashes.`;
  const chunk = buildRewritePromptChunk(candidates, subType);
  return preamble + chunk;
}

/**
 * Build the user-role message for the rewrite call. Gives the model the
 * client's situation text and (optionally) the last few conversation turns.
 */
export function buildRewriteUserMessage(situation: string, history: RewriteTurn[] = []): string {
  const parts: string[] = [];
  const trimmedSituation = typeof situation === "string" ? situation.trim() : "";
  if (trimmedSituation.length > 0) {
    parts.push(`CLIENT SITUATION (free-text so far):\n${trimmedSituation}`);
  }
  if (history.length > 0) {
    const lines = history
      .filter(t => t && typeof t.content === "string" && t.content.trim().length > 0)
      .map(t => `[${t.role}] ${t.content.trim()}`);
    if (lines.length > 0) {
      parts.push(`RECENT CONVERSATION:\n${lines.join("\n")}`);
    }
  }
  if (parts.length === 0) {
    parts.push("(no prior conversation captured yet)");
  }
  parts.push(
    `Classify every candidate id into exactly one of resolved_questions, questions_to_ask, or suppressed_questions. Return the JSON object per the schema.`,
  );
  return parts.join("\n\n");
}

/**
 * Parse a model response string into a RewritePayload. Returns null when
 * the string is not JSON or does not look like the expected shape.
 */
export function parseRewriteResponse(raw: string): RewritePayload | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const resolved = Array.isArray(record.resolved_questions)
    ? (record.resolved_questions as ResolvedQuestion[])
    : [];
  const toAsk = Array.isArray(record.questions_to_ask)
    ? (record.questions_to_ask as RewrittenQuestion[])
    : [];
  const suppressed = Array.isArray(record.suppressed_questions)
    ? (record.suppressed_questions as SuppressedQuestion[])
    : [];

  return {
    resolved_questions: resolved,
    questions_to_ask: toAsk,
    suppressed_questions: suppressed,
  };
}

/**
 * Call the dedicated rewrite model. Parallelisable with the main screening
 * call. Returns null on ANY failure (no candidates, API error, parse
 * failure, abort). Never throws.
 */
export async function callRewriteModel(
  input: RewriteCallInput,
): Promise<RewriteCallResult | null> {
  if (!input || !Array.isArray(input.candidates) || input.candidates.length === 0) {
    return null;
  }

  const client = input.client ?? googleai;
  const model = input.model ?? MODELS.STANDARD;
  const timeoutMs = typeof input.timeoutMs === "number" && input.timeoutMs > 0 ? input.timeoutMs : 8000;

  const systemPrompt = buildRewriteSystemPrompt(input.candidates, input.subType ?? null);
  const userMessage = buildRewriteUserMessage(input.situation ?? "", input.history ?? []);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Note: Gemini's OpenAI-compatible endpoint supports `json_object` but
    // not `json_schema` with strict enforcement. The OUTPUT CONTRACT in the
    // system prompt (from buildRewritePromptChunk) specifies the shape; the
    // parser (parseRewriteResponse) is tolerant of missing fields.
    const completion = await client.chat.completions.create(
      {
        model,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        // Disable Gemini 2.5 thinking  -  the rewrite task is structured
        // extraction, not reasoning.
        reasoning_effort: "none",
      },
      { signal: controller.signal },
    );

    const raw = completion.choices?.[0]?.message?.content;
    if (typeof raw !== "string" || raw.trim().length === 0) {
      console.warn("[llm-rewrite] empty response from rewrite model", { model });
      return null;
    }

    const payload = parseRewriteResponse(raw);
    if (!payload) {
      console.warn("[llm-rewrite] could not parse rewrite model response", {
        model,
        raw_preview: raw.slice(0, 200),
      });
      return null;
    }

    return { payload, raw, model };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[llm-rewrite] rewrite model call failed (non-fatal)", {
      model,
      error: message,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
