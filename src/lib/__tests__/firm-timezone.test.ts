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
import { firmTimezone, formatDayAndTime } from '../firm-timezone';

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
