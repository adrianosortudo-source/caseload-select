/**
 * Canonical mapping from channel code to user-facing label and badge styling.
 *
 * Source of truth: the engine's `Channel` type in lib/screen-engine/types.ts.
 * If a new channel is added there, add it here too.
 *
 * Mirror of intake-language-label.ts in shape and purpose.
 */

export const CHANNEL_LABELS: Record<string, string> = {
  web: 'Website widget',
  voice: 'Phone call',
  facebook: 'Facebook Messenger',
  instagram: 'Instagram DM',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  gbp: 'Google Business Profile',
};

export function channelLabel(channel: string | null | undefined): string {
  if (!channel) return 'Unknown';
  return CHANNEL_LABELS[channel] ?? channel;
}

/**
 * Channel-appropriate accent colour for badge styling.
 * Returns a Tailwind className string ready to spread onto a className prop.
 */
export function channelBadgeClasses(channel: string | null | undefined): string {
  switch (channel) {
    case 'whatsapp':  return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'instagram': return 'bg-pink-50 text-pink-800 border-pink-200';
    case 'facebook':  return 'bg-blue-50 text-blue-800 border-blue-200';
    case 'voice':     return 'bg-violet-50 text-violet-800 border-violet-200';
    case 'sms':       return 'bg-sky-50 text-sky-800 border-sky-200';
    case 'gbp':       return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'web':
    default:          return 'bg-stone-50 text-stone-700 border-stone-200';
  }
}
