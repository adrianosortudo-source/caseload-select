import { describe, expect, it } from "vitest";
import {
  LEGACY_GTA_SOURCE_ID,
  adaptLegacyGtaRows,
  extractLegacyGtaArtifactData,
  legacyGtaReconciliationSummary,
  legacyGtaSourceRecords,
} from "../legacy-gta-prospect-source";

describe("legacy GTA source adapter", () => {
  it("preserves every column and leaves a synthetic fixture unresolved", () => {
    const fixture = extractLegacyGtaArtifactData(`const DATA = {"columns":["business_name","lawyer_names","lawyer_count","phone","email","street","city","postal_code","website_url","website_confidence","same_business_name","advertising","ad_vendors","main_pa","practice_areas","pa_confidence","outreach_language_tier","gbp_found","gbp_reviews_count","gbp_rating","gbp_claimed"],"rows":[["Example & Co.","A. Example; B. Example","2","555-0100","hello@example.test","1 Main St","Toronto","M5V 1A1","https://www.example.test/contact","high","yes","advertising","google_ads","family","family","high","none","yes","4","5.0","unclaimed"]]};\n  const COLS = DATA.columns;`);
    const [record] = adaptLegacyGtaRows(fixture);

    expect(record).toMatchObject({
      sourceRecordKey: `${LEGACY_GTA_SOURCE_ID}:row-1`,
      sourceKind: "lso_address_cluster",
      identityStatus: "unresolved",
      firmId: null,
      canonicalDomain: null,
      candidate: { displayName: "Example & Co.", lawyerCount: 2, candidateDomain: "example.test" },
      raw: { advertising: "advertising", gbp_reviews_count: "4" },
    });
  });

  it("rejects an artifact whose source payload is absent or incomplete", () => {
    expect(() => extractLegacyGtaArtifactData("<html />")).toThrow("data payload was not found");
    expect(() => adaptLegacyGtaRows({ columns: ["business_name"], rows: [["Example"]] })).toThrow("missing required column");
  });

  it("adapts the complete preserved corpus without manufacturing firm links", () => {
    const records = legacyGtaSourceRecords();
    const summary = legacyGtaReconciliationSummary(records);

    expect(records).toHaveLength(5902);
    expect(new Set(records.map((record) => record.sourceRecordKey)).size).toBe(records.length);
    expect(records.every((record) => record.identityStatus === "unresolved" && record.firmId === null && record.canonicalDomain === null)).toBe(true);
    expect(summary).toMatchObject({ sourceRows: 5902, unresolvedSourceRecords: 5902, confirmedFirmLinks: 0 });
    expect(summary.rowsWithCandidateWebsite).toBe(3022);
    expect(summary.rowsWithGbpObservation).toBe(3307);
  });
});
