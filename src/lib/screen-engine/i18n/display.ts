import type { SlotOption, SupportedLanguage } from '../types';
import type { I18nBundle } from './loader';

/**
 * Returns the display label for a slot option in the lead's language.
 *
 * Fail-safe cascade (5 levels):
 *   1. language === 'en'                      → return opt.label (no i18n lookup at all)
 *   2. i18n.slot_options[slotId] is present
 *      AND slotMap[opt.value] is a non-empty string → return the translated string
 *   3. i18n.slot_options[slotId] is absent   → return opt.label (whole slot untranslated)
 *   4. slotMap exists but opt.value key is missing → return opt.label (one option untranslated)
 *   5. slotMap[opt.value] is an empty string → return opt.label (guards against empty-string
 *      entries that a translator may accidentally deliver; `|| opt.label` handles this)
 *
 * Levels 3–5 all return opt.label, which is the English string set during the SlotOption
 * migration. Level 5 is the extra defensive layer beyond the original 4-level spec —
 * `translated || opt.label` rather than `translated ?? opt.label` so an empty translation
 * never reaches the lead.
 *
 * The canonical value (opt.value) is never modified. Only the display string
 * changes. Call applyAnswer() with opt.value, never with the return of this function.
 */
export function getOptionDisplayLabel(
  opt: SlotOption,
  slotId: string,
  language: SupportedLanguage,
  i18n: I18nBundle,
): string {
  if (language === 'en') return opt.label;
  const slotMap = i18n.slot_options?.[slotId];
  if (!slotMap) return opt.label;
  const translated = slotMap[opt.value];
  return translated || opt.label;
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
