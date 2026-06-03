/**
 * Pure decision-timer helpers shared between server and client.
 *
 * The deadline itself is computed at insert time in /api/intake-v2 from the
 * urgency-tiered timer compression rule (CRM Bible v5 DR-003). Everything
 * here is presentational: how much time is left, how to format it, and
 * whether to render the alarm state.
 */

export type TimerUrgency = "ok" | "warning" | "critical" | "expired";

export interface TimerSnapshot {
  remainingMs: number;
  remainingLabel: string;       // e.g. "23h 12m", "47m", "expired"
  urgency: TimerUrgency;
  pctRemaining: number;         // 0..1, relative to 48h baseline
}

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/**
 * Default display timezone for arrival timestamps (#138). The entire
 * current client base is Toronto-area, so this is correct when no firm
 * timezone is threaded. Callers with a firm record should pass the
 * resolved IANA timezone (resolveFirmTimezone) so non-Ontario firms
 * render correctly. Kept as a literal here to avoid a cross-module import
 * into this pure presentational helper.
 */
const DEFAULT_DISPLAY_TIMEZONE = "America/Toronto";

/**
 * Calendar day (YYYY-MM-DD) as seen in a given IANA timezone. Used so the
 * "yesterday" / "Mon" buckets are computed in the firm's local day, not
 * the server's UTC day. en-CA formats as YYYY-MM-DD.
 */
function calendarDayInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Format remaining time as "Xh Ym" when an hour or more remains, "Ym" when
 * under an hour. Negative values surface as "expired" to make the lifecycle
 * mismatch loud (a triaging row past its deadline should not exist; the
 * backstop sweep should have flipped it to declined).
 */
export function formatRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return "expired";
  const totalMin = Math.floor(remainingMs / MINUTE_MS);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Urgency state for visual treatment. The thresholds are presentational,
 * not tied to the timer-compression decision (which only sets the deadline).
 *
 *   ok        more than 50% of the original window remains
 *   warning   25–50% remains
 *   critical  under 25% remains
 *   expired   deadline passed (should be rare; backstop should have fired)
 */
export function urgencyForRemaining(
  remainingMs: number,
  baselineHours = 48,
): TimerUrgency {
  if (remainingMs <= 0) return "expired";
  const pct = remainingMs / (baselineHours * HOUR_MS);
  if (pct < 0.25) return "critical";
  if (pct < 0.5) return "warning";
  return "ok";
}

export function snapshot(deadlineIso: string, now: Date = new Date(), baselineHours = 48): TimerSnapshot {
  const deadline = new Date(deadlineIso).getTime();
  const remainingMs = deadline - now.getTime();
  return {
    remainingMs,
    remainingLabel: formatRemaining(remainingMs),
    urgency: urgencyForRemaining(remainingMs, baselineHours),
    pctRemaining: Math.max(0, Math.min(1, remainingMs / (baselineHours * HOUR_MS))),
  };
}

/**
 * Derive the original baseline window from the deadline + submission time.
 * Used to pick the right denominator for pctRemaining when the deadline
 * was compressed (24h or 12h instead of the default 48h).
 */
export function baselineHoursFromSubmit(submittedAtIso: string, deadlineIso: string): number {
  const submitted = new Date(submittedAtIso).getTime();
  const deadline = new Date(deadlineIso).getTime();
  const hours = Math.round((deadline - submitted) / HOUR_MS);
  // Clamp to the three known tiers so a slow clock or rounding drift does
  // not produce a weird denominator.
  if (hours <= 14) return 12;
  if (hours <= 30) return 24;
  return 48;
}

const DAY_MS = 86_400_000;

/**
 * Relative-time label for the lead arrival timestamp on the triage queue card.
 *
 *   < 60s          "just now"
 *   < 60 min       "12 min ago"
 *   < 24h          "5 hours ago" / "1 hour ago"
 *   yesterday      "yesterday at 10:33 PM"
 *   < 7 days       "Mon at 10:33 PM"
 *   beyond 7 days  "May 14, 2026"
 *
 * Pure — pass `now` for deterministic snapshots in tests. Returns a phrase
 * the lawyer can read at a glance to gauge staleness without parsing a
 * datetime.
 */
export function formatRelativeArrival(
  submittedAtIso: string,
  now: Date = new Date(),
  timezone: string = DEFAULT_DISPLAY_TIMEZONE,
): string {
  const submitted = new Date(submittedAtIso);
  if (Number.isNaN(submitted.getTime())) return "";
  const diffMs = now.getTime() - submitted.getTime();
  if (diffMs < 60_000) return "just now";
  if (diffMs < HOUR_MS) {
    const mins = Math.floor(diffMs / MINUTE_MS);
    return `${mins} min ago`;
  }
  if (diffMs < DAY_MS) {
    const hours = Math.floor(diffMs / HOUR_MS);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  // Past 24h but same calendar yesterday or within the past 7 days — show day
  // + time. We compute "yesterday" by calendar day, not by 24h window, so a
  // lead from 23h ago at 11pm still reads "yesterday" the next morning.
  // #138: calendar days are computed in the firm timezone (YYYY-MM-DD via
  // en-CA), so the bucket and the displayed clock time agree near midnight.
  const submittedDayStr = calendarDayInTz(submitted, timezone);
  const nowDayStr = calendarDayInTz(now, timezone);
  const dayDiff = Math.round(
    (Date.parse(`${nowDayStr}T00:00:00Z`) - Date.parse(`${submittedDayStr}T00:00:00Z`)) / DAY_MS,
  );
  const timePart = submitted.toLocaleTimeString("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  if (dayDiff === 1) return `yesterday at ${timePart}`;
  if (dayDiff < 7) {
    const dayName = submitted.toLocaleDateString("en-CA", { timeZone: timezone, weekday: "short" });
    return `${dayName} at ${timePart}`;
  }
  return submitted.toLocaleDateString("en-CA", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Absolute timestamp for the lead arrival, formatted for the secondary line
 * under the relative time. Example: "May 25, 2026 · 10:33 PM".
 */
export function formatAbsoluteArrival(
  submittedAtIso: string,
  timezone: string = DEFAULT_DISPLAY_TIMEZONE,
): string {
  const submitted = new Date(submittedAtIso);
  if (Number.isNaN(submitted.getTime())) return "";
  // #138: render in the firm timezone (default America/Toronto). Stored
  // timestamps are UTC; this is the on-read conversion.
  const date = submitted.toLocaleDateString("en-CA", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = submitted.toLocaleTimeString("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}
