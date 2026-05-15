/**
 * Firm location → IANA timezone resolver.
 *
 * `intake_firms.location` is a free-text "City, Province" string (e.g.
 * "Toronto, ON", "Ottawa, Ontario", "Vancouver, BC"). The lawyer's brief
 * needs to render submitted_at in the firm's local time, not server UTC,
 * so the "Inbound context" line reads naturally for the lawyer reviewing
 * it ("Saturday, 3:14 AM" rather than "Saturday, 07:14 UTC").
 *
 * Default fallback: America/Toronto. The ICP is Ontario sole-practitioners
 * and 2-lawyer Toronto firms, so this is the right answer for ambiguous
 * or missing input. Drift only matters for firms outside Ontario; until we
 * onboard one, the default is correct for the entire client base.
 */

const DEFAULT_TIMEZONE = 'America/Toronto';

const PROVINCE_TZ: Record<string, string> = {
  // Eastern
  ON: 'America/Toronto',
  ONTARIO: 'America/Toronto',
  QC: 'America/Toronto',
  QUEBEC: 'America/Toronto',
  // Atlantic
  NB: 'America/Halifax',
  'NEW BRUNSWICK': 'America/Halifax',
  NS: 'America/Halifax',
  'NOVA SCOTIA': 'America/Halifax',
  PE: 'America/Halifax',
  PEI: 'America/Halifax',
  'PRINCE EDWARD ISLAND': 'America/Halifax',
  // Newfoundland (half-hour offset)
  NL: 'America/St_Johns',
  NEWFOUNDLAND: 'America/St_Johns',
  // Central
  MB: 'America/Winnipeg',
  MANITOBA: 'America/Winnipeg',
  // Saskatchewan (year-round CST, no DST)
  SK: 'America/Regina',
  SASKATCHEWAN: 'America/Regina',
  // Mountain
  AB: 'America/Edmonton',
  ALBERTA: 'America/Edmonton',
  // Pacific
  BC: 'America/Vancouver',
  'BRITISH COLUMBIA': 'America/Vancouver',
  // Territories
  YT: 'America/Whitehorse',
  YUKON: 'America/Whitehorse',
  NT: 'America/Yellowknife',
  'NORTHWEST TERRITORIES': 'America/Yellowknife',
  NU: 'America/Iqaluit',
  NUNAVUT: 'America/Iqaluit',
};

const CITY_TZ: Record<string, string> = {
  TORONTO: 'America/Toronto',
  OTTAWA: 'America/Toronto',
  HAMILTON: 'America/Toronto',
  MISSISSAUGA: 'America/Toronto',
  BRAMPTON: 'America/Toronto',
  MARKHAM: 'America/Toronto',
  VAUGHAN: 'America/Toronto',
  LONDON: 'America/Toronto',
  WINDSOR: 'America/Toronto',
  KITCHENER: 'America/Toronto',
  MONTREAL: 'America/Toronto',
  QUEBEC: 'America/Toronto',
  GATINEAU: 'America/Toronto',
  HALIFAX: 'America/Halifax',
  MONCTON: 'America/Halifax',
  SAINT_JOHN: 'America/Halifax',
  'ST JOHN': 'America/Halifax',
  CHARLOTTETOWN: 'America/Halifax',
  'ST JOHNS': 'America/St_Johns',
  WINNIPEG: 'America/Winnipeg',
  REGINA: 'America/Regina',
  SASKATOON: 'America/Regina',
  CALGARY: 'America/Edmonton',
  EDMONTON: 'America/Edmonton',
  VANCOUVER: 'America/Vancouver',
  BURNABY: 'America/Vancouver',
  SURREY: 'America/Vancouver',
  VICTORIA: 'America/Vancouver',
  WHITEHORSE: 'America/Whitehorse',
  YELLOWKNIFE: 'America/Yellowknife',
  IQALUIT: 'America/Iqaluit',
};

/**
 * Resolve a firm location string to an IANA timezone. Pure function; safe
 * to call on every brief render.
 *
 *   firmTimezone("Toronto, ON")        → "America/Toronto"
 *   firmTimezone("Vancouver, BC")      → "America/Vancouver"
 *   firmTimezone("Calgary")            → "America/Edmonton"
 *   firmTimezone(null)                 → "America/Toronto"  (default)
 *   firmTimezone("Paris, France")      → "America/Toronto"  (unmatched → default)
 */
export function firmTimezone(location: string | null | undefined): string {
  if (!location || typeof location !== 'string') return DEFAULT_TIMEZONE;
  const norm = location.toUpperCase().trim();
  if (!norm) return DEFAULT_TIMEZONE;

  // Split on common separators (comma, slash, semicolon).
  const tokens = norm.split(/[,/;]/).map((t) => t.trim()).filter(Boolean);

  // Province tokens (last-token-first matches "City, Province" pattern).
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (PROVINCE_TZ[tok]) return PROVINCE_TZ[tok];
  }

  // City tokens (first match wins; usually the first token).
  for (const tok of tokens) {
    if (CITY_TZ[tok]) return CITY_TZ[tok];
  }

  return DEFAULT_TIMEZONE;
}

/**
 * Format an ISO timestamp into a "Weekday, h:mm AM/PM" display string in
 * the given timezone. Used by the "Inbound context" line on the brief.
 *
 *   formatDayAndTime("2026-05-15T03:47:00.000Z", "America/Toronto")
 *     → "Thursday, 11:47 PM"  (the day before in eastern time)
 *
 * Returns empty string when the input timestamp does not parse, so the
 * caller can gracefully skip rendering the line.
 */
export function formatDayAndTime(isoTimestamp: string, timezone: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return '';
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    weekday: 'long',
  });
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${dayFmt.format(date)}, ${timeFmt.format(date)}`;
}
