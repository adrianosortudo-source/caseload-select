/**
 * Numeric-option reply mapping for Phase C discovery.
 *
 * Closes a loop hole field-detected against DRG on 2026-05-24: Phase C
 * asks a single_select discovery slot and formats the options as a
 * numbered list ("1. X / 2. Y / 3. Z" via `formatDiscoveryQuestion` in
 * channel-intake-processor). The lead replies with a bare digit ("2"),
 * but the LLM extraction call on the resume turn passes only the bare
 * "2" string with no question context — Gemini cannot map "2" to the
 * canonical option value. Engine sees the slot still empty, re-asks the
 * same question, loop.
 *
 * Fix: before LLM extraction on resume turns, call this helper. It
 *   1. Detects bare-digit / leading-digit / "option N" replies.
 *   2. Calls `getNextStep(state)` to know which slot the engine is
 *      currently waiting on (this is deterministic — getNextStep is
 *      pure on state, and the bot just asked the SAME slot it is
 *      still waiting on, since the slot is unfilled).
 *   3. If that slot is single_select with options, maps digit → option
 *      value and routes through the engine's `applyAnswer` helper —
 *      same canonical write path used by chip answers in the web
 *      widget. That gives us, for free, the matter-type reroute
 *      (rerouteFromCorporateGeneral / rerouteFromRealEstateGeneral),
 *      questionHistory + answeredQuestionGroups updates, advisory
 *      subtrack derivation, and band/completeness recompute.
 *
 * Lives OUTSIDE src/lib/screen-engine/ so the engine remains
 * byte-for-byte mirrored with the sandbox (DR-033). This is a
 * server-only adapter helper — the web sandbox uses chip-based UI for
 * single_select slots, not free-text typing.
 *
 * Defensive guards:
 *   - Only fires when the next-step slot is currently empty (no
 *     overwrite of prior answer).
 *   - Validates the digit is in range [1, options.length].
 *   - Tolerates a few common phrasings: "2", "2.", " 2 ", "option 2",
 *     "Option 2.", "#2".
 *   - No-op if the next-step slot is not single_select or has no
 *     options.
 *   - No-op if the message has more than just a digit-equivalent
 *     (don't match "I'll pick option 2 and also..." — that's free text
 *     that should go through LLM).
 */

import { getNextStep, applyAnswer } from './screen-engine/control';
import type { EngineState, SlotDefinition } from './screen-engine/types';

