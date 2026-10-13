import { describe, expect, it } from "vitest";
import { isWithinAgencyFollowupWindow, scheduleAgencyFollowupStep } from "../agency-followup-schedule";

describe("scheduleAgencyFollowupStep", () => {
  it("checks the complete configured weekday and half-open local time window", () => {
    const policy = {
      timezone: "America/Toronto",
      businessDays: [1, 2, 3, 4, 5],
      localWindowStart: "09:00",
      localWindowEnd: "17:00",
    };
    expect(isWithinAgencyFollowupWindow("2026-10-13T18:00:00.000Z", policy)).toBe(true);
    expect(isWithinAgencyFollowupWindow("2026-10-13T21:00:00.000Z", policy)).toBe(false);
    expect(isWithinAgencyFollowupWindow("2026-10-17T16:00:00.000Z", policy)).toBe(false);
  });

  it("moves a Friday after-window anchor to Monday's local start window", () => {
    expect(
      scheduleAgencyFollowupStep({
        anchorAt: "2026-04-03T21:30:00.000Z",
        timezone: "America/Toronto",
        businessDays: [1, 2, 3, 4, 5],
        delayBusinessDays: 0,
        localWindowStart: "09:00",
      }),
    ).toBe("2026-04-06T13:00:00.000Z");
  });

  it("counts business days across the Toronto daylight-saving transition", () => {
    expect(
      scheduleAgencyFollowupStep({
        anchorAt: "2026-03-06T15:30:00.000Z",
        timezone: "America/Toronto",
        businessDays: [1, 2, 3, 4, 5],
        delayBusinessDays: 1,
        localWindowStart: "09:00",
      }),
    ).toBe("2026-03-09T13:00:00.000Z");
  });

  it("uses a weekend when the journey explicitly configures it as a business day", () => {
    expect(
      scheduleAgencyFollowupStep({
        anchorAt: "2026-04-03T21:30:00.000Z",
        timezone: "America/Toronto",
        businessDays: [1, 2, 3, 4, 5, 6],
        delayBusinessDays: 1,
        localWindowStart: "09:00",
      }),
    ).toBe("2026-04-04T13:00:00.000Z");
  });

  it("moves out of a nonexistent local window at the spring DST boundary", () => {
    expect(
      scheduleAgencyFollowupStep({
        anchorAt: "2026-03-08T06:00:00.000Z",
        timezone: "America/Toronto",
        businessDays: [7],
        delayBusinessDays: 0,
        localWindowStart: "02:30",
      }),
    ).toBe("2026-03-08T07:00:00.000Z");
  });

  it("rejects invalid schedule configuration", () => {
    expect(() =>
      scheduleAgencyFollowupStep({
        anchorAt: "not-a-date",
        timezone: "America/Toronto",
        businessDays: [1, 1],
        delayBusinessDays: -1,
        localWindowStart: "9am",
      }),
    ).toThrow("anchorAt must be a valid instant.");
    expect(() =>
      scheduleAgencyFollowupStep({
        anchorAt: "2098-04-03T12:00:00Z",
        timezone: "America/Toronto",
        businessDays: [1, 1],
        delayBusinessDays: 0,
        localWindowStart: "09:00",
      }),
    ).toThrow("businessDays must contain unique ISO weekdays from 1 to 7.");
  });
});
