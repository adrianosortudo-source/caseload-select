/**
 * Tests for src/lib/inbound-context.ts — the "Inbound context" line that
 * appears on the lead-brief header for web inbound.
 *
 * The formatter has three branches:
 *   - utm_source set        → "<day>, <time> · <source label> · '<term>'"
 *   - referrer set only     → "<day>, <time> · Referred from <host>"
 *   - neither set           → "<day>, <time> · Direct visit"
 *
 * Plus a non-web channel short-circuit (show=false) and a bad-timestamp
 * short-circuit.
 */

import { describe, it, expect } from 'vitest';
import { buildInboundContext, type InboundContextSlots } from '../inbound-context';

function base(overrides: Partial<InboundContextSlots> = {}): InboundContextSlots {
  return {
    submittedAtIso: '2026-05-15T16:00:00.000Z', // Friday 12:00 PM EDT
    firmLocation: 'Toronto, ON',
    channel: 'web',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    referrer: null,
    ...overrides,
  };
}

describe('buildInboundContext — channel gating', () => {
  it('omits the line for voice channel', () => {
    const out = buildInboundContext(base({ channel: 'voice' }));
    expect(out.show).toBe(false);
    expect(out.text).toBe('');
  });

  it('omits the line for WhatsApp channel', () => {
    const out = buildInboundContext(base({ channel: 'whatsapp' }));
    expect(out.show).toBe(false);
  });

  it('omits the line for Instagram channel', () => {
    expect(buildInboundContext(base({ channel: 'instagram' })).show).toBe(false);
  });

  it('omits the line for Facebook (Messenger) channel', () => {
    expect(buildInboundContext(base({ channel: 'facebook' })).show).toBe(false);
  });

  it('treats null channel as web (back-compat for legacy rows)', () => {
    const out = buildInboundContext(base({ channel: null }));
    expect(out.show).toBe(true);
  });
});

describe('buildInboundContext — bad timestamp', () => {
  it('omits the line when submittedAtIso does not parse', () => {
    const out = buildInboundContext(base({ submittedAtIso: 'not-a-date' }));
    expect(out.show).toBe(false);
  });
});

describe('buildInboundContext — direct visit', () => {
  it('renders "Direct visit" when no UTM and no referrer', () => {
    const out = buildInboundContext(base());
    expect(out.show).toBe(true);
    expect(out.text).toMatch(/^Friday, /);
    expect(out.text).toMatch(/12:00 PM · Direct visit$/);
  });
});

describe('buildInboundContext — referrer fallback', () => {
  it('renders "Referred from <host>" with www stripped', () => {
    const out = buildInboundContext(base({ referrer: 'https://www.caseflowblog.ca/post/123' }));
    expect(out.text).toMatch(/Referred from caseflowblog\.ca$/);
  });

  it('falls back to "Direct visit" when referrer is not a URL', () => {
    const out = buildInboundContext(base({ referrer: 'not-a-url' }));
    expect(out.text).toMatch(/Direct visit$/);
  });
});

describe('buildInboundContext — UTM source labels', () => {
  it('renders Google CPC as "Google Ads"', () => {
    const out = buildInboundContext(base({ utmSource: 'google', utmMedium: 'cpc' }));
    expect(out.text).toMatch(/Google Ads$/);
  });

  it('renders Google organic as "Google Search"', () => {
    const out = buildInboundContext(base({ utmSource: 'google', utmMedium: 'organic' }));
    expect(out.text).toMatch(/Google Search$/);
  });

  it('renders Facebook ads with the proper case', () => {
    const out = buildInboundContext(base({ utmSource: 'facebook', utmMedium: 'cpc' }));
    expect(out.text).toMatch(/Facebook Ads$/);
  });

  it('renders Facebook organic distinctly from paid', () => {
    const out = buildInboundContext(base({ utmSource: 'facebook', utmMedium: 'social' }));
    expect(out.text).toMatch(/Facebook \(organic\)$/);
  });

  it('renders LinkedIn ads', () => {
    const out = buildInboundContext(base({ utmSource: 'linkedin', utmMedium: 'cpc' }));
    expect(out.text).toMatch(/LinkedIn Ads$/);
  });

  it('renders Newsletter email', () => {
    const out = buildInboundContext(base({ utmSource: 'newsletter', utmMedium: 'email' }));
    expect(out.text).toMatch(/Newsletter email$/);
  });

  it('title-cases unknown utm_source values', () => {
    const out = buildInboundContext(base({ utmSource: 'referral_partner_acme' }));
    expect(out.text).toMatch(/Referral_partner_acme$/);
  });

  it('appends the search term in quotes when utm_term is set', () => {
    const out = buildInboundContext(base({
      utmSource: 'google',
      utmMedium: 'cpc',
      utmTerm: 'toronto immigration lawyer',
    }));
    expect(out.text).toMatch(/Google Ads · "toronto immigration lawyer"$/);
  });

  it('omits the term clause when utm_term is empty / whitespace', () => {
    const out = buildInboundContext(base({
      utmSource: 'google',
      utmMedium: 'cpc',
      utmTerm: '   ',
    }));
    expect(out.text).toMatch(/Google Ads$/);
    expect(out.text).not.toContain('""');
  });

  it('UTM source wins over referrer when both are set', () => {
    const out = buildInboundContext(base({
      utmSource: 'google',
      utmMedium: 'cpc',
      referrer: 'https://example.com/post',
    }));
    expect(out.text).toMatch(/Google Ads$/);
    expect(out.text).not.toContain('Referred from');
  });
});

describe('buildInboundContext — firm-local time', () => {
  it('formats time in the firm timezone, not UTC', () => {
    // 03:47 UTC on Friday = 11:47 PM Thursday in Toronto.
    const out = buildInboundContext(base({
      submittedAtIso: '2026-05-15T03:47:00.000Z',
      firmLocation: 'Toronto, ON',
    }));
    expect(out.text).toMatch(/^Thursday, /);
    expect(out.text).toMatch(/11:47 PM/);
  });

  it('uses the firm timezone for a Vancouver firm', () => {
    // 02:00 UTC on Friday = 7:00 PM Thursday in Vancouver.
    const out = buildInboundContext(base({
      submittedAtIso: '2026-05-15T02:00:00.000Z',
      firmLocation: 'Vancouver, BC',
    }));
    expect(out.text).toMatch(/^Thursday, /);
    expect(out.text).toMatch(/7:00 PM/);
  });
});
