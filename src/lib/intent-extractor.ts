/**
 * intent-extractor.ts — first-pass extraction of canonical intents from
 * the prospect's kickoff text.
 *
 * Why this exists:
 *  - The AI's question loop (R1/R2) historically failed to capture facts the
 *    prospect already volunteered in the kickoff text. Result: R3 asked
 *    "When did this happen?" even though the prospect typed "last week" in
 *    sentence one of their situation paragraph.
 *  - This module runs ONCE, immediately after the kickoff submission, and
 *    populates scoring._intents with whatever can be inferred from the text.
 *  - Downstream R1/R2/R3 dedupe consults this map first  -  so questions whose
 *    intent is already filled are skipped before they are asked.
 *
 * Design notes:
 *  - GPT-4o-mini is cheap and fast for extraction. ~$0.0001 per call.
 *  - The prompt asks for STRICT JSON: { intents: { key: value }, situation_summary: "..." }
 *  - Values must be from the intent's enum (when defined). Unknown values are
 *    coerced to closest enum member or skipped entirely.
 *  - Failure is silent  -  if extraction errors, R1 proceeds normally.
 */

import { openrouter, MODELS } from "@/lib/openrouter";
import { intentsForPracticeArea, type Intent } from "./intent-registry";

interface ExtractionResult {
  /** Canonical intent key → enum value (or string fallback) */
  intents: Record<string, string>;
  /** Two-sentence summary of the situation, suitable for the case memo */
  situation_summary: string | null;
}

/**
 * Run a single GPT call to extract intents from the kickoff text.
 * Practice area is optional  -  if known, the prompt narrows the intent set.
 *
 * Returns an empty result on any error  -  this function never throws into
 * the caller; the intake flow continues regardless.
 */
export async function extractIntents(
  situationText: string,
  practiceArea: string | null = null,
): Promise<ExtractionResult> {
  if (!situationText || situationText.trim().length < 10) {
    return { intents: {}, situation_summary: null };
  }

  const applicable = intentsForPracticeArea(practiceArea);
  const intentSchema = applicable.map(i => intentLine(i)).join("\n");

  const systemPrompt = `You extract structured legal-intake facts from short situation paragraphs.

Your job: read the prospect's situation text and return a JSON object filling as many of the listed intents as possible. Extract ONLY facts the prospect explicitly stated or strongly implied. Do NOT invent or infer beyond what is supported by the text.

The set of intents you may fill (use these EXACT keys):
${intentSchema}

OUTPUT STRICT JSON ONLY  -  no commentary, no markdown:
{
  "intents": { "<intent_key>": "<value from enum>", ... },
  "situation_summary": "<one or two sentences summarising the situation factually, no advice>"
}

Rules:
- Use ONLY the listed intent keys. Never invent new keys.
- For intents with an enum, use ONLY the listed enum values. If unsure, omit the intent rather than guess.
- For intents without an enum, free text is allowed but keep it brief (under 12 words).
- Omit intents the prospect did not address.
- "situation_summary" is mandatory  -  always provide it.
- Do not include legal opinions, advice, or outcomes in the summary.`;

  const userPrompt = `Situation text from prospect:\n"""${situationText.trim()}"""`;

  try {
    const completion = await openrouter.chat.completions.create({
      model: MODELS.CLASSIFIER,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 600,
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return { intents: {}, situation_summary: null };

    const parsed = JSON.parse(raw) as Partial<ExtractionResult>;
    const cleaned = sanitizeIntents(parsed.intents ?? {}, applicable);
    return {
      intents: cleaned,
      situation_summary: typeof parsed.situation_summary === "string"
        ? parsed.situation_summary.trim().slice(0, 500)
        : null,
    };
  } catch {
    // Silent failure — caller will proceed with empty intents map
    return { intents: {}, situation_summary: null };
  }
}

/**
 * Render a single line of the intent schema for the GPT prompt.
 * Format: `<key> ("<label>"): <description> [enum: a|b|c]`
 */
function intentLine(intent: Intent): string {
  const enumPart = intent.enum && intent.enum.length > 0
    ? ` [enum: ${intent.enum.join(" | ")}]`
    : ` [free text]`;
  return `- ${intent.key} ("${intent.label}"): ${intent.description}${enumPart}`;
}

/**
 * Validate the GPT-returned intents map: drop any keys not in our registry,
 * coerce values to enum where applicable, drop empty / nonsense values.
 */
function sanitizeIntents(
  raw: Record<string, unknown>,
  applicable: Intent[],
): Record<string, string> {
  const allowedByKey = new Map(applicable.map(i => [i.key, i]));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const intent = allowedByKey.get(key);
    if (!intent) continue;
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const v = value.trim();
    if (intent.enum && intent.enum.length > 0) {
      // Strict enum match — drop if not in enum.
      if (!intent.enum.includes(v)) continue;
    }
    out[key] = v;
  }
  return out;
}
