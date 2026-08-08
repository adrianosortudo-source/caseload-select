/**
 * Phase 2.1 (F3): locked strings, verified byte-exact against Week 3's
 * shipped bodies and this session's own W32 write (ToDelete/apply-landing-
 * cta-fix.mjs, FOLLOWUPS 2026-08-07 "W32 Kit-completion execution plan").
 *
 * Deliberately minimal: only strings this session directly verified
 * byte-exact are listed. CLAUDE.md paraphrases the DR-082 disclaimer
 * ("Legal information, not legal advice" plus a short body) but this
 * session never read its byte-exact source text, so it is NOT included
 * here rather than risk asserting an invented exact wording (No Invention).
 * Add a locked string only after confirming its exact bytes against canon.
 */
export const LOCKED_STRINGS = {
  /** Lead-magnet landing-page CTA convention (locked 2026-06-25 per CLAUDE.md; exact string per Week 3's shipped landing bodies). */
  leadMagnetCtaHref: '<a href="[FORM DESTINATION PENDING]">',
} as const;
