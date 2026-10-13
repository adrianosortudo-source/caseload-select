export interface AgencyFollowupScheduleInput {
  anchorAt: string;
  timezone: string;
  businessDays: number[];
  delayBusinessDays: number;
  localWindowStart: string;
}

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const ISO_WEEKDAYS = new Set([1, 2, 3, 4, 5, 6, 7]);

function localParts(instant: Date, timezone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function dateOrdinal(date: Pick<LocalDateTime, "year" | "month" | "day">): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

function fromDateOrdinal(ordinal: number): Pick<LocalDateTime, "year" | "month" | "day"> {
  const date = new Date(ordinal);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function isoWeekday(ordinal: number): number {
  const weekday = new Date(ordinal).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function sameLocalMinute(actual: LocalDateTime, expected: LocalDateTime): boolean {
  return actual.year === expected.year && actual.month === expected.month && actual.day === expected.day &&
    actual.hour === expected.hour && actual.minute === expected.minute;
}

/** Converts a local wall time without assuming a fixed UTC offset. */
function localDateTimeToInstant(local: LocalDateTime, timezone: string): Date {
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  let guess = target;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const seen = localParts(new Date(guess), timezone);
    const representedAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    const adjustment = target - representedAsUtc;
    if (adjustment === 0) return new Date(guess);
    guess += adjustment;
  }

  // A configured window can land inside the missing hour at the spring DST
  // transition. Move forward to the first real local minute, never backward.
  for (let minute = 1; minute <= 180; minute += 1) {
    const shifted = new Date(target + minute * 60_000);
    const shiftedLocal: LocalDateTime = {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
    };
    const shiftedInstant = localDateTimeToInstantWithoutGap(shiftedLocal, timezone);
    if (shiftedInstant && sameLocalMinute(localParts(shiftedInstant, timezone), shiftedLocal)) return shiftedInstant;
  }
  throw new Error("The configured local time could not be resolved in the selected timezone.");
}

function localDateTimeToInstantWithoutGap(local: LocalDateTime, timezone: string): Date | null {
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  let guess = target;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const seen = localParts(new Date(guess), timezone);
    const representedAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    const adjustment = target - representedAsUtc;
    if (adjustment === 0) return new Date(guess);
    guess += adjustment;
  }
  return null;
}

/**
 * Resolves a follow-up step into the configured local send window. A zero-day
 * delay may use the anchor's local business day if its window has not passed;
 * positive delays count forward through configured business days.
 */
export function scheduleAgencyFollowupStep(input: AgencyFollowupScheduleInput): string {
  const anchor = new Date(input.anchorAt);
  if (!Number.isFinite(anchor.getTime())) throw new Error("anchorAt must be a valid instant.");
  if (!input.timezone.trim()) throw new Error("timezone is required.");
  if (!Array.isArray(input.businessDays) || input.businessDays.length < 1 ||
    input.businessDays.some((day) => !ISO_WEEKDAYS.has(day)) ||
    new Set(input.businessDays).size !== input.businessDays.length) {
    throw new Error("businessDays must contain unique ISO weekdays from 1 to 7.");
  }
  if (!Number.isInteger(input.delayBusinessDays) || input.delayBusinessDays < 0) {
    throw new Error("delayBusinessDays must be a non-negative integer.");
  }
  const time = /^((?:[01]\d|2[0-3])):([0-5]\d)$/.exec(input.localWindowStart);
  if (!time) throw new Error("localWindowStart must use HH:mm format.");
  const [, hour, minute] = time;

  const localAnchor = localParts(anchor, input.timezone);
  let ordinal = dateOrdinal(localAnchor);
  let remainingDelay = input.delayBusinessDays;
  while (remainingDelay > 0) {
    ordinal += 86_400_000;
    if (input.businessDays.includes(isoWeekday(ordinal))) remainingDelay -= 1;
  }

  for (let daysChecked = 0; daysChecked < 14; daysChecked += 1) {
    if (input.businessDays.includes(isoWeekday(ordinal))) {
      const date = fromDateOrdinal(ordinal);
      const candidate = localDateTimeToInstant({
        ...date,
        hour: Number(hour),
        minute: Number(minute),
        second: 0,
      }, input.timezone);
      if (candidate.getTime() >= anchor.getTime()) return candidate.toISOString();
    }
    ordinal += 86_400_000;
  }
  throw new Error("No configured business day was found within two weeks.");
}
