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

/**
 * Default firm timezone. The entire current client base is Toronto-area
 * (DRG), so this is the correct answer when no firm record is available.
 */
export const DEFAULT_FIRM_TIMEZONE = DEFAULT_TIMEZONE;

/**
 * Resolve the IANA timezone for a firm, following the locked precedence
 * chain (2026-06-02):
 *
 *   intake_firms.timezone  (explicit column, if/when added)
 *     ?? firmTimezone(intake_firms.location)   (city/province inference)
 *     ?? 'America/Toronto'                      (default; baked into firmTimezone)
 *
 * `intake_firms.timezone` does NOT exist as a column today. The `timezone`
 * field is accepted here so the resolver is forward-compatible: when the
 * column is added and selected, an explicit value wins. Until then, every
 * firm resolves through `firmTimezone(location)`, which already defaults to
 * America/Toronto for unmatched or missing input.
 *
 * Pure. Safe to call on every brief / queue-card render.
 *
 *   resolveFirmTimezone({ location: 'Vancouver, BC' })       -> 'America/Vancouver'
 *   resolveFirmTimezone({ timezone: 'America/Halifax' })     -> 'America/Halifax'
 *   resolveFirmTimezone({ location: null })                  -> 'America/Toronto'
 *   resolveFirmTimezone(null)                                -> 'America/Toronto'
 */
export function resolveFirmTimezone(
  firm: { timezone?: string | null; location?: string | null } | null | undefined,
): string {
  const explicit = firm?.timezone;
  if (explicit && typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim();
  }
  return firmTimezone(firm?.location);
}

/**
 * Single chokepoint for rendering a stored UTC timestamp in a firm-local
 * display string (#138 / #140). Always applies an explicit `timeZone`, so
 * it can NEVER leak server-local (UTC on Vercel) or browser-local time the
 * way a bare `toLocaleString` does. Default timezone is America/Toronto
 * (the entire current client base); callers holding a firm record pass
 * `resolveFirmTimezone(firm)`.
 *
 * Use this everywhere a lawyer- or client-facing timestamp is rendered.
 * Replaces ad-hoc `new Date(iso).toLocaleString(...)` calls that omitted
 * `timeZone`.
 *
 *   formatTimestamp('2026-06-02T20:55:00Z')                       -> "Jun 2, 2026, 4:55 p.m."  (Toronto)
 *   formatTimestamp('2026-06-02T20:55:00Z', 'America/Vancouver')  -> "Jun 2, 2026, 1:55 p.m."
 *   formatTimestamp(iso, resolveFirmTimezone(firm))               -> firm-local
 *
 * Returns the raw input on unparseable timestamps (defensive; mirrors the
 * prior try/catch behaviour of the call sites it replaces).
 */
export function formatTimestamp(
  isoTimestamp: string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
  opts: { dateStyle?: 'full' | 'long' | 'medium' | 'short'; timeStyle?: 'full' | 'long' | 'medium' | 'short' } = {},
): string {
  if (!isoTimestamp) return '';
  // Honor exactly the styles requested. When the caller passes neither,
  // default to date + time. Passing only `dateStyle` yields a date-only
  // string (e.g. "Added Jun 2, 2026"); only `timeStyle` yields time-only.
  const styles =
    opts.dateStyle || opts.timeStyle
      ? opts
      : { dateStyle: 'medium' as const, timeStyle: 'short' as const };
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      ...styles,
    }).format(new Date(isoTimestamp));
  } catch {
    return String(isoTimestamp);
  }
}

/**
 * Render a DATE-ONLY value (a Postgres `date` column such as
 * `intake_firms.engagement_start_date`, returned by the Supabase client as a
 * plain `"YYYY-MM-DD"` string) without any timezone conversion.
 *
 * This is the counterpart to `formatTimestamp`, and the distinction matters:
 *
 *   - A `timestamptz` is a real instant in time. It must be rendered in the
 *     firm's timezone -> use `formatTimestamp`.
 *   - A `date` has NO time and NO timezone. Passing it through `new Date(...)`
 *     parses it as UTC midnight, so a naive `toLocaleDateString` (or even
 *     `formatTimestamp` with a firm tz) shifts it a day backwards for any
 *     timezone west of UTC -- e.g. "2026-06-01" renders as "May 31" / "May
 *     2026" in America/Toronto. That is the bug this function exists to avoid.
 *
 * The fix is to construct the Date from the literal calendar parts using the
 * local-time constructor and format with NO `timeZone`, so construction and
 * formatting cancel out and the same calendar day renders in every runtime
 * (UTC server, Toronto browser, anywhere).
 *
 *   formatDateOnly('2026-06-01', { month: 'long', year: 'numeric' })  -> "June 2026"  (everywhere)
 *   formatDateOnly('2026-06-01')                                       -> "Jun 1, 2026"
 *
 * Falls back to `new Date(value)` for non-date-only inputs and returns the raw
 * value when it cannot parse, mirroring `formatTimestamp`.
 */
export function formatDateOnly(
  dateString: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  if (!dateString) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateString);
  try {
    const date = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(dateString);
    if (Number.isNaN(date.getTime())) return String(dateString);
    // No timeZone: the value carries no tz, so local-construct + local-format
    // round-trips to the same calendar day regardless of where this runs.
    return new Intl.DateTimeFormat('en-CA', opts).format(date);
  } catch {
    return String(dateString);
  }
}
