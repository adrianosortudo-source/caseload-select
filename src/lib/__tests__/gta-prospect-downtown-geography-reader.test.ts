import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GtaProspectDowntownGeographyLedgerUnavailableError,
  listGtaProspectDowntownGeographyForOperator,
  type GtaProspectDowntownGeographyReaderClient,
} from "../gta-prospect-downtown-geography-reader";
import { DOWNTOWN_TORONTO_BOUNDARY_ID, DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL } from "../downtown-toronto-cohort";

function row(overrides: Record<string, unknown> = {}) {
  return {
    source_record_key: "example-family-law",
    boundary_id: DOWNTOWN_TORONTO_BOUNDARY_ID,
    geography_status: "inside",
    normalized_address: "100 Queen Street West, Toronto, ON M5H 2N2",
    latitude: 43.6512,
    longitude: -79.3833,
    coordinate_source_type: "toronto_one_address_repository",
    coordinate_source_url: "https://open.toronto.ca/dataset/address-points-municipal-toronto-one-address-repository/",
    boundary_source_url: DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL,
    boundary_geometry_sha256: "a".repeat(64),
    observed_on: "2026-09-08",
    confidence: "high",
    note: null,
    ...overrides,
  };
}

function client(data: unknown, error: { code?: string; message?: string } | null = null): GtaProspectDowntownGeographyReaderClient {
  return { rpc: vi.fn(async () => ({ data, error })) };
}

describe("GTA prospect Downtown geography operator reader", () => {
  it("maps only the typed current summary", async () => {
    const db = client([row()]);
    await expect(listGtaProspectDowntownGeographyForOperator(db)).resolves.toEqual([
      expect.objectContaining({ sourceRecordKey: "example-family-law", status: "inside", latitude: 43.6512, boundarySourceUrl: DOWNTOWN_TORONTO_BOUNDARY_SOURCE_URL }),
    ]);
    expect(db.rpc).toHaveBeenCalledWith("list_gta_prospect_downtown_geography_for_operator");
  });

  it("preserves the complete official Toronto boundary query URL", async () => {
    const boundarySourceUrl = "https://gis.toronto.ca/arcgis/rest/services/cot_geospatial11/MapServer/44/query?where=SECONDARY_PLAN_NUMBER%3D%2741%27&outFields=OBJECTID%2CSECONDARY_PLAN_NUMBER%2CSECONDARY_PLAN_NAME%2CSTATUS&returnGeometry=true&f=geojson&outSR=4326";
    await expect(listGtaProspectDowntownGeographyForOperator(client([row({ boundary_source_url: boundarySourceUrl })]))).resolves.toEqual([
      expect.objectContaining({ boundarySourceUrl }),
    ]);
  });

  it("rejects a boundary source URL outside the official Toronto layer", async () => {
    await expect(listGtaProspectDowntownGeographyForOperator(client([row({ boundary_source_url: "https://example.com/MapServer/44/query" })]))).rejects.toThrow("boundary_source_url is invalid");
  });

  it("uses fallback only when the new read projection does not exist", async () => {
    await expect(listGtaProspectDowntownGeographyForOperator(client(null, {
      code: "PGRST202",
      message: "Could not find the function public.list_gta_prospect_downtown_geography_for_operator in the schema cache",
    }))).rejects.toBeInstanceOf(GtaProspectDowntownGeographyLedgerUnavailableError);
  });

  it("fails closed for a non-coordinate inside conclusion or unexpected database field", async () => {
    await expect(listGtaProspectDowntownGeographyForOperator(client([
      row({ latitude: null, longitude: null, coordinate_source_type: null, coordinate_source_url: null }),
    ]))).rejects.toThrow("inside or outside geography has no evidence-bearing coordinates");
    await expect(listGtaProspectDowntownGeographyForOperator(client([
      row({ internal_note: "do not expose" }),
    ]))).rejects.toThrow("unexpected column(s): internal_note");
  });
});
