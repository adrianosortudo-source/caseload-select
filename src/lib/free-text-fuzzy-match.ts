/**
 * Free-text fuzzy match for Phase C single_select replies.
 *
 * Field-detected 2026-05-24 (DRG Messenger ownership_percentage slot):
 * bot asks "What percentage of the company do you own?" with options
 * "1. 100% / 2. 51-99% / ... / 5. Not sure", lead replies "dont know"
 * (natural-language non-answer), engine has no extraction path, asks
 * the same question again. Loop until the lead types a digit or a
 * regex-matchable answer.
 *
 * Same family as numeric-option-mapping.ts (digit replies → option
 * value) but for natural-language sentinels. Common patterns:
 *
 *   Non-answer ("Not sure" canonical option):
 *     "dont know" / "don't know" / "i don't know" / "no idea" / "idk"
 *     / "not sure" / "unsure" / "unknown" / "n/a" / "not applicable"
 *
 *   Affirmative ("Yes" option):
 *     "yes" / "yeah" / "yep" / "yup" / "y" / "sure" / "ok" / "okay"
 *     / "correct" / "right" / "absolutely" / "definitely"
 *
 *   Negative ("No" option):
 *     "no" / "nope" / "nah" / "n" / "not really" / "negative"
 *
 * For each detected reply class, looks at the engine's next-step slot
 * (getNextStep — same trick as numeric-option-mapping: deterministic
 * on resume since the bot just asked the unfilled slot). If the slot
 * is single_select AND has a matching option, the reply is mapped
 * through applyAnswer (canonical chip-answer path; gets reroute side
 * effects, completeness recompute, band recompute, all the things
 * the web widget gets for free on chip click).
 *
 * No-ops when:
 *   - Reply isn't a clean sentinel pattern (free-form text → LLM)
 *   - Next-step slot isn't single_select with options
 *   - No matching option exists (e.g. slot has "Yes/No" but reply is
 *     "dont know" — fall through to LLM)
 *   - Slot is already filled (preserves prior answer)
 *
 * Lives OUTSIDE src/lib/screen-engine/ — server-only adapter helper.
 * Web sandbox uses chip UI; no equivalent needed there.
 */

import { getNextStep, applyAnswer } from './screen-engine/control';
import type { EngineState, SlotDefinition } from './screen-engine/types';
import { fuzzyMatchOption } from './option-fuzzy-match';

// ── Sentinel patterns ───────────────────────────────────────────────────

/**
 * Reply types this helper recognises. Order matters in detection:
 * "non_answer" first (so "i don't know" doesn't get matched as "no").
 */
type ReplyClass = 'non_answer' | 'affirmative' | 'negative';

