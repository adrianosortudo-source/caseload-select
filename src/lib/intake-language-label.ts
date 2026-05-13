/**
 * Utility: map ISO 639-1 language codes to human-readable English labels.
 *
 * Used by the triage portal and notification email to show which language
 * the lead used during intake. Only the six languages the screen engine
 * supports are mapped. Unknown codes fall back to the raw code string so
 * the system never silently hides a non-null intake_language value.
 *
 * Kept intentionally minimal: the screen engine's SupportedLanguage union
 * drives the real source of truth (engine/types.ts). If you add a language
 * there, add it here too.
 */

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  pt: 'Portuguese',
  zh: 'Mandarin Chinese',
  ar: 'Arabic',
};

/**
 * Returns the human-readable English label for a language code.
 * Returns null for 'en' (English is the default; no callout needed).
 * Returns the raw code in Title Case for unrecognised codes (defensive).
 *
 * @param code ISO 639-1 language code (e.g. 'fr', 'pt')
 * @returns Label string, or null when the code is English / null / undefined
 */
export function intakeLanguageLabel(code: string | null | undefined): string | null {
  if (!code || code === 'en') return null;
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}