// Matches a reply that is JUST a digit (with optional "option" / "#" /
// trailing period / whitespace). Captures the digit in group 1.
// Examples that match: "2", "2.", " 2 ", "Option 2", "option 2.", "#2",
//   "Number 2", "Choice 2"
// Examples that DON'T match: "I'll pick 2", "2 of them", "2 because",
//   "2 and 3" (multi-pick — punt to LLM / future fix).
const DIGIT_REPLY_RE = /^\s*(?:option\s+|#|number\s+|choice\s+)?(\d+)\.?\s*$/i;

export function applyNumericAnswerMapping(
  text: string,
  state: EngineState,
): EngineState {
  if (!text || typeof text !== 'string') return state;

  const m = DIGIT_REPLY_RE.exec(text);
  if (!m) return state;

  const digit = parseInt(m[1], 10);
  if (!Number.isFinite(digit) || digit < 1) return state;

  // Ask the engine which slot it is currently waiting on. getNextStep
  // is pure on state; since the bot just asked a slot that is still
  // empty, getNextStep returns that same slot.
  let next: ReturnType<typeof getNextStep>;
  try {
    next = getNextStep(state);
  } catch {
    // Defensive: if getNextStep throws for any reason (corrupt state,
    // unexpected matter type), skip the mapping rather than break the
    // whole turn.
    return state;
  }

  const slot = next.slot;
  if (!slot) return state;
  if (slot.input_type !== 'single_select') return state;
  if (!slot.options || slot.options.length === 0) return state;
  if (digit > slot.options.length) return state;

  // Don't overwrite if the slot is somehow already filled.
  if (state.slots[slot.id]) return state;

  const optionValue = slot.options[digit - 1]?.value;
  if (!optionValue) return state;

  // Route through the engine's canonical answer-apply helper instead of
  // writing slots/slot_meta directly. applyAnswer mirrors the web
  // widget's chip-click path: writes the slot + meta, appends to
  // questionHistory, adds the question_group to answeredQuestionGroups,
  // derives advisory subtrack, auto-populates advisory_specific_task,
  // reroutes corporate_general → sub-type (rerouteFromCorporateGeneral)
  // when slot is corporate_problem_type, reroutes real_estate_general
  // when slot is real_estate_problem_type, and recomputes
  // coreCompleteness + band + currentGap. Calling it here gives Meta
  // numeric replies the same effect as web chip clicks.
  return applyAnswer(state, slot.id, optionValue);
}

// ── Out-of-range digit detection ───────────────────────────────────────

export interface OutOfRangeDigitDetection {
  /** The slot the engine was waiting on (next-step). */
  slot: SlotDefinition;
  /** The digit the lead typed. */
  digit: number;
  /** Max valid option index for that slot (= options.length). */
  maxOption: number;
  /** Reason the digit was rejected. */
  reason: 'out_of_range' | 'zero_or_negative';
}

/**
 * Detect a digit-shaped reply that the numeric mapper REJECTED because
 * the digit was out of range for the current single_select slot.
 *
 * Field-detected 2026-05-25: lead typed "11" when bot showed options
 * 1-5, numeric mapper returned state unchanged (silent), engine
 * re-asked the same question without any acknowledgment. From the
 * lead's perspective: confusing loop.
 *
 * Returns `null` for any of:
 *   - Reply isn't a digit pattern
 *   - Next-step slot isn't single_select
 *   - Digit is in valid range (1 to options.length)
 *   - Slot is already filled
 *
 * Caller (channel-intake-processor) uses the returned info to send an
 * acknowledgment message via channel-send AND short-circuit the rest
 * of the turn so the bot doesn't proceed to re-ask the same slot
 * (which is what produced the loop). The session state is preserved
 * unchanged so the next inbound resumes from the same question.
 */
export function detectOutOfRangeDigitReply(
  text: string,
  state: EngineState,
): OutOfRangeDigitDetection | null {
  if (!text || typeof text !== 'string') return null;

  const m = DIGIT_REPLY_RE.exec(text);
  if (!m) return null;

  const digit = parseInt(m[1], 10);
  if (!Number.isFinite(digit)) return null;

  let next: ReturnType<typeof getNextStep>;
  try {
    next = getNextStep(state);
  } catch {
    return null;
  }

  const slot = next.slot;
  if (!slot) return null;
  if (slot.input_type !== 'single_select') return null;
  if (!slot.options || slot.options.length === 0) return null;
  if (state.slots[slot.id]) return null;

  if (digit < 1) {
    return { slot, digit, maxOption: slot.options.length, reason: 'zero_or_negative' };
  }
  if (digit > slot.options.length) {
    return { slot, digit, maxOption: slot.options.length, reason: 'out_of_range' };
  }

  // In range — normal numeric mapping handles it.
  return null;
}

/**
 * Build the acknowledgment message sent back to the lead when their
 * digit reply was out of range. Friendly + actionable. Re-lists the
 * slot's question and options so the lead has the context inline.
 */
export function buildOutOfRangeDigitReply(detection: OutOfRangeDigitDetection): string {
  const { slot, digit, maxOption } = detection;
  const optionList = slot.options!
    .map((o, idx) => `${idx + 1}. ${o.label}`)
    .join('\n');
  return `I didn't catch that — "${digit}" isn't one of the options. Please reply with a number from 1 to ${maxOption}, or describe your answer in words.\n\n${slot.question.trim()}\n\n${optionList}`;
}
