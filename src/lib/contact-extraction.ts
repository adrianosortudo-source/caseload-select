/**
 * Contact extraction from inbound turn text.
 *
 * Closes a gap in the multi-turn channel intake loop (Messenger /
 * Instagram / WhatsApp): when the bot asks "share your name and best
 * phone or email" and the lead replies with bare contact info, the
 * engine had no way to capture it. The LLM is forbidden from extracting
 * contact slots (see schema.ts EXCLUDED_FROM_LLM — anti-hallucination
 * discipline), the slot evidence registry has no evidence_patterns
 * configured for contact slots, and the existing regex
 * `extractContactName` only fires on turn 1 inside `initialiseState`
 * AND requires an explicit intro phrase ("my name is …").
 *
 * This module runs on EVERY turn (turn 1 and resume turns) from
 * `channel-intake-processor`, AFTER the standard evidence pass and
 * before the contact-doctrine gate evaluation. It only fills slots
 * that are currently empty — channel-metadata pre-fill, voice caller-ID
 * pre-fill, and turn-1 self-introduction (extractContactName) all
 * take precedence and are not overwritten.
 *
 * Lives OUTSIDE `src/lib/screen-engine/` so the engine remains
 * byte-for-byte mirrored with the sandbox (DR-033). This extractor is
 * server-only — the web sandbox engine fills contact via the form's
 * dedicated fields, not from message body text — so the sandbox does
 * not need an equivalent.
 *
 * Detection strategy:
 *   - Email: standard RFC-5322-subset regex (no localpart edge cases).
 *   - Phone: North American 10-digit pattern (with optional +1, common
 *     separators). Normalised to E.164 `+1NXXNXXXXXX`.
 *   - Name: bare-name pattern (1-3 capitalised tokens) — but ONLY when
 *     the same message body also contains an email or phone match.
 *     That guard rules out casual chat ("I have a question for John
 *     Smith") and limits the bare-name capture to the contact-reply
 *     context where the bot just asked for contact.
 */

import type { EngineState } from './screen-engine/types';
import { isWeakName } from './screen-engine/selector';

// ── Regex patterns ──────────────────────────────────────────────────────

// Email — pragmatic subset. Matches the vast majority of real addresses;
// rejects unicode local parts and quoted strings (rare in legal intake).
const EMAIL_RE = /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/;

// North American phone (NANP). Captures area code + exchange + number;
// allows optional country code, common separators (space, dot, hyphen),
// optional parentheses around area code. Area code must start 2-9 (NANP
// rule — area codes never start with 0 or 1).
const PHONE_NA_RE = /(?:\+?1[-.\s]?)?\(?([2-9]\d{2})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})\b/;

// Bare-name line: 1-3 capitalised tokens, no digits/punctuation other
// than apostrophe / hyphen (handles "O'Brien", "Jean-Claude"). Length
// cap 30 per token matches extractContactName. The pattern is anchored
// so the WHOLE chunk must be a name — rules out "Sarah Patel's email is".
const BARE_NAME_RE = /^[A-Z][a-zA-Z'’\-]{1,29}(?:\s+[A-Z][a-zA-Z'’\-]{1,29}){0,2}$/;

// Tokens that look like proper nouns but aren't names (mirror of
// extractor.ts NAME_BLOCKLIST, kept in sync manually because that one
// lives inside the engine module and we want to avoid cross-imports
// that complicate the engine sync discipline).
const NAME_BLOCKLIST = new Set<string>([
  'sad', 'sorry', 'tired', 'angry', 'frustrated', 'concerned', 'worried',
  'looking', 'writing', 'reaching', 'asking', 'wondering', 'seeking',
  'urgent', 'here', 'about', 'the', 'a', 'an',
  'mr', 'mrs', 'ms', 'dr', // honorifics alone aren't names
  'hi', 'hello', 'hey', 'thanks', 'thank', 'yes', 'no', 'ok', 'okay',
  'sure', 'sent', 'done', 'great', 'good', 'morning', 'afternoon', 'evening',
]);

// ── Output shape ────────────────────────────────────────────────────────

export interface ExtractedContact {
  name?: string;
  email?: string;
  /** E.164 format, e.g. +14165551234 */
  phone?: string;
}

// ── Pure extractor ──────────────────────────────────────────────────────

/**
 * Options for extractContactFromTurn.
 */
export interface ExtractContactOpts {
  /**
   * Name-capture context (#171, 2026-06-09). When true, the caller has
   * established that the bot just asked the lead for their name (e.g.
   * via `capture_contact(client_name)` on an async channel). In that
   * mode the bare-name extraction lifts the "email/phone must also be
   * present" guard and accepts a name-only reply, AND uses a more
   * permissive title-casing matcher so lowercase or all-caps inputs
   * still parse. The matcher still filters via NAME_BLOCKLIST and the
   * isWeakName heuristic; replies like "ok", "yes", "A D" still fail
   * and leave client_name unchanged so the bot can re-ask.
   *
   * Default off. Turn-1 self-intro / casual matter descriptions never
   * set this flag, so the original anti-false-positive guard still
   * protects the upstream paths.
   */
  nameCaptureContext?: boolean;
}

