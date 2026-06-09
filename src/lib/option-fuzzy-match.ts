/**
 * Fuzzy option matcher for single_select replies (#174, 2026-06-09).
 *
 * Operator directive after the WhatsApp launch retest: "we must be able
 * to understand answers with minor typos." A lead answering a numbered
 * question on a phone keyboard will fat-finger. "startign a new busines",
 * "one", "buying", a stray leading backtick. Each of those should map to
 * the obvious option instead of dropping to the clarifier.
 *
 * This is the single matcher for "lead reply text -> canonical option
 * value." It is layered, and each layer returns ONLY on an unambiguous
 * single best match. When two options are close, or nothing is close, it
 * returns null so the caller re-asks (DR-061 sticky re-ask). Guessing
 * wrong is worse than asking again.
 *
 * Layers (first hit wins):
 *   1. Digit, leading-junk tolerant: "1", "`1", " 1.", "Option 2", "#3".
 *   2. Word-number: "one".."ten", "first".."tenth" -> option N.
 *   3. Normalized exact match to an option value or label.
 *   4. Token-subset: the reply's content tokens (stopwords dropped) are a
 *      subset of exactly one option's label tokens. "buying" ->
 *      "Buying into an existing business"; "new business" -> "Starting a
 *      new business".
 *   5. Edit distance (damerauLevenshtein, reused from triage-search):
 *      normalized distance to each label; map to the best only if it is
 *      within threshold AND clearly better than the runner-up.
 *
 * Lives in lib/ (server-only adapter helper, app-only). No engine change,
 * no sandbox mirror.
 */

import { damerauLevenshtein } from './triage-search';
import type { SlotOption } from './screen-engine/types';

// ── Patterns ─────────────────────────────────────────────────────────────

