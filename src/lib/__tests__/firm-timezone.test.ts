/**
 * Tests for src/lib/firm-timezone.ts.
 *
 * The location → IANA TZ mapping is a small lookup table; the formatter
 * delegates to Intl.DateTimeFormat (a Node 18+ built-in with full TZ
 * support). We assert the public contract: city / province strings
 * resolve to the right TZ, unknown input defaults to America/Toronto,
 * and the day+time formatter renders the firm-local moment.
 */

import { describe, it, expect } from 'vitest';
import {
  firmTimezone,
  formatDayAndTime,
  resolveFirmTimezone,
  formatTimestamp,
  formatDateOnly,
} from '../firm-timezone';

describe('firmTimezone — Ontario default + Canadian province coverage', () => {
  it('defaults to America/Toronto for null / undefined / empty input', () => {
    expect(firmTimezone(null)).toBe('America/Toronto');
    expect(firmTimezone(undefined)).toBe('America/Toronto');
    expect(firmTimezone('')).toBe('America/Toronto');
    expect(firmTimezone('   ')).toBe('America/Toronto');
  });

  it('resolves "City, Province" strings via the province token', () => {
    expect(firmTimezone('Toronto, ON')).toBe('America/Toronto');
    expect(firmTimezone('Ottawa, Ontario')).toBe('America/Toronto');
    expect(firmTimezone('Vancouver, BC')).toBe('America/Vancouver');
    expect(firmTimezone('Calgary, AB')).toBe('America/Edmonton');
    expect(firmTimezone('Halifax, NS')).toBe('America/Halifax');
    expect(firmTimezone('Winnipeg, MB')).toBe('America/Winnipeg');
    expect(firmTimezone('Regina, SK')).toBe('America/Regina');
  });

  it('resolves Newfoundland to the half-hour offset zone', () => {
    expect(firmTimezone('St Johns, NL')).toBe('America/St_Johns');
  });

  it('resolves territory strings', () => {
    expect(firmTimezone('Whitehorse, YT')).toBe('America/Whitehorse');
    expect(firmTimezone('Yellowknife, NT')).toBe('America/Yellowknife');
    expect(firmTimezone('Iqaluit, NU')).toBe('America/Iqaluit');
  });

  it('falls back to the city token when no province is given', () => {
    expect(firmTimezone('Calgary')).toBe('America/Edmonton');
    expect(firmTimezone('Vancouver')).toBe('America/Vancouver');
    expect(firmTimezone('Toronto')).toBe('America/Toronto');
  });

  it('is case-insensitive', () => {
    expect(firmTimezone('toronto, on')).toBe('America/Toronto');
    expect(firmTimezone('VANCOUVER, BC')).toBe('America/Vancouver');
  });

  it('handles weird whitespace and separators', () => {
    expect(firmTimezone('  Toronto  ,   ON  ')).toBe('America/Toronto');
    expect(firmTimezone('Calgary / AB')).toBe('America/Edmonton');
  });

  it('defaults to America/Toronto for unmatched international input', () => {
    expect(firmTimezone('Paris, France')).toBe('America/Toronto');
    expect(firmTimezone('New York, NY')).toBe('America/Toronto');
  });
});

describe('formatDayAndTime — firm-local timestamp rendering', () => {
  it('renders the weekday and 12-hour time for an Ontario firm', () => {
    // 2026-05-15T16:00:00Z = noon EDT (UTC-4 in May).
    const out = formatDayAndTime('2026-05-15T16:00:00.000Z', 'America/Toronto');
    expect(out).toMatch(/^Friday, /);
    expect(out).toMatch(/12:00 PM/);
  });

  it('shifts across midnight when UTC crosses but the firm timezone does not', () => {
    // 2026-05-15T03:47:00Z = 11:47 PM Thursday EDT (UTC-4 in May).
    const out = formatDayAndTime('2026-05-15T03:47:00.000Z', 'America/Toronto');
    expect(out).toMatch(/^Thursday, /);
    expect(out).toMatch(/11:47 PM/);
  });

  it('renders correctly for a Pacific firm', () => {
    // 2026-05-15T19:14:00Z = 12:14 PM Friday PDT (UTC-7 in May).
    const out = formatDayAndTime('2026-05-15T19:14:00.000Z', 'America/Vancouver');
    expect(out).toMatch(/^Friday, /);
    expect(out).toMatch(/12:14 PM/);
  });

  it('returns empty string for an unparseable timestamp', () => {
    expect(formatDayAndTime('not-a-date', 'America/Toronto')).toBe('');
    expect(formatDayAndTime('', 'America/Toronto')).toBe('');
  });
});

