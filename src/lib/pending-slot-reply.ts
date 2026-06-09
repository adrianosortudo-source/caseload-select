/**
 * Pending-slot reply router (#172, 2026-06-09).
 *
 * Field repro: a WhatsApp business_setup_advisory lead answered
 * `advisory_path` with "1". The bot then asked "What is your name?"
 * (capture_contact, weak profile name per #169) and on the next turn
 * RE-asked advisory_path. The "1" was lost.
 *
 * Root cause: every existing reply-mapping adapter (numeric-option-
 * mapping, free-text-fuzzy-match, free-text-answer-mapping) routes
 * via `getNextStep(state).slot`. That call returns what the engine
 * WANTS now, not what the bot ACTUALLY asked on the previous turn.
 * After #169 the engine can shift its preferred next slot between
 * turns (e.g., from advisory_path to capture_contact(client_name)
 * because contactCaptureStarted is now true and profile name is
 * weak). The user's reply to the original question gets routed to
 * the wrong slot, fails the matchers, and is discarded.
 *
 * Fix: track `pendingAskedSlotId` on engine state. Phase C sets it
 * when sending a question. On the next inbound turn, this helper
 * runs BEFORE the engine-preference-based adapters and routes the
 * reply to the slot we ACTUALLY asked. Once consumed, the field is
 * cleared and the remaining processor pipeline (contact extraction,
 * other adapters, LLM, Phase C) runs on the updated state, with the
 * engine free to choose the NEXT slot to ask.
 *
 * Boundaries:
 *  - Skips contact slots (tier='contact'): those go through
 *    `applyContactExtractionToState` with its specialised email /
 *    phone / bare-name validators and the #171 nameCaptureContext
 *    flag. Routing contact slots here would either bypass those
 *    validators or duplicate them.
 *  - Skips already-filled slots and clears the stale pointer.
 *  - Skips when there is no pendingAskedSlotId at all (e.g., fresh
 *    turn, or legacy session created before #172 added the field).
 *  - Returns the input state unchanged when the reply does not match
 *    a known shape (digit out of range, free-text too long, etc.).
 *    The pointer stays so the engine re-asks the same slot.
 */

import { applyAnswer } from './screen-engine/control';
import { SLOT_REGISTRY } from './screen-engine/slotRegistry';
import type { EngineState, SlotDefinition } from './screen-engine/types';

// ── Reply-shape patterns (parallel to numeric-option-mapping +
//    free-text-answer-mapping; kept inline here to avoid coupling
//    this slot-routed adapter to those getNextStep-driven ones) ──

