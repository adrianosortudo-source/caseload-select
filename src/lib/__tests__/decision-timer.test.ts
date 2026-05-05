import { describe, it, expect } from "vitest";
import {
  formatRemaining,
  urgencyForRemaining,
  snapshot,
  baselineHoursFromSubmit,
} from "../decision-timer";

const HOUR = 3_600_000;
const MIN = 60_000;

describe("formatRemaining", () => {
  it("renders hours and minutes when an hour or more remains", () => {
    expect(formatRemaining(2 * HOUR + 15 * MIN)).toBe("2h 15m");
    expect(formatRemaining(11 * HOUR + 59 * MIN)).toBe("11h 59m");
  });

  it("renders just hours when minutes are zero", () => {
    expect(formatRemaining(3 * HOUR)).toBe("3h");
    expect(formatRemaining(48 * HOUR)).toBe("48h");
  });

  it("renders minutes when under an hour", () => {
    expect(formatRemaining(45 * MIN)).toBe("45m");
    expect(formatRemaining(1 * MIN)).toBe("1m");
  });

  it("renders 'expired' for zero or negative", () => {
    expect(formatRemaining(0)).toBe("expired");
    expect(formatRemaining(-1)).toBe("expired");
    expect(formatRemaining(-1 * HOUR)).toBe("expired");
  });
});

describe("urgencyForRemaining", () => {
  it("expired when deadline has passed", () => {
    expect(urgencyForRemaining(0, 48)).toBe("expired");
    expect(urgencyForRemaining(-MIN, 48)).toBe("expired");
  });

  it("ok when more than 50% of the baseline remains", () => {
    expect(urgencyForRemaining(40 * HOUR, 48)).toBe("ok");
    expect(urgencyForRemaining(24.5 * HOUR, 48)).toBe("ok");
  });

  it("warning when 25-50% remains", () => {
    expect(urgencyForRemaining(20 * HOUR, 48)).toBe("warning");
    expect(urgencyForRemaining(12.5 * HOUR, 48)).toBe("warning");
  });

  it("critical when under 25% remains", () => {
    expect(urgencyForRemaining(11 * HOUR, 48)).toBe("critical");
    expect(urgencyForRemaining(MIN, 48)).toBe("critical");
  });

  it("respects compressed baselines (24h, 12h)", () => {
    // Compressed 24h baseline: 5h remaining = 21% → critical
    expect(urgencyForRemaining(5 * HOUR, 24)).toBe("critical");
    // Compressed 12h baseline: 5h remaining = 42% → warning
    expect(urgencyForRemaining(5 * HOUR, 12)).toBe("warning");
    // Compressed 12h baseline: 8h remaining = 67% → ok
    expect(urgencyForRemaining(8 * HOUR, 12)).toBe("ok");
  });
});

describe("snapshot", () => {
  it("packages remaining time, label, urgency, and pct in one read", () => {
    const now = new Date("2026-05-05T12:00:00Z");
    const deadline = new Date("2026-05-06T00:00:00Z").toISOString();
    const s = snapshot(deadline, now, 48);
    expect(s.remainingMs).toBe(12 * HOUR);
    expect(s.remainingLabel).toBe("12h");
    expect(s.urgency).toBe("warning"); // 12/48 = 25% → boundary, < 50% so warning
    expect(s.pctRemaining).toBeCloseTo(0.25, 4);
  });

  it("clamps pctRemaining to [0, 1]", () => {
    const now = new Date("2026-05-05T12:00:00Z");
    // Deadline already passed
    const past = new Date("2026-05-05T11:00:00Z").toISOString();
    expect(snapshot(past, now, 48).pctRemaining).toBe(0);
    // Deadline far in the future
    const farFuture = new Date("2026-06-05T12:00:00Z").toISOString();
    expect(snapshot(farFuture, now, 48).pctRemaining).toBe(1);
  });
});

describe("baselineHoursFromSubmit", () => {
  it("recovers 48h baseline from default-tier deadline", () => {
    const submit = "2026-05-05T12:00:00Z";
    const deadline = "2026-05-07T12:00:00Z"; // +48h
    expect(baselineHoursFromSubmit(submit, deadline)).toBe(48);
  });

  it("recovers 24h baseline from urgency-6 tier deadline", () => {
    const submit = "2026-05-05T12:00:00Z";
    const deadline = "2026-05-06T12:00:00Z"; // +24h
    expect(baselineHoursFromSubmit(submit, deadline)).toBe(24);
  });

  it("recovers 12h baseline from urgency-8 tier deadline", () => {
    const submit = "2026-05-05T12:00:00Z";
    const deadline = "2026-05-06T00:00:00Z"; // +12h
    expect(baselineHoursFromSubmit(submit, deadline)).toBe(12);
  });

  it("clamps to nearest known tier when there is rounding drift", () => {
    const submit = "2026-05-05T12:00:00Z";
    // 11h 30m later — still in the 12h tier
    const close = new Date(new Date(submit).getTime() + 11.5 * HOUR).toISOString();
    expect(baselineHoursFromSubmit(submit, close)).toBe(12);
    // 22h later — closest to 24h
    const mid = new Date(new Date(submit).getTime() + 22 * HOUR).toISOString();
    expect(baselineHoursFromSubmit(submit, mid)).toBe(24);
  });
});