// Leading-junk-tolerant bare digit (mirrors DIGIT_REPLY_RE in
// pending-slot-reply / numeric-option-mapping, kept inline so this module
// is self-contained).
const DIGIT_REPLY_RE = /^[\s`'"‘’“”]*(?:option\s+|#|number\s+|choice\s+)?(\d+)\.?\s*$/i;

// Affirmative / negative / non-answer sentinels (and their common
// misspellings) for slots whose options are Yes / No / Not sure shaped.
const YES_SENTINEL_RE = /^\s*(yes|yea|yeah|yep|yup|ya|y|sure|ok|okay|correct|right|absolutely|definitely)\s*\.?\s*$/i;
const NO_SENTINEL_RE = /^\s*(no|noo|nope|nah|naw|n|not\s+really|negative)\s*\.?\s*$/i;
const NOT_SURE_SENTINEL_RE =
  /^\s*((i\s+)?(don'?t|do\s*not|dont)\s+know|dunno|idk|no\s+idea|not\s+sure|notsure|unsure|unknown|maybe|n\s*\/\s*a|not\s+applicable)\s*\.?\s*$/i;

// Word-numbers and ordinals, index = option position (1-based).
const WORD_NUMBERS: Record<string, number> = {
  one: 1, first: 1, '1st': 1,
  two: 2, second: 2, '2nd': 2,
  three: 3, third: 3, '3rd': 3,
  four: 4, fourth: 4, '4th': 4,
  five: 5, fifth: 5, '5th': 5,
  six: 6, sixth: 6, '6th': 6,
  seven: 7, seventh: 7, '7th': 7,
  eight: 8, eighth: 8, '8th': 8,
  nine: 9, ninth: 9, '9th': 9,
  ten: 10, tenth: 10, '10th': 10,
};

// Tokens that carry no discriminating signal in an option label. Dropped
// before token-subset matching so "new business" matches "Starting a new
// business" without the filler words getting in the way.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'into', 'or', 'and', 'to', 'in', 'on', 'with',
  'for', 'my', 'your', 'is', 'are', 'i', 'im', 'i\'m', 'am', 'it', 'its',
]);

// Edit-distance acceptance: normalized distance (edits / longer length)
// must be at or below this to be a candidate.
const MAX_NORMALIZED_DISTANCE = 0.34;
// The best candidate's normalized distance must beat the runner-up by at
// least this margin, otherwise the match is ambiguous and we bail.
const AMBIGUITY_MARGIN = 0.12;

// ── Helpers ───────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[!?.,;:]+$/, '')
    .trim();
}

function contentTokens(s: string): string[] {
  return normalize(s)
    .split(/[\s/]+/)
    .map((t) => t.replace(/[^a-z0-9'’-]/g, ''))
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

// ── Main ────────────────────────────────────────────────────────────────

/**
 * Map a free-text reply to one of the slot's option values, tolerant of
 * typos. Returns the canonical option value, or null when no single
 * option is a confident match (caller should re-ask).
 */
export function fuzzyMatchOption(
  text: string,
  options: readonly SlotOption[],
): string | null {
  if (!text || typeof text !== 'string') return null;
  if (!options || options.length === 0) return null;

  const raw = text.trim();
  if (!raw) return null;

  // Layer 1: digit (leading-junk tolerant).
  const digitMatch = DIGIT_REPLY_RE.exec(raw);
  if (digitMatch) {
    const digit = parseInt(digitMatch[1], 10);
    if (Number.isFinite(digit) && digit >= 1 && digit <= options.length) {
      return options[digit - 1]?.value ?? null;
    }
    // Unambiguously a digit, just out of range. Bail (no fuzzy fallback).
    return null;
  }

  const norm = normalize(raw);
  if (!norm) return null;

  // Layer 2: word-number / ordinal as the WHOLE reply.
  const wordNum = WORD_NUMBERS[norm];
  if (wordNum !== undefined) {
    if (wordNum >= 1 && wordNum <= options.length) {
      return options[wordNum - 1]?.value ?? null;
    }
    return null;
  }

  // Layer 2.5: yes / no / not-sure sentinels (with misspellings) when the
  // option set has a matching Yes / No / Not-sure shaped option. Runs
  // before token-subset so "nope" maps even though it shares no token
  // with the "No" label.
  if (YES_SENTINEL_RE.test(raw)) {
    const yes = options.find((o) => /^yes\b/i.test(o.value) || /^yes\b/i.test(o.label));
    if (yes) return yes.value;
  }
  if (NO_SENTINEL_RE.test(raw)) {
    const no = options.find((o) => /^no\b/i.test(o.value) || /^no\b/i.test(o.label));
    if (no) return no.value;
  }
  if (NOT_SURE_SENTINEL_RE.test(raw)) {
    const notSure = options.find(
      (o) => /not\s+sure|unknown|n\/a/i.test(o.value) || /not\s+sure|unknown|n\/a/i.test(o.label),
    );
    if (notSure) return notSure.value;
  }

  // Layer 3: normalized exact match to value or label.
  for (const opt of options) {
    if (normalize(opt.value) === norm || normalize(opt.label) === norm) {
      return opt.value;
    }
  }

  // Layer 4: token-subset. The reply's content tokens are a subset of
  // exactly one option's label tokens.
  const replyTokens = contentTokens(raw);
  if (replyTokens.length > 0) {
    const subsetHits: SlotOption[] = [];
    for (const opt of options) {
      const labelTokenSet = new Set(contentTokens(opt.label));
      const valueTokenSet = new Set(contentTokens(opt.value));
      const allInLabel = replyTokens.every((t) => labelTokenSet.has(t));
      const allInValue = replyTokens.every((t) => valueTokenSet.has(t));
      if (allInLabel || allInValue) subsetHits.push(opt);
    }
    if (subsetHits.length === 1) return subsetHits[0].value;
    // More than one option contains all the reply tokens: ambiguous,
    // fall through to edit distance which may still disambiguate, else null.
  }

  // Layer 5: edit distance against each label, normalized by the longer
  // string. Accept the best only if within threshold and clearly ahead of
  // the runner-up.
  let best = { value: null as string | null, dist: Number.POSITIVE_INFINITY };
  let runnerUp = Number.POSITIVE_INFINITY;
  for (const opt of options) {
    const label = normalize(opt.label);
    const longer = Math.max(label.length, norm.length) || 1;
    const dist = damerauLevenshtein(norm, label) / longer;
    if (dist < best.dist) {
      runnerUp = best.dist;
      best = { value: opt.value, dist };
    } else if (dist < runnerUp) {
      runnerUp = dist;
    }
  }

  if (
    best.value !== null &&
    best.dist <= MAX_NORMALIZED_DISTANCE &&
    runnerUp - best.dist >= AMBIGUITY_MARGIN
  ) {
    return best.value;
  }

  return null;
}
