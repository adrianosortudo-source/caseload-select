import { describe, expect, it } from "vitest";

import { buildGtaProspectOwnerContactImportPlan } from "../gta-prospect-owner-contact-import";

function record(overrides: Record<string, unknown> = {}) {
  return {
    sourceRecordKey: "example-family-law",
    ownerName: "Avery Example",
    ownerRole: "sole_proprietor",
    ownershipConfidence: "confirmed_owner",
    ownershipSourceUrl: "https://example.test/about",
    ownershipObservedOn: "2026-09-08",
    emailAvailability: "direct_owner_email",
    emailAddress: "avery@example.test",
    emailSourceUrl: "https://example.test/contact",
    emailObservedOn: "2026-09-08",
    isPrimaryContact: true,
    ...overrides,
  };
}

describe("GTA prospect owner-contact import boundary", () => {
  it("accepts only an evidence-backed, directly published owner email", () => {
    expect(buildGtaProspectOwnerContactImportPlan([record()])).toEqual({
      accepted: [expect.objectContaining({
        sourceRecordKey: "example-family-law",
        owner: expect.objectContaining({ name: "Avery Example", confidence: "confirmed_owner" }),
        email: expect.objectContaining({ availability: "direct_owner_email", address: "avery@example.test" }),
      })],
      rejected: [],
    });
  });

  it("blocks guessed addresses, leadership-only claims, and outreach state", () => {
    const plan = buildGtaProspectOwnerContactImportPlan([
      record({ ownershipConfidence: "leadership_only" }),
      record({ sourceRecordKey: "example-2", emailSourceUrl: null }),
      record({ sourceRecordKey: "example-3", outreachStatus: "ready_to_send" }),
    ]);
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected).toHaveLength(3);
    expect(plan.rejected[0].issues.map((issue) => issue.message)).toContain("direct owner email requires confirmed ownership");
    expect(plan.rejected[1].issues.map((issue) => issue.message)).toContain("published email requires an emailSourceUrl");
    expect(plan.rejected[2].issues.map((issue) => issue.message)).toContain("unrecognized fields are forbidden: outreachStatus");
  });

  it("keeps a published general inbox distinct from a direct owner email", () => {
    const plan = buildGtaProspectOwnerContactImportPlan([record({
      emailAvailability: "firm_general_email",
      emailAddress: "info@example.test",
      ownershipConfidence: "leadership_only",
      isPrimaryContact: false,
    })]);
    expect(plan.rejected).toEqual([]);
    expect(plan.accepted[0].email.availability).toBe("firm_general_email");
  });
});
