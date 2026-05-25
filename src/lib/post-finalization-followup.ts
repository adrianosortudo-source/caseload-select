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
  const fullName = finalizedEngineState.slots['client_name'];
  const firstName =
    fullName && typeof fullName === 'string'
      ? fullName.trim().split(/\s+/)[0]
      : '';

  const greeting = firstName ? `Hi ${firstName} —` : 'Hi —';

  return `${greeting} thanks for following up. We received your earlier message and a lawyer is reviewing your matter now. Once they've had a chance to look at it, they'll reach out to you directly using the contact info you shared. Most replies happen within a business day. If your situation is time-sensitive, please feel free to call the firm directly. Thanks for your patience.`;
}
