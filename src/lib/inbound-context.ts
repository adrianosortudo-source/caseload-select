/**
 * Lead enrichment (Phase 3 / Module 1) — "Inbound context" formatter.
 *
 * Renders a single line for the brief header summarising the passive
 * web-attribution signals captured at intake:
 *
 *   "Tuesday, 11:47 PM · Google Ads · \"toronto immigration lawyer\""
 *   "Saturday, 3:14 AM · Direct visit"
 *   "Wednesday, 2:30 PM · Newsletter email"
 *   "Friday, 9:15 AM · Referred from caseflowblog.ca"
 *
 * Only renders for the `web` channel. Non-web inbound (Voice, Messenger,
 * Instagram DM, WhatsApp) already show "Inbound via <channel>" on the
 * brief header; adding a UTM line there would be noise since those
 * channels carry no URL.
 *
 * Zero new questions are asked of the lead. Every value is either passive
 * (Referer header, time-of-day from submitted_at) or comes from query
 * params the firm itself placed on its widget URL via UTM tagging on ads.
 */

import { firmTimezone, formatDayAndTime } from './firm-timezone';

export interface InboundContextSlots {
  submittedAtIso: string;
  firmLocation: string | null;
  channel: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrer: string | null;
}

export interface InboundContextLine {
  /** False when the line should be omitted (non-web channel or bad timestamp). */
  show: boolean;
  /** Display text. Empty when show=false. */
  text: string;
}

// Human-friendly source labels indexed by (source, medium). Each source
// resolves to a small map of mediums → label; if the medium is missing
// or unrecognised, the first label for the source is used as a fallback.
const SOURCE_LABELS: Record<string, Record<string, string>> = {
  google: {
    cpc: 'Google Ads',
    ppc: 'Google Ads',
    paid: 'Google Ads',
    organic: 'Google Search',
    search: 'Google Search',
  },
  bing: {
    cpc: 'Bing Ads',
    ppc: 'Bing Ads',
    organic: 'Bing Search',
  },
  facebook: {
    cpc: 'Facebook Ads',
    paid: 'Facebook Ads',
    paid_social: 'Facebook Ads',
    social: 'Facebook (organic)',
  },
  instagram: {
    cpc: 'Instagram Ads',
    paid_social: 'Instagram Ads',
    social: 'Instagram (organic)',
  },
  linkedin: {
    cpc: 'LinkedIn Ads',
    paid_social: 'LinkedIn Ads',
    social: 'LinkedIn (organic)',
  },
  newsletter: {
    email: 'Newsletter email',
  },
  referral_partner: {
    referral: 'Referral partner',
  },
};

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Resolve (utm_source, utm_medium) into a human-readable label.
 *
 *   ("google", "cpc")              → "Google Ads"
 *   ("google", "organic")          → "Google Search"
 *   ("newsletter", "email")        → "Newsletter email"
 *   ("partner_name", null)         → "Partner_Name"  (title-cased raw value)
 *   (null, anything)               → null            (no source = no label)
 */
function sourceLabel(source: string | null, medium: string | null): string | null {
  if (!source) return null;
  const src = source.toLowerCase().trim();
  const med = (medium ?? '').toLowerCase().trim();
  const labels = SOURCE_LABELS[src];
  if (labels) {
    if (med && labels[med]) return labels[med];
    const fallback = Object.values(labels)[0];
    if (fallback) return fallback;
  }
  return titleCase(source.trim());
}

/**
 * Extract a clean hostname from a referrer URL string. Strips the leading
 * "www." so common variants render the same.
 *
 *   "https://www.caseflowblog.ca/post/123"  → "caseflowblog.ca"
 *   "caseflowblog.ca"                       → null    (no scheme = not a URL)
 *   "not-a-url"                             → null
 */
function hostFromReferrer(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (!host) return null;
    return host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Build the "Inbound context" line for the brief header.
 *
 * Decision tree:
 *   1. Non-web channel              → show=false (existing "Inbound via X" handles it)
 *   2. Unparseable submitted_at     → show=false (don't risk rendering "Invalid Date")
 *   3. UTM source present           → "<day>, <time> · <source label> · \"<term>\""
 *      (term clause only appears when utm_term is set; common for paid search)
 *   4. UTM source absent + referrer → "<day>, <time> · Referred from <host>"
 *   5. UTM source absent + no ref   → "<day>, <time> · Direct visit"
 */
export function buildInboundContext(slots: InboundContextSlots): InboundContextLine {
  // Treat null channel as web for back-compat with rows persisted before the
  // channel field was wired (the default at the time was implicit web).
  const channel = slots.channel ?? 'web';
  if (channel !== 'web') return { show: false, text: '' };

  const tz = firmTimezone(slots.firmLocation);
  const dayTime = formatDayAndTime(slots.submittedAtIso, tz);
  if (!dayTime) return { show: false, text: '' };

  const src = sourceLabel(slots.utmSource, slots.utmMedium);
  let tail: string;
  if (src) {
    tail = src;
    const term = slots.utmTerm?.trim();
    if (term) tail += ` · "${term}"`;
  } else {
    const host = hostFromReferrer(slots.referrer);
    tail = host ? `Referred from ${host}` : 'Direct visit';
  }

  return { show: true, text: `${dayTime} · ${tail}` };
}
