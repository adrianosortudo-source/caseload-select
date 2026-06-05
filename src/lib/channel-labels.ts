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
  // Default to 'web' (Website widget) when the channel is missing.
  //
  // Rationale (2026-06-05): the platform is web-first. The voice-intake,
  // /api/screen, and every Meta/SMS/GBP intake path set `channel` explicitly
  // when they persist the row. A missing channel value therefore means the
  // SPA widget (which is the live website intake at caseload-screen-v2)
  // didn't include `slot_answers.channel` in its POST body — i.e. it's a
  // website-widget submission with channel attribution dropped.
  //
  // Previously this returned 'Unknown', which surfaced as "INBOUND VIA
  // UNKNOWN" on the lawyer-facing triage header for legitimate web rows.
  // That damages trust and is wrong: the channel IS known (it's web), the
  // writer just forgot to set it. Defense-in-depth at the renderer means
  // the lawyer always sees the correct channel name, and the data-path
  // hydration in /api/intake-v2 backfills it for future writes.
  if (!channel) return CHANNEL_LABELS.web;
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
