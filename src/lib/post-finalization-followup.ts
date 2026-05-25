/**
 * Post-finalization follow-up handler for Meta channel intakes.
 *
 * Field-detected 2026-05-25: lead's first intake finalized cleanly
 * (Band A shareholder_dispute lead landed). Then lead sent "when is
 * she calling me?" — channel-intake-processor classified it as a new
 * matter (matter_type='unknown') and asked for contact again. From
 * the lead's perspective: the bot forgot who they were and started
 * the intake from scratch.
 *
 * Fix: when (a) we have a finalized session for this sender within
 * the look-back window AND (b) the new message classifies as
 * 'unknown' (no fresh matter signal), treat it as a status / general
 * follow-up and respond like a secretary would. Don't start a new
 * intake.
 *
 * Heuristic rationale for the 'unknown' check: a genuinely new matter
 * description (e.g. "I have an employment issue now") would classify
 * to wrongful_dismissal / employment_general / etc. via the regex
 * pass in initialiseState. If matter_type is 'unknown' the message
 * carries no clear matter signal — it's a question, a thank-you,
 * an "ok", a "when will you call" — exactly the kind of follow-up
 * the secretary mode is designed for.
 *
 * Lives OUTSIDE src/lib/screen-engine/ — server-only adapter helper.
 * The web sandbox has its own UI for "thank you, you're done" so no
 * equivalent is needed there.
 */

import type { EngineState } from './screen-engine/types';

/** Shared first-name extraction. */
function firstNameFrom(state: EngineState): string {
  const fullName = state.slots['client_name'];
  if (!fullName || typeof fullName !== 'string') return '';
  return fullName.trim().split(/\s+/)[0] ?? '';
}

/**
 * Build the secretary-style reply for a returning lead whose intake
 * has already finalized.
 *
 * Pulls the lead's first name from the finalized session's
 * engine_state.slots.client_name (if available) so the response is
 * personalised. Falls back to a generic warm tone if the name is
 * missing (which shouldn't happen — contact-doctrine gate ensures
 * client_name is set before finalization — but defensive).
 */
export function buildPostFinalizationFollowUpMessage(
  finalizedEngineState: EngineState,
): string {
  const firstName = firstNameFrom(finalizedEngineState);
  const greeting = firstName ? `Hi ${firstName} —` : 'Hi —';

  return `${greeting} thanks for following up. We received your earlier message and a lawyer is reviewing your matter now. Once they've had a chance to look at it, they'll reach out to you directly using the contact info you shared. Most replies happen within a business day. If your situation is time-sensitive, please feel free to call the firm directly. Thanks for your patience.`;
}

// ── New-matter intent detection (Codex review follow-up) ────────────────
//
// The plain matter_type === 'unknown' gate is too generous when the
// lead's reply CLEARLY hints at a new matter ("another issue came up",
// "different problem", "new question") but doesn't carry enough matter
// keywords for the regex extractor to classify. Without this guard, the
// secretary-mode reply ("a lawyer is reviewing your matter") is a wrong
// answer — the lead wants to START a NEW intake, not check on the old
// one.
//
// Instead, when this guard fires, send a brief disambiguation:
//
//   "Quick check — is this about the matter you already submitted, or
//    a new issue you want to bring to the firm?"
//
// The lead's NEXT message either describes the new matter (regex picks
// up keywords → fresh intake) or signals "same" (which won't match any
// new-matter pattern → secretary-mode reply fires the original way).

const NEW_MATTER_INTENT_PATTERNS: RegExp[] = [
  /\banother\s+(?:issue|matter|problem|question|thing|case)\b/i,
  /\bdifferent\s+(?:issue|matter|problem|question|thing|case)\b/i,
  /\bnew\s+(?:issue|matter|problem|question|thing|case)\b/i,
  /\b(?:second|third|other)\s+(?:issue|matter|problem|question|thing|case)\b/i,
  /\balso\s+(?:need\s+help|need\s+a\s+lawyer|have\s+a)\b/i,
  /\bone\s+more\s+(?:question|thing|issue|matter)\b/i,
  /\bquick\s+question\b/i,
  /\bunrelated\b/i,
];

export function looksLikeNewMatterIntent(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return NEW_MATTER_INTENT_PATTERNS.some((re) => re.test(text));
}

/**
 * Disambiguation reply for the borderline case: matter_type='unknown'
 * AND a recent finalized session exists AND the message signals a
 * possible new matter. Don't lock the lead into the secretary reply
 * (which would be wrong if they're flagging a new matter), don't
 * start fresh intake either (which would be wrong if they're just
 * following up on the existing one). Ask which it is and let the
 * next inbound route accordingly.
 */
export function buildPostFinalizationDisambiguationMessage(
  finalizedEngineState: EngineState,
): string {
  const firstName = firstNameFrom(finalizedEngineState);
  const greeting = firstName ? `Hi ${firstName} —` : 'Hi —';

  return `${greeting} quick check before I route this. Is this about the matter you already submitted (the lawyer is reviewing that one), or is this a new issue you'd like help with?`;
}