describe('resolveFirmTimezone — the locked fallback chain (#138/#140)', () => {
  it('uses an explicit firm.timezone when present (wins over location)', () => {
    expect(
      resolveFirmTimezone({ timezone: 'America/Halifax', location: 'Toronto, ON' }),
    ).toBe('America/Halifax');
  });

  it('falls back to location-derived timezone when no explicit timezone', () => {
    expect(resolveFirmTimezone({ location: 'Toronto, ON' })).toBe('America/Toronto');
    expect(resolveFirmTimezone({ location: 'Vancouver, BC' })).toBe('America/Vancouver');
  });

  it('falls back to America/Toronto for null / empty firm', () => {
    expect(resolveFirmTimezone(null)).toBe('America/Toronto');
    expect(resolveFirmTimezone(undefined)).toBe('America/Toronto');
    expect(resolveFirmTimezone({})).toBe('America/Toronto');
    expect(resolveFirmTimezone({ location: null, timezone: null })).toBe('America/Toronto');
  });

  it('ignores a blank/whitespace explicit timezone and falls through to location', () => {
    expect(resolveFirmTimezone({ timezone: '   ', location: 'Vancouver, BC' })).toBe(
      'America/Vancouver',
    );
  });
});

describe('formatTimestamp — always firm-local, never server/UTC (#140)', () => {
  // The same instant as the smoke-test bug: 4:55 PM Eastern stored UTC.
  const ISO = '2026-06-02T20:55:00Z'; // 16:55 America/Toronto (EDT), 13:55 America/Vancouver (PDT)

  it('renders in America/Toronto by default (4:55, not the UTC 8:55)', () => {
    const out = formatTimestamp(ISO);
    expect(out).toContain('4:55');
    expect(out).not.toContain('8:55');
  });

  it('renders the same UTC instant differently per firm timezone', () => {
    const toronto = formatTimestamp(ISO, 'America/Toronto');
    const vancouver = formatTimestamp(ISO, 'America/Vancouver');
    expect(toronto).toContain('4:55');
    expect(vancouver).toContain('1:55');
    expect(toronto).not.toEqual(vancouver);
  });

  it('composes with resolveFirmTimezone (the chain end-to-end)', () => {
    const vanFirm = formatTimestamp(ISO, resolveFirmTimezone({ location: 'Vancouver, BC' }));
    expect(vanFirm).toContain('1:55');
    const defaultFirm = formatTimestamp(ISO, resolveFirmTimezone(null));
    expect(defaultFirm).toContain('4:55');
  });

  it('honors dateStyle/timeStyle options', () => {
    const out = formatTimestamp(ISO, 'America/Toronto', { dateStyle: 'short', timeStyle: 'short' });
    expect(out).toContain('4:55');
  });

  it('returns empty string for null/empty and the raw value for unparseable input', () => {
    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp('')).toBe('');
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDateOnly — date-only columns never shift across timezones (#140)', () => {
  // A Postgres `date` (e.g. intake_firms.engagement_start_date) arrives as a
  // bare "YYYY-MM-DD". `new Date('2026-06-01')` parses it as UTC midnight, so
  // a naive render shows the PREVIOUS month/day in any timezone west of UTC.
  // formatDateOnly must show the literal calendar date regardless of runtime.
  it('renders the literal month for a first-of-month date (June, never May)', () => {
    const out = formatDateOnly('2026-06-01', { month: 'long', year: 'numeric' });
    expect(out).toContain('June');
    expect(out).toContain('2026');
    expect(out).not.toContain('May');
  });

  it('renders the literal day with the default medium style (Jun 1, never May 31)', () => {
    const out = formatDateOnly('2026-06-01');
    expect(out).toContain('Jun');
    expect(out).toContain('1');
    expect(out).not.toContain('May');
    expect(out).not.toContain('31');
  });

  it('renders mid-month dates on the exact day', () => {
    const out = formatDateOnly('2026-03-15', { month: 'short', day: 'numeric' });
    expect(out).toContain('Mar');
    expect(out).toContain('15');
  });

  it('returns empty string for null/empty and the raw value for unparseable input', () => {
    expect(formatDateOnly(null)).toBe('');
    expect(formatDateOnly(undefined)).toBe('');
    expect(formatDateOnly('')).toBe('');
    expect(formatDateOnly('not-a-date')).toBe('not-a-date');
  });
});