/** "my name is X" / "I'm X" / "this is X" / "it's X" intro phrases. */
const NAME_INTRO_RE =
  /\b(?:my\s+name\s+is|i\s+am|i'?m|this\s+is|it'?s|name'?s|the\s+name'?s)\s+([A-Za-zÀ-ÖØ-öø-ÿ'’\-]{2,30}(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ'’\-]{2,30}){0,2})\b/i;

/** Title-case each whitespace-separated token. */
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join(' ');
}

/** Strip trailing punctuation from a candidate name reply. */
function stripTrailingPunctuation(s: string): string {
  return s.replace(/[!?.,;:]+\s*$/, '').trim();
}

/**
 * Try to interpret a turn's text as a bare-name reply in name-capture
 * context. Returns the normalised name (title-cased) or null when the
 * text does not parse as a plausible human name.
 *
 * Filters:
 *  - Strips trailing punctuation
 *  - Tries the intro-phrase regex first ("my name is X", "I'm X")
 *  - Falls back to bare 1-3 token reply, letter-only (allows accented,
 *    hyphen, apostrophe), each token 2-30 chars
 *  - Title-cases the output
 *  - Rejects via NAME_BLOCKLIST on first token (mr/dr/yes/no/etc)
 *  - Rejects via isWeakName (initials, single short token, generic
 *    placeholders)
 */
function tryExtractCaptureContactName(text: string): string | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = stripTrailingPunctuation(text.trim());
  if (!trimmed) return null;

  let candidate: string | null = null;

  // 1. Intro phrase: "my name is Adriano Domingues" / "I'm Adriano"
  const intro = NAME_INTRO_RE.exec(trimmed);
  if (intro && intro[1]) {
    candidate = titleCase(intro[1]);
  }

  // 2. Bare reply: 1-3 letter-only tokens
  if (!candidate) {
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length < 1 || tokens.length > 3) return null;
    for (const t of tokens) {
      if (!/^[A-Za-zÀ-ÖØ-öø-ÿ'’\-]{2,30}$/.test(t)) return null;
    }
    candidate = titleCase(trimmed);
  }

  if (!candidate) return null;

  // Blocklist check on first token after title-casing.
  const firstToken = candidate.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (NAME_BLOCKLIST.has(firstToken)) return null;

  // Weak-name check (same heuristic the engine uses for profile_metadata).
  if (isWeakName(candidate)) return null;

  return candidate;
}

/**
 * Pull email / phone / bare-name from a single turn's text. Pure
 * function, no state, no I/O. Used by `applyContactExtractionToState`
 * to update the engine state, and exported separately for testing.
 *
 * Bare-name extraction by default is gated on the same message
 * containing an email or phone match. This guard makes the function
 * safe to run on every turn including turn 1: a casual matter
 * description like "My mother passed and the estate involves Sarah
 * Patel as executor" does NOT accidentally set client_name='Sarah
 * Patel' because no email or phone is in the same message.
 *
 * When opts.nameCaptureContext is true (the caller established that
 * the bot just asked the lead's name on the previous turn), the
 * email/phone guard is LIFTED for bare-name extraction. A bare reply
 * like "Adriano Domingues" then parses correctly. The blocklist and
 * weak-name filters still apply, so junk replies do not fill the slot.
 */
