/**
 * Pure prompt-building and response-parsing for the LLM option-mapping
 * fallback (C3, 2026-08-07). Split from llm-option-map.ts so these can be
 * unit-tested without the Gemini SDK, mirroring the split already used
 * for screen-engine/llm/{prompt,schema}.ts vs screen-llm-server.ts.
 *
 * What this is for: on a resume turn, a reply to a numbered
 * (single_select) question that every deterministic matcher (digit,
 * word-number, sentinel, fuzzy option match, free-text mapping) failed to
 * resolve currently falls straight to the "Sorry, I didn't get your last
 * reply" clarifier — a broken promise once the C2 intro tells the lead
 * they can "answer in your own words". This helper asks the LLM to map
 * the lead's own reply onto one of the options offered, ONLY when the
 * meaning clearly selects one.
 *
 * A mapped value is different in kind from `llm_inferred` extraction: the
 * user DID answer the question we asked; the LLM only translates their
 * wording onto the option list we already offered. That is why the
 * caller applies a successful mapping via `applyAnswer` (source
 * 'answered'), not as a slot fill with 'llm_inferred' provenance.
 */

export interface OptionMapOption {
  label: string;
  value: string;
}

export interface OptionMapPromptArgs {
  questionLabel: string;
  options: OptionMapOption[];
  reply: string;
  language: string;
}

/**
 * System prompt: fixed rules, independent of the specific question.
 * Conservative by design — a question back at the bot, an off-topic
 * remark, or a genuinely ambiguous reply must return null, not a guess.
 */
export function buildOptionMapSystemPrompt(): string {
  return [
    'You map a short reply to one option from a fixed list, for a legal-intake chat.',
    'Pick an option ONLY when the reply\'s meaning clearly selects it.',
    'If the reply asks a question, is off-topic, declines to answer, or is ambiguous between two or more options, return null.',
    'Never invent a value that is not one of the options provided.',
    'The reply may be in any language; the options are given in English regardless of the reply\'s language.',
    'Respond with strict JSON only: {"value": "<one of the option values, or null>"}.',
  ].join('\n');
}

export function buildOptionMapUserPrompt(args: OptionMapPromptArgs): string {
  const optionLines = args.options
    .map((o, i) => `${i + 1}. ${o.label} (value: ${o.value})`)
    .join('\n');
  return [
    `Question asked: ${args.questionLabel}`,
    `Options offered:\n${optionLines}`,
    `Lead's reply (language: ${args.language}): ${args.reply}`,
    'Which option value does this reply select? Respond with the JSON shape only.',
  ].join('\n\n');
}

/** Response schema for the structured Gemini call (responseSchema, JSON mode). */
export function buildOptionMapResponseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      value: { type: 'string', nullable: true },
    },
    required: ['value'],
  };
}

export interface ParsedOptionMapResult {
  value: string | null;
}

/**
 * Parse the raw JSON text from the model. Returns null on any parse
 * failure or shape mismatch — the caller treats that identically to a
 * genuine "no match" (fall through to the existing clarifier).
 */
export function parseOptionMapResponse(raw: string): ParsedOptionMapResult {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'value' in parsed) {
      const v = (parsed as { value: unknown }).value;
      if (typeof v === 'string' && v.length > 0) return { value: v };
    }
    return { value: null };
  } catch {
    return { value: null };
  }
}

/**
 * Membership guard: never let an LLM-invented value reach applyAnswer.
 * The system prompt instructs the model to only use the values we handed
 * it, but the guard is the actual defense, same discipline as the
 * ROUTING_PEER_SETS belt-and-suspenders check in
 * screen-engine/llm/extractor.ts.
 */
export function isValidOptionValue(value: string | null, options: OptionMapOption[]): boolean {
  if (!value) return false;
  return options.some((o) => o.value === value);
}
