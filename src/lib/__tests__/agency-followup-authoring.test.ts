import { describe, expect, it } from "vitest";
import {
  createAgencyFollowupContentSnapshot,
  nextAgencyFollowupVersion,
  validateAgencyFollowupSchedulePolicy,
  validateAgencyFollowupStepDrafts,
} from "../agency-followup-authoring";

describe("Agency follow-up version authoring", () => {
  it("validates and hashes immutable template snapshots", () => {
    const snapshot = createAgencyFollowupContentSnapshot(" Synthetic subject ", " Synthetic body. ");
    expect(snapshot.content).toEqual({ channel: "email", subject: "Synthetic subject", body: "Synthetic body." });
    expect(snapshot.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => createAgencyFollowupContentSnapshot(" ", "body")).toThrow("Template subject is required");
  });

  it("advances stable versions without mutating prior versions", () => {
    expect(nextAgencyFollowupVersion([])).toBe(1);
    expect(nextAgencyFollowupVersion([1, 4, 2])).toBe(5);
  });

  it("accepts configurable timezone, business days, local window, spacing and ordered step delays", () => {
    expect(() => validateAgencyFollowupSchedulePolicy({
      timezone: "America/Toronto", businessDays: [1, 3, 5], localWindowStart: "08:30",
      localWindowEnd: "16:00", minimumSpacingHours: 96,
    })).not.toThrow();
    expect(() => validateAgencyFollowupStepDrafts([
      { templateVersionId: "synthetic-template-1", delayBusinessDays: 0 },
      { templateVersionId: "synthetic-template-2", delayBusinessDays: 5 },
    ])).not.toThrow();
  });

  it("rejects invalid timezone, duplicate days, inverted windows and invalid delays", () => {
    expect(() => validateAgencyFollowupSchedulePolicy({
      timezone: "Mars/Olympus", businessDays: [1], localWindowStart: "09:00",
      localWindowEnd: "17:00", minimumSpacingHours: 24,
    })).toThrow("valid IANA timezone");
    expect(() => validateAgencyFollowupSchedulePolicy({
      timezone: "UTC", businessDays: [1, 1], localWindowStart: "09:00",
      localWindowEnd: "17:00", minimumSpacingHours: 24,
    })).toThrow("unique business days");
    expect(() => validateAgencyFollowupSchedulePolicy({
      timezone: "UTC", businessDays: [1], localWindowStart: "17:00",
      localWindowEnd: "09:00", minimumSpacingHours: 24,
    })).toThrow("increasing HH:mm range");
    expect(() => validateAgencyFollowupStepDrafts([{ templateVersionId: "template", delayBusinessDays: -1 }]))
      .toThrow("whole business days");
  });
});
