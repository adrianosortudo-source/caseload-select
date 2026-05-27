/**
 * Free-text answer mapping for Phase C / discovery replies on
 * `free_text` slots.
 *
 * Field-detected 2026-05-27, DRG Messenger lead L-2026-05-27-R2X
 * (Adriano test). business_setup_advisory flow, bot asked "Which city
 * or region will the business be based in?" (free_text slot
 * `business_location`). Lead replied "toronto". Engine asked the same
 * question again. Lead replied "toronto" again. The slot stayed null
 * — there was no adapter to map a bare free-text reply to the
 * current open free-text slot.
 *
 * Companion to:
 *   - numeric-option-mapping.ts   (digit reply → single_select option)
 *   - free-text-fuzzy-match.ts    (yes/no/dont-know → single_select option)
 * This file:                       (short free-text reply → free_text slot)
 *
 * Same mechanism: look at the engine's next-step slot (deterministic
 * on resume — the bot just asked the currently-unfilled slot). If the
 * slot is `free_text` AND the reply is a short non-sentinel, fill it
 * via applyAnswer. The chip-answer path through applyAnswer gets the
 * reroute side effects, completeness recompute, and band recompute
 * for free.
 *
 * Guardrails (no-op when):
 *   - Reply is empty or too long (>60 chars → probably a matter
 *     description, not a slot answer)
 *   - Reply is a digit only (handled by numeric-option-mapping)
 *   - Reply is a yes/no/dont-know sentinel (handled by
 *     free-text-fuzzy-match)
 *   - Reply looks like an email or phone (handled by
 *     contact-extraction, dedicated regex)
 *   - Next-step slot isn't free_text
 *   - Next-step slot is already filled
 *
 * Lives OUTSIDE src/lib/screen-engine/ — server-only adapter helper.
 * Web sandbox uses a typed form input; no equivalent needed there.
 */

import { getNextStep, applyAnswer } from './screen-engine/control';
import type { EngineState } from './screen-engine/types';

// ── Reply-shape guards ──────────────────────────────────────────────────

/** Replies longer than this are probably matter descriptions, not slot answers. */
const MAX_FREE_TEXT_ANSWER_LENGTH = 60;

/**
 * Sentinels that DO NOT apply to free-text slots. yes/no answers don't
 * make sense for "What's your postal code?" or "Which city?" — they're
 * for single_select slots and free-text-fuzzy-match handles them. If
 * one slips through (slot definition is free_text but the question is
 * binary), we still bail to avoid filling a city slot with "Yes".
 */
const SENTINEL_AFFIRMATIVE_RE =
  /^\s*(yes|yeah|yep|yup|y|sure|ok|okay|correct|right|absolutely|definitely)\s*\.?\s*$/i;
const SENTINEL_NEGATIVE_RE =
  /^\s*(no|nope|nah|n|not\s+really|negative)\s*\.?\s*$/i;

/**
 * Non-answer sentinels DO apply to free-text slots. Many free-text
 * questions explicitly accept "if you know" / "if applicable" framing
 * (ownership_percentage: "What percentage do you own, if you know?").
 * When the lead replies "not sure" / "dont know" / "idk", the engine
 * should record that as a legitimate answer (canonical "Not sure")
 * rather than re-asking. Codex pushback 2026-05-27: previously this
 * adapter bailed on these, free-text-fuzzy-match also bailed (it
 * only handles single_select), so the free-text slot looped.
 */
