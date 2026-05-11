import type { SupportedLanguage } from '../types';
import enBundle from './en.json';

export interface I18nBundle {
  slot_options: Record<string, Record<string, string>>;
  summary: Record<string, Record<string, string>>;
  summary_labels: Record<string, string>;
  prompts: Record<string, string>;
  bridge_text: Record<string, string>;
  chips: Record<string, Record<string, string>>;
}

// Statically imported bundles. Non-English files are imported here when they
// are delivered by translators. Until then, every language falls back to the
// English bundle — the engine functions correctly in English throughout.
const BUNDLES: Partial<Record<SupportedLanguage, I18nBundle>> = {
  en: enBundle as unknown as I18nBundle,
  // fr: frBundle,  ← add when fr.json is delivered
  // es: esBundle,
  // pt: ptBundle,
  // zh: zhBundle,
  // ar: arBundle,
};

/**
 * Returns the i18n bundle for the given language.
 * Falls back to English if the bundle is not yet available.
 * Never throws — always returns a usable bundle.
 */
export function getI18n(language: SupportedLanguage): I18nBundle {
  return BUNDLES[language] ?? (BUNDLES.en as I18nBundle);
}
