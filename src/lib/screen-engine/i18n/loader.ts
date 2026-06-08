import type { SupportedLanguage } from '../types';
import enBundle from './en.json';
import ptBundle from './pt.json';

export interface I18nBundle {
  /**
   * Per-slot question text translation. Maps slot.id to the translated
   * question string. Added 2026-06-08 to close the i18n propagation gap
   * surfaced on the DRG WhatsApp PT smoke test: state.language='pt' was
   * being set correctly by the LLM but the discovery question text was
   * being rendered raw from slot.question (English) because there was
   * no translation lookup for question text.
   *
   * Fallback: when the slot id is missing from this map (e.g. matter
   * types not yet translated, like employment/estates/real-estate
   * Phase B), the renderer falls back to slot.question (English).
   * That keeps existing behaviour stable while new languages roll
   * out matter-type by matter-type.
   */
  slot_questions: Record<string, string>;
  slot_options: Record<string, Record<string, string>>;
  summary: Record<string, Record<string, string>>;
  summary_labels: Record<string, string>;
  prompts: Record<string, string>;
  bridge_text: Record<string, string>;
  chips: Record<string, Record<string, string>>;
  /**
   * Widget UI chrome strings (button labels, screen headings,
   * placeholders). Surfaces after language detection settles, so the
   * widget can stay coherent end-to-end in the lead's language.
   * Optional: bundles authored before this key was added keep working
   * via callers using `?? englishFallback`.
   */
  widget_strings?: Record<string, string>;
}

// Statically imported bundles. Non-English files are imported here when they
// are delivered by translators. Until then, every language falls back to the
// English bundle.
const BUNDLES: Partial<Record<SupportedLanguage, I18nBundle>> = {
  en: enBundle as unknown as I18nBundle,
  pt: ptBundle as unknown as I18nBundle,
  // fr: frBundle,  ← add when fr.json is delivered
  // es: esBundle,
  // zh: zhBundle,
  // ar: arBundle,
};

/**
 * Returns the i18n bundle for the given language.
 * Falls back to English if the bundle is not yet available.
 * Never throws, always returns a usable bundle.
 */
export function getI18n(language: SupportedLanguage): I18nBundle {
  return BUNDLES[language] ?? (BUNDLES.en as I18nBundle);
}
