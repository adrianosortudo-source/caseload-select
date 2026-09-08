import { describe, expect, it } from "vitest";
import { legacyGtaDirectoryProspects } from "../unified-gta-prospect-records";

describe("legacy GTA directory display adapter", () => {
  it("keeps every source row unresolved and does not promote cluster counts to firm rosters", () => {
    const records = legacyGtaDirectoryProspects();
    expect(records).toHaveLength(5_902);
    expect(records.every((record) => record.recordOrigin === "legacy_provenance")).toBe(true);
    expect(records.every((record) => record.reconciliationStatus === "unresolved" && record.firmId === null)).toBe(true);
    expect(records.every((record) => record.observedLawyerCount === null && record.observedLawyerCountQualifier === "unknown")).toBe(true);
    expect(records[0]?.id).toBe("legacy-gta-directory-2026-07:row-1");
  });
});