const NON_ANSWER_PATTERNS: RegExp[] = [
  /^\s*(?:i\s+)?(?:don'?t|do\s*not)\s+know\s*\.?\s*$/i,
  /^\s*dont\s+know\s*\.?\s*$/i,
  /^\s*idk\s*\.?\s*$/i,
  /^\s*no\s+idea\s*\.?\s*$/i,
  /^\s*not\s+sure\s*\.?\s*$/i,
  /^\s*unsure\s*\.?\s*$/i,
  /^\s*unknown\s*\.?\s*$/i,
  /^\s*n\s*\/\s*a\s*\.?\s*$/i,
  /^\s*not\s+applicable\s*\.?\s*$/i,
];

const AFFIRMATIVE_PATTERNS: RegExp[] = [
  /^\s*yes\s*\.?\s*$/i,
  /^\s*yeah\s*\.?\s*$/i,
  /^\s*yep\s*\.?\s*$/i,
  /^\s*yup\s*\.?\s*$/i,
  /^\s*y\s*\.?\s*$/i,
  /^\s*sure\s*\.?\s*$/i,
  /^\s*ok\s*\.?\s*$/i,
  /^\s*okay\s*\.?\s*$/i,
  /^\s*correct\s*\.?\s*$/i,
  /^\s*right\s*\.?\s*$/i,
  /^\s*absolutely\s*\.?\s*$/i,
  /^\s*definitely\s*\.?\s*$/i,
];

const NEGATIVE_PATTERNS: RegExp[] = [
  /^\s*no\s*\.?\s*$/i,
  /^\s*nope\s*\.?\s*$/i,
  /^\s*nah\s*\.?\s*$/i,
  /^\s*n\s*\.?\s*$/i,
  /^\s*not\s+really\s*\.?\s*$/i,
  /^\s*negative\s*\.?\s*$/i,
];

function classifyReply(text: string): ReplyClass | null {
  if (!text || typeof text !== 'string') return null;
  // Test non_answer first — "i don't know" should NEVER be matched as
  // "no" (the leading "i don't" prefix dominates).
  if (NON_ANSWER_PATTERNS.some((re) => re.test(text))) return 'non_answer';
  if (AFFIRMATIVE_PATTERNS.some((re) => re.test(text))) return 'affirmative';
  if (NEGATIVE_PATTERNS.some((re) => re.test(text))) return 'negative';
  return null;
}

// ── Option lookups ──────────────────────────────────────────────────────

/**
 * Canonical "Not sure" labels we accept as fall-through targets for
 * non-answer replies. Most slots in slotRegistry.ts use exactly
 * "Not sure" as the last option; some use slight variants. Match is
 * case-insensitive and trims whitespace.
 */
const NON_ANSWER_OPTION_LABELS = [
  'not sure',
  'unsure',
  "i don't know",
  'unknown',
  'n/a',
];

const AFFIRMATIVE_OPTION_LABELS = ['yes'];
const NEGATIVE_OPTION_LABELS = ['no'];

function findMatchingOption(slot: SlotDefinition, labels: string[]): string | null {
  if (!slot.options || slot.options.length === 0) return null;
  const norm = (s: string) => s.toLowerCase().trim();
  const acceptable = new Set(labels.map(norm));
  for (const opt of slot.options) {
    if (acceptable.has(norm(opt.value))) return opt.value;
  }
  return null;
}

function pickOptionForReplyClass(
  slot: SlotDefinition,
  cls: ReplyClass,
): string | null {
  switch (cls) {
    case 'non_answer':
      return findMatchingOption(slot, NON_ANSWER_OPTION_LABELS);
    case 'affirmative':
      return findMatchingOption(slot, AFFIRMATIVE_OPTION_LABELS);
    case 'negative':
      return findMatchingOption(slot, NEGATIVE_OPTION_LABELS);
  }
}

// ── Main entry ──────────────────────────────────────────────────────────

/**
 * If the lead's reply is a recognised free-text sentinel and the
 * engine's next-step slot has a matching option, write it through
 * applyAnswer. Returns the input state unchanged otherwise.
 */
export function applyFreeTextFuzzyMatch(
  text: string,
  state: EngineState,
): EngineState {
  let next: ReturnType<typeof getNextStep>;
  try {
    next = getNextStep(state);
  } catch {
    return state;
  }

  const slot = next.slot;
  if (!slot) return state;
  if (slot.input_type !== 'single_select') return state;
  if (state.slots[slot.id]) return state;

  // 1. Sentinel class (yes / no / non-answer) against the canonical
  //    option labels. Preserved as the first path so existing behavior
  //    is unchanged.
  const cls = classifyReply(text);
  if (cls) {
    const optionValue = pickOptionForReplyClass(slot, cls);
    if (optionValue) return applyAnswer(state, slot.id, optionValue);
  }

  // 2. Typo-tolerant fallback (#174): digit (leading-junk tolerant),
  //    word-number, token-subset, and edit-distance against the option
  //    set. Returns null on ambiguity or no confident match, so a true
  //    free-form description still falls through to the LLM.
  const fuzzy = fuzzyMatchOption(text, slot.options ?? []);
  if (fuzzy) return applyAnswer(state, slot.id, fuzzy);

  return state;
}