/** Bare digit reply: "1", "1.", "Option 1", "#1", " 1 ", etc. */
const DIGIT_REPLY_RE = /^\s*(?:option\s+|#|number\s+|choice\s+)?(\d+)\.?\s*$/i;

/** yes / no / "not sure" sentinels for single_select fuzzy matching. */
const YES_SENTINEL_RE = /^\s*(yes|yeah|yep|yup|y|sure|ok|okay|correct|right|absolutely|definitely)\s*\.?\s*$/i;
const NO_SENTINEL_RE = /^\s*(no|nope|nah|n|not\s+really|negative)\s*\.?\s*$/i;
const NOT_SURE_SENTINEL_RE =
  /^\s*((i\s+)?(don'?t|do\s*not)\s+know|dont\s+know|idk|no\s+idea|not\s+sure|unsure|unknown|n\s*\/\s*a|not\s+applicable)\s*\.?\s*$/i;

/** Maximum length for a free_text slot reply before we treat it as a description. */
const MAX_FREE_TEXT_REPLY_LENGTH = 60;

/** Looks like an email or phone, defer to contact-extraction. */
const EMAIL_LIKE_RE = /@/;
const PHONE_LIKE_RE = /^\+?[\d().\s-]{7,}$/;

// ── Option matchers ─────────────────────────────────────────────────────

/**
 * For a single_select slot, try to map the reply to a canonical option
 * value. Order: numeric (digit → options[N-1]), then yes/no/not-sure
 * sentinel mapping against option labels.
 *
 * Returns the option value string when matched, null otherwise.
 */
function matchSingleSelectOption(
  text: string,
  slot: SlotDefinition,
): string | null {
  const options = slot.options ?? [];
  if (options.length === 0) return null;

  // Numeric mapping ("1" → options[0])
  const digitMatch = DIGIT_REPLY_RE.exec(text);
  if (digitMatch) {
    const digit = parseInt(digitMatch[1], 10);
    if (Number.isFinite(digit) && digit >= 1 && digit <= options.length) {
      return options[digit - 1]?.value ?? null;
    }
    // Digit out of range; do NOT fall through to fuzzy (the reply was
    // unambiguously a digit, just an invalid one). Engine will re-ask.
    return null;
  }

  // Fuzzy match against option labels (case-insensitive prefix or full).
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;

  // Sentinel yes / no / not-sure mapping when the slot has matching
  // option values.
  if (YES_SENTINEL_RE.test(text)) {
    const yes = options.find((o) => /^yes\b/i.test(o.value));
    if (yes) return yes.value;
  }
  if (NO_SENTINEL_RE.test(text)) {
    const no = options.find((o) => /^no\b/i.test(o.value));
    if (no) return no.value;
  }
  if (NOT_SURE_SENTINEL_RE.test(text)) {
    const notSure = options.find((o) => /not\s+sure|unknown|n\/a/i.test(o.value));
    if (notSure) return notSure.value;
  }

  // Verbatim option-label match
  for (const opt of options) {
    if (opt.value.toLowerCase() === trimmed) return opt.value;
    if (opt.label.toLowerCase() === trimmed) return opt.value;
  }

  return null;
}

/**
 * For a free_text slot, return the value to write or null to skip.
 * Filters out replies that look like contact info (handled by the
 * contact-extraction path) or that are too long to be a slot answer.
 */
function matchFreeTextReply(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_FREE_TEXT_REPLY_LENGTH) return null;
  if (EMAIL_LIKE_RE.test(trimmed)) return null;
  if (PHONE_LIKE_RE.test(trimmed)) return null;
  // Affirmative / negative sentinels do not make sense for free-text
  // slots like "Which city?", let the engine re-ask.
  if (YES_SENTINEL_RE.test(trimmed)) return null;
  if (NO_SENTINEL_RE.test(trimmed)) return null;
  // "Not sure" replies on free-text become the canonical "Not sure"
  // (matches the existing free-text-answer-mapping convention).
  if (NOT_SURE_SENTINEL_RE.test(trimmed)) return 'Not sure';
  return trimmed;
}

// ── Main entry ──────────────────────────────────────────────────────────

/**
 * If `state.pendingAskedSlotId` points to an unfilled slot, try to map
 * the lead's reply to that specific slot via numeric / fuzzy (single_
 * select) or verbatim write (free_text). Routes through `applyAnswer`
 * so the engine's downstream side effects fire (matter-type reroute,
 * questionHistory, advisory subtrack, completeness recompute).
 *
 * Returns the (possibly updated) state. Always clears
 * `pendingAskedSlotId` when it points to a stale or filled slot; only
 * preserves the pointer when the slot still genuinely needs an answer.
 *
 * Skips contact slots: those flow through `applyContactExtractionToState`
 * with its own validators (email regex, phone regex, weak-name guard).
 */
/**
 * Slot meta sources that do NOT count as a user-grounded answer.
 * When the bot is actively asking a slot via pendingAskedSlotId and
 * the slot is "filled" with one of these sources, the user's reply
 * MUST be allowed to overwrite. Otherwise the loop fires: Gemini
 * pre-fills the slot from the description on turn 1 (source
 * 'llm_inferred'), the engine treats it as unanswered (correct, per
 * the v2.2 provenance discipline), Phase C asks the question, the
 * user replies, every adapter bails because the slot is "filled",
 * the source stays 'llm_inferred', and the engine asks again.
 * Field-detected 2026-06-09 (#172 follow-up).
 */
const WEAK_PROVENANCE_SOURCES: ReadonlySet<string> = new Set([
  'llm_inferred',
  'unknown',
]);

/**
 * Returns true when the slot is filled with a value that the user
 * grounded (answered button, regex evidence from their typed text).
 * Returns false for empty slots OR slots only filled by LLM hint /
 * unknown defensive bucket. Those should be overwritable when the
 * bot is asking the same slot.
 */
function isUserGroundedFill(state: EngineState, slotId: string): boolean {
  const value = state.slots[slotId];
  if (!value) return false;
  const source = state.slot_meta[slotId]?.source ?? 'unknown';
  return !WEAK_PROVENANCE_SOURCES.has(source);
}

export function applyPendingSlotReply(
  text: string,
  state: EngineState,
): EngineState {
  const slotId = state.pendingAskedSlotId;
  if (!slotId) return state;

  const slot = SLOT_REGISTRY.find((s) => s.id === slotId);
  if (!slot) {
    return { ...state, pendingAskedSlotId: null };
  }

  // Contact slots: ALWAYS defer to applyContactExtractionToState, even
  // when the slot already has a value. Profile_metadata seeds (weak
  // names like "A D") fill the slot but still need a real user-typed
  // name to upgrade. Touching the pointer here would clear it before
  // the caller's nameCaptureContext detection runs, which checks
  // pendingAskedSlotId === 'client_name' to lift the email/phone guard.
  if (slot.tier === 'contact') return state;

  // Slot is user-grounded already (answered / explicit / inferred from
  // regex on user text). Don't overwrite via Phase C reply, clear the
  // stale pointer, and pass through. Weak-provenance fills
  // (llm_inferred, unknown) fall through so applyAnswer can upgrade them.
  if (isUserGroundedFill(state, slotId)) {
    return { ...state, pendingAskedSlotId: null };
  }

  if (!text || typeof text !== 'string') return state;
  const trimmed = text.trim();
  if (!trimmed) return state;

  if (slot.input_type === 'single_select') {
    const optionValue = matchSingleSelectOption(trimmed, slot);
    if (!optionValue) return state;
    const next = applyAnswer(state, slotId, optionValue);
    return { ...next, pendingAskedSlotId: null };
  }

  if (slot.input_type === 'free_text') {
    const value = matchFreeTextReply(trimmed);
    if (!value) return state;
    const next = applyAnswer(state, slotId, value);
    return { ...next, pendingAskedSlotId: null };
  }

  // Unknown input_type: don't risk writing the wrong shape.
  return state;
}