const SENTINEL_NON_ANSWER_RE =
  /^\s*((i\s+)?(don'?t|do\s*not)\s+know|dont\s+know|idk|no\s+idea|not\s+sure|unsure|unknown|n\s*\/\s*a|not\s+applicable)\s*\.?\s*$/i;

/** The canonical value we write when a non-answer sentinel matches a free-text slot. */
const NON_ANSWER_CANONICAL = 'Not sure';

/** Looks like an email — let contact-extraction handle it. */
const EMAIL_LIKE_RE = /@/;

/**
 * Looks like a phone — let contact-extraction handle it. Matches +1
 * prefix, parens, dashes, dots, spaces between digits. Requires at
 * least 7 digits total to avoid catching things like a unit number
 * or a percentage figure ("40").
 */
const PHONE_LIKE_RE = /^\+?[\d().\s-]{7,}$/;

/**
 * Reply classification: 'fill_verbatim' (normal text answer or short
 * digit), 'fill_not_sure' (non-answer sentinel — write canonical
 * "Not sure"), or 'skip' (bail to a different adapter).
 *
 * Note (Codex pushback 2026-05-27): digit-only replies are now in the
 * fill_verbatim bucket, not skip. The numeric-option-mapping adapter
 * runs FIRST in the processor pipeline; if the next-step slot is
 * single_select, it consumes the digit and updates state. By the time
 * THIS adapter runs and sees a digit, the next-step slot is free_text
 * (otherwise numeric mapping would have fired), and the digit IS the
 * answer ("40" for ownership_percentage "if you know?"). Excluding
 * digits here left a coverage gap for free-text matter slots that
 * naturally take numeric answers.
 */
type ReplyDisposition = 'fill_verbatim' | 'fill_not_sure' | 'skip';

function classifyReply(text: string): { disposition: ReplyDisposition; trimmed: string } {
  if (!text || typeof text !== 'string') return { disposition: 'skip', trimmed: '' };
  const trimmed = text.trim();
  if (!trimmed) return { disposition: 'skip', trimmed: '' };
  if (trimmed.length > MAX_FREE_TEXT_ANSWER_LENGTH) return { disposition: 'skip', trimmed };
  if (SENTINEL_AFFIRMATIVE_RE.test(trimmed)) return { disposition: 'skip', trimmed };
  if (SENTINEL_NEGATIVE_RE.test(trimmed)) return { disposition: 'skip', trimmed };
  if (SENTINEL_NON_ANSWER_RE.test(trimmed)) return { disposition: 'fill_not_sure', trimmed };
  if (EMAIL_LIKE_RE.test(trimmed)) return { disposition: 'skip', trimmed };
  if (PHONE_LIKE_RE.test(trimmed)) return { disposition: 'skip', trimmed };
  return { disposition: 'fill_verbatim', trimmed };
}

// ── Main entry ──────────────────────────────────────────────────────────

/**
 * If the lead's reply is a short non-sentinel free-text answer AND
 * the engine's next-step slot is an unfilled `free_text` slot, write
 * the reply through applyAnswer. Returns the input state unchanged
 * otherwise.
 *
 * This is the dual of free-text-fuzzy-match: that one maps sentinels
 * to single_select options; this one maps short answers to free_text
 * slots. Both stop the "engine re-asks the same question" loop the
 * lead sees when their reply has no extraction path.
 */
export function applyFreeTextAnswerMapping(
  text: string,
  state: EngineState,
): EngineState {
  const { disposition, trimmed } = classifyReply(text);
  if (disposition === 'skip') return state;

  let next: ReturnType<typeof getNextStep>;
  try {
    next = getNextStep(state);
  } catch {
    return state;
  }

  const slot = next.slot;
  if (!slot) return state;
  if (slot.input_type !== 'free_text') return state;
  // Don't fire on contact slots — they have a dedicated extractor
  // (applyContactExtractionToState) that runs upstream and handles
  // the email / phone / bare-name shapes correctly. Catching
  // contact slots here would let arbitrary text ("About $75k") fill
  // client_email and corrupt the lawyer brief.
  if (slot.tier === 'contact') return state;
  if (state.slots[slot.id]) return state;

  const valueToWrite = disposition === 'fill_not_sure' ? NON_ANSWER_CANONICAL : trimmed;
  return applyAnswer(state, slot.id, valueToWrite);
}
