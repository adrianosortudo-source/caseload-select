import { describe, it, expect } from "vitest";
import {
  isDeletableStatus,
  PROTECTED_DELETE_STATUSES,
  ARCHIVABLE_HISTORY_STATUSES,
  isValidOlderThanDays,
  olderThanCutoffIso,
  MAX_OLDER_THAN_DAYS,
} from "../screened-lead-admin-pure";

describe("isDeletableStatus", () => {
  it("protects taken leads (a client matter links back to them)", () => {
    expect(isDeletableStatus("taken")).toBe(false);
    expect(PROTECTED_DELETE_STATUSES).toContain("taken");
  });

  it("allows deleting every non-taken status", () => {
    for (const s of ["triaging", "passed", "referred", "declined"]) {
      expect(isDeletableStatus(s)).toBe(true);
    }
  });

  it("treats null / undefined as deletable (no protection signal)", () => {
    expect(isDeletableStatus(null)).toBe(true);
    expect(isDeletableStatus(undefined)).toBe(true);
  });
});

describe("ARCHIVABLE_HISTORY_STATUSES", () => {
  it("covers finalised statuses only, never triaging or taken", () => {
    expect([...ARCHIVABLE_HISTORY_STATUSES].sort()).toEqual(["declined", "passed", "referred"]);
    expect(ARCHIVABLE_HISTORY_STATUSES).not.toContain("triaging");
    expect(ARCHIVABLE_HISTORY_STATUSES).not.toContain("taken");
  });
});

describe("isValidOlderThanDays", () => {
  it("accepts non-negative numbers within bound", () => {
    expect(isValidOlderThanDays(0)).toBe(true);
    expect(isValidOlderThanDays(30)).toBe(true);
    expect(isValidOlderThanDays(MAX_OLDER_THAN_DAYS)).toBe(true);
  });

  it("rejects out-of-range, non-finite, and non-number inputs", () => {
    expect(isValidOlderThanDays(-1)).toBe(false);
    expect(isValidOlderThanDays(MAX_OLDER_THAN_DAYS + 1)).toBe(false);
    expect(isValidOlderThanDays(Number.NaN)).toBe(false);
    expect(isValidOlderThanDays("30")).toBe(false);
    expect(isValidOlderThanDays(null)).toBe(false);
    expect(isValidOlderThanDays(undefined)).toBe(false);
  });
});

describe("olderThanCutoffIso", () => {
  it("returns now minus N days as an ISO string", () => {
    const now = Date.UTC(2026, 5, 17, 12, 0, 0); // 2026-06-17T12:00:00Z
    expect(olderThanCutoffIso(0, now)).toBe("2026-06-17T12:00:00.000Z");
    expect(olderThanCutoffIso(30, now)).toBe("2026-05-18T12:00:00.000Z");
    expect(olderThanCutoffIso(90, now)).toBe("2026-03-19T12:00:00.000Z");
  });
});
