/**
 * First-ask intro (C2, 2026-08-07 operator request after the WhatsApp
 * production verification of the F1/F2/F3 fixes). Frames the questioning
 * for a lead before the bot's very first question on a fresh conversation
 * — today the first ask (contact capture, the F2 describe-your-situation
 * prompt, or the first discovery question) lands cold, with no setup.
 *
 * Fires only when `!isResume` (no open session existed for this sender).
 * The three call sites in channel-intake-processor.ts are mutually
 * exclusive on a given turn, so at most one of them ever prepends this.
 *
 * "Put you in contact with a lawyer" was considered and rejected: it
 * promises contact, which LSO Rule 4.2-1 and the existing "Submit for
 * review" CTA doctrine both avoid — the honest promise is a lawyer
 * REVIEWS the matter and reaches out if it fits the firm's practice.
 */

import { getI18n } from '@/lib/screen-engine/i18n/loader';
import type { SupportedLanguage } from '@/lib/screen-engine/types';

type ContactMissing = 'name' | 'reachability' | 'both';

/** The standalone intro line, prepended to the first ask's own copy. */
export function firstAskIntro(language: SupportedLanguage): string {
  const i18n = getI18n(language);
  return (
    i18n.widget_strings?.intro_first_ask ||
    'Thanks for reaching out. So a lawyer can review your situation, I will ask a few short questions. You can reply with the number of an option or answer in your own words.'
  );
}

/**
 * F2's describe-your-situation ask, opener-less variant for when the
 * intro already covers "thanks for reaching out". Resume turns keep the
 * full existing copy from the processor unchanged.
 */
export function describeSituationFirstAsk(language: SupportedLanguage): string {
  const i18n = getI18n(language);
  return (
    i18n.widget_strings?.describe_situation_short ||
    'To start, could you describe in a sentence or two what your situation is about?'
  );
}

/**
 * Contact-capture follow-up, opener-less variant for the first ask. Mirrors
 * buildContactCaptureFollowUp's three-way switch in channel-send.ts; kept
 * as a separate function (not a flag on that one) so channel-send.ts stays
 * the single source of truth for the RESUME-turn copy, which is unchanged
 * and far more frequently hit.
 */
export function contactCaptureFirstAsk(missing: ContactMissing): string {
  switch (missing) {
    case 'name':
      return 'First, what name should the firm use when they reach out?';
    case 'reachability':
      return "First, what's the best phone or email for the firm to reach you?";
    case 'both':
    default:
      return 'First, could you share your name and the best phone or email for the firm to reach you?';
  }
}

/** Compose the intro with a first-ask body: intro, blank line, body. */
export function withFirstAskIntro(language: SupportedLanguage, body: string): string {
  return `${firstAskIntro(language)}\n\n${body}`;
}
