import { describe, expect, it } from "vitest";

import { buildGtaProspectDowntownGeographyImportPlan } from "../gta-prospect-downtown-geography-import";
import { DOWNTOWN_TORONTO_BOUNDARY_ID, DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL } from "../downtown-toronto-cohort";

const geometryHash = "a".repeat(64);

function record(overrides: Record<string, unknown> = {}) {
  return {
    sourceRecordKey: "example-family-law",
    boundaryId: DOWNTOWN_TORONTO_BOUNDARY_ID,
    status: "inside",
    normalizedAddress: "100 Queen Street West, Toronto, ON M5H 2N2",
    latitude: 43.6512,
    longitude: -79.3833,
    coordinateSourceType: "toronto_one_address_repository",
    coordinateSourceUrl: "https://open.toronto.ca/dataset/address-points-municipal-toronto-one-address-repository/",
    boundarySourceUrl: DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL,
    boundaryGeometrySha256: geometryHash,
    observedOn: "2026-09-08",
    confidence: "high",
    note: null,
    ...overrides,
  };
}

describe("GTA prospect Downtown geography import boundary", () => {
  it("accepts a reproducible point-in-polygon observation", () => {
    expect(buildGtaProspectDowntownGeographyImportPlan([record()])).toEqual({
      accepted: [expect.objectContaining({
        sourceRecordKey: "example-family-law",
        status: "inside",
        boundaryId: DOWNTOWN_TORONTO_BOUNDARY_ID,
        latitude: 43.6512,
      })],
      rejected: [],
    });
  });

  it("requires coordinates for an inside or outside conclusion", () => {
    const plan = buildGtaProspectDowntownGeographyImportPlan([
      record({ latitude: null, longitude: null, coordinateSourceType: null, coordinateSourceUrl: null }),
      record({ sourceRecordKey: "example-outside", status: "outside", coordinateSourceUrl: null }),
    ]);
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected).toHaveLength(2);
    expect(plan.rejected[0].issues.map((issue) => issue.message)).toContain("inside or outside status requires evidence-bearing coordinates");
    expect(plan.rejected[1].issues.map((issue) => issue.message)).toContain("coordinates require latitude, longitude, coordinate source type, and coordinate source URL together");
  });

  it("allows an explicit unresolved observation but forbids outreach state and non-authoritative boundaries", () => {
    const plan = buildGtaProspectDowntownGeographyImportPlan([
      record({
        status: "needs_manual_review",
        latitude: null,
        longitude: null,
        coordinateSourceType: null,
        coordinateSourceUrl: null,
        confidence: "unknown",
      }),
      record({ sourceRecordKey: "example-bad-boundary", boundaryId: "postal-code-m5" }),
      record({ sourceRecordKey: "example-outreach", outreachStatus: "ready_to_send" }),
    ]);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected).toHaveLength(2);
    expect(plan.rejected[1].issues.map((issue) => issue.message)).toContain("unrecognized fields are forbidden: outreachStatus");
  });
});