export function extractContactFromTurn(
  text: string,
  opts?: ExtractContactOpts,
): ExtractedContact {
  const result: ExtractedContact = {};
  if (!text || typeof text !== 'string') return result;

  // Email
  const emailMatch = EMAIL_RE.exec(text);
  if (emailMatch) {
    result.email = emailMatch[0];
  }

  // Phone, normalised to E.164 NA format (+1 + 10 digits)
  const phoneMatch = PHONE_NA_RE.exec(text);
  if (phoneMatch) {
    result.phone = `+1${phoneMatch[1]}${phoneMatch[2]}${phoneMatch[3]}`;
  }

  // Name-capture context: lift the email/phone guard, use the lenient
  // capture-reply matcher (title-casing + intro phrase + blocklist +
  // isWeakName filters). This is the path that closes the loop when
  // the bot asks "What is your name?" and the lead replies with a
  // bare name.
  if (opts?.nameCaptureContext) {
    const captured = tryExtractCaptureContactName(text);
    if (captured) {
      result.name = captured;
      return result;
    }
  }

  // Default path: bare-name extraction only when this message also
  // has email or phone (proves contact-reply context, not casual chat)
  if (result.email || result.phone) {
    const chunks = text
      .split(/[\n,|;]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    for (const chunk of chunks) {
      if (!BARE_NAME_RE.test(chunk)) continue;
      const firstToken = chunk.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (NAME_BLOCKLIST.has(firstToken)) continue;
      result.name = chunk;
      break;
    }
  }

  return result;
}

// ── State mutator ───────────────────────────────────────────────────────

/**
 * Apply extracted contact to the engine state. Only fills slots that
 * are currently empty — channel metadata pre-fill, voice caller-ID
 * pre-fill, and `extractContactName` (turn 1 intro-phrase capture) all
 * take precedence.
 *
 * Returns the original state object if nothing was extracted or if all
 * extracted fields collide with already-filled slots. The shallow-clone
 * happens only when at least one slot will change.
 */
export function applyContactExtractionToState(
  text: string,
  state: EngineState,
  opts?: ExtractContactOpts,
): EngineState {
  const extracted = extractContactFromTurn(text, opts);
  if (!extracted.name && !extracted.email && !extracted.phone) {
    return state;
  }

  const slots = { ...state.slots };
  const slot_meta = { ...state.slot_meta };
  let changed = false;

  // -------------------------------------------------------------------------
  // Bug fix 2026-06-02 (#137 minimum viable slice, per operator direction):
  //
  // The previous guards (`!slots['client_name']`, etc.) blocked later
  // corrections from overriding earlier captures. When the caller corrects
  // their name spelling, phone number, or email later in the call, the
  // extractor's first-extract-wins behavior meant the lawyer brief showed
  // the incorrect early value with provenance label "Stated in description".
  //
  // For tonight's slice (option a): if a later extracted candidate value
  // differs from the current slot value AND the current source is at
  // 'explicit'-or-lower precedence, promote the later one.
  //
  // Precedence respect — stronger sources are NOT overwritten by later
  // turn-text extraction:
  //   - 'answered' (channel pre-fill, e.g. Facebook sender display name):
  //     more trusted than a bare-name from message body. KEEP.
  //   - 'explicit' (a previous turn extracted it from user text): same-
  //     strength as the new candidate, so a later correction wins. OVERWRITE.
  //   - 'inferred' (LLM derived it): weaker than explicit. OVERWRITE.
  //   - 'unknown' / unset: nothing to protect. OVERWRITE.
  //
  // IMPORTANT - do NOT overclaim provenance. The agent has NOT actually
  // performed readback-confirmation at this layer. We continue to tag the
  // captured source as 'explicit' (renders as "Stated during call" in the
  // brief), NOT as 'confirmed_by_caller_after_readback'. The stronger label
  // is reserved for the future readback-detection logic (#137 phase 2).
  // -------------------------------------------------------------------------

  // SlotMetaSource values that are MORE TRUSTED than mid-conversation text
  // extraction, and which this layer must NOT overwrite. Future-proof: if
  // SlotMetaSource gets extended (e.g. with 'confirmed_by_caller_after_readback'),
  // add new sentinel values here so the precedence guard still holds.
  const PROTECTED_SOURCES = new Set(['answered']);

  if (extracted.name) {
    const current = slots['client_name'];
    const currentSource = slot_meta['client_name']?.source;
    const isProtected =
      currentSource !== undefined && PROTECTED_SOURCES.has(currentSource);
    const shouldPromote = !current || (current !== extracted.name && !isProtected);
    if (shouldPromote) {
      slots['client_name'] = extracted.name;
      slot_meta['client_name'] = {
        source: 'explicit',
        evidence: current
          ? `corrected from "${current}" via later turn (#137 option-a precedence)`
          : 'bare-name regex from contact-reply turn',
        confidence: 0.85,
      };
      changed = true;
    }
  }

  if (extracted.email) {
    const current = slots['client_email'];
    const currentSource = slot_meta['client_email']?.source;
    const isProtected =
      currentSource !== undefined && PROTECTED_SOURCES.has(currentSource);
    const shouldPromote = !current || (current !== extracted.email && !isProtected);
    if (shouldPromote) {
      slots['client_email'] = extracted.email;
      slot_meta['client_email'] = {
        source: 'explicit',
        evidence: current
          ? `corrected from "${current}" via later turn (#137 option-a precedence)`
          : 'email regex from turn text',
        confidence: 0.95,
      };
      changed = true;
    }
  }

  if (extracted.phone) {
    const current = slots['client_phone'];
    const currentSource = slot_meta['client_phone']?.source;
    const isProtected =
      currentSource !== undefined && PROTECTED_SOURCES.has(currentSource);
    const shouldPromote = !current || (current !== extracted.phone && !isProtected);
    if (shouldPromote) {
      slots['client_phone'] = extracted.phone;
      slot_meta['client_phone'] = {
        source: 'explicit',
        evidence: current
          ? `corrected from "${current}" via later turn (#137 option-a precedence)`
          : 'phone regex from turn text',
        confidence: 0.95,
      };
      changed = true;
    }
  }

  if (!changed) return state;
  return { ...state, slots, slot_meta };
}
