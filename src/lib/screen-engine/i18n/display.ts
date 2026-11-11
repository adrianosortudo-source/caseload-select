import type { SlotOption, SupportedLanguage } from '../types';
import type { I18nBundle } from './loader';

/**
 * Return the bundle's question in the selected language, including English.
 * Missing or empty entries fall back to the canonical registry question.
 * getI18n supplies the English bundle for unsupported locales.
 */
export function getQuestionDisplayText(
  slotId: string,
  englishQuestion: string,
  _language: SupportedLanguage,
  i18n: I18nBundle,
): string {
  const translated = i18n.slot_questions?.[slotId];
  return translated || englishQuestion;
}

/**
 * Return the bundle's display label, falling back to the registry label for
 * missing or empty entries. Canonical option values remain unchanged and must
 * be passed to applyAnswer rather than the displayed label.
 */
export function getOptionDisplayLabel(
  opt: SlotOption,
  slotId: string,
  _language: SupportedLanguage,
  i18n: I18nBundle,
): string {
  const slotMap = i18n.slot_options?.[slotId];
  if (!slotMap) return opt.label;
  const translated = slotMap[opt.value];
  return translated || opt.label;
}

/**
 * Returns the display description (example text) for a slot option in
 * the lead's language, or undefined when the option has no description
 * at all (most options; only a few slots carry examples, see
 * SlotOption.description in types.ts). Same fallback cascade as
 * getOptionDisplayLabel: an untranslated bundle, or a bundle missing
 * this specific slot/value, falls back to the English `opt.description`
 * rather than rendering nothing.
 */
export function getOptionDescription(
  opt: SlotOption,
  slotId: string,
  language: SupportedLanguage,
  i18n: I18nBundle,
): string | undefined {
  if (!opt.description) return undefined;
  if (language === 'en') return opt.description;
  const translated = i18n.slot_option_descriptions?.[slotId]?.[opt.value];
  return translated || opt.description;
}

/**
 * Returns the display labels for all options of a slot in the lead's language.
 * Returns an array parallel to slot.options — index i of this array maps to
 * slot.options[i].value for applyAnswer().
 */
export function getDisplayLabels(
  options: SlotOption[],
  slotId: string,
  language: SupportedLanguage,
  i18n: I18nBundle,
): string[] {
  return options.map(opt => getOptionDisplayLabel(opt, slotId, language, i18n));
}

/** Map an exact displayed label back to its immutable stored value. */
export function resolveDisplayedOption(raw: string, options: readonly SlotOption[], slotId: string, language: SupportedLanguage, i18n: I18nBundle): string {
  const reply = raw.trim();
  const needle = reply.toLocaleLowerCase();
  const option = options.find(item => item.value.toLocaleLowerCase() === needle || getOptionDisplayLabel(item, slotId, language, i18n).toLocaleLowerCase() === needle);
  return option?.value ?? reply;
}

// ─── Channel chip data ────────────────────────────────────────────────────
//
// CSS class (cls) is brand-constant: never from the bundle, always from this
// map. Name and note are translatable from i18n.chips[channel].
// Returns null for channel === 'web' (no chip rendered for the default channel).

export interface ChipData {
  name: string;
  note: string;
  cls: string;
}

const CHIP_CSS: Record<string, string> = {
  whatsapp: 'brief-channel-whatsapp',
  sms: 'brief-channel-sms',
  instagram: 'brief-channel-instagram',
  facebook: 'brief-channel-facebook',
  gbp: 'brief-channel-gbp',
  voice: 'brief-channel-voice',
};

const CHIP_EN: Record<string, { name: string; note: string }> = {
  whatsapp: { name: 'WhatsApp', note: 'Phone auto-captured from the channel.' },
  sms: { name: 'SMS', note: 'Short-form intake, full discovery on the call.' },
  instagram: { name: 'Instagram DM', note: 'Display name auto-captured. Phone and email asked in chat.' },
  facebook: { name: 'Facebook Messenger', note: 'Display name auto-captured. Phone and email asked in chat.' },
  gbp: { name: 'Google Business Profile', note: 'Lead opened the chat from a local search; plain text, no rich UI.' },
  voice: { name: 'Voice', note: 'Transcribed from a phone call. Confirm details on the call back.' },
};

/**
 * Returns display data for the channel chip, or null for the 'web' channel
 * (no chip is rendered for web — it's the implicit default).
 *
 * `cls` is always sourced from CHIP_CSS (brand-constant; never translated).
 * `name` and `note` come from the i18n bundle when available, falling back
 * to the English constants so the chip never renders empty.
 */
export function getChannelChipData(
  channel: string,
  language: SupportedLanguage,
  i18n: I18nBundle,
): ChipData | null {
  if (channel === 'web') return null;
  const cls = CHIP_CSS[channel] ?? '';
  if (language === 'en') {
    const en = CHIP_EN[channel];
    if (!en) return null;
    return { name: en.name, note: en.note, cls };
  }
  const chipBundle = i18n.chips?.[channel];
  const en = CHIP_EN[channel];
  const name = chipBundle?.['name'] || en?.name || channel;
  const note = chipBundle?.['note'] || en?.note || '';
  return { name, note, cls };
}
