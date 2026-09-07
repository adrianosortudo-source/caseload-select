import { describe, expect, it } from "vitest";
import {
  filterReconciledGtaProspects,
  lawyerCountBand,
  observedLawyerCountLabel,
  type ReconciledGtaProspect,
} from "../gta-prospect-records";

const records: ReconciledGtaProspect[] = [
  {
    id: "alpha-law-toronto",
    firmName: "Alpha Law",
    city: "Toronto",
    websiteUrl: "https://alpha.example.test",
    practiceAreas: ["Family law"],
    observedLawyerCount: 4,
    observedLawyerCountQualifier: "exact",
    observedLawyerCountDisplay: null,
    rosterSourceUrl: "https://alpha.example.test/team",
    rosterCheckedAt: "2026-09-07",
    reconciliationStatus: "provisional_new",
    legacyClusterLawyerCount: null,
    reconciliationNote: null,
    advertisingEvidence: "observed",
    advertisingSourceUrl: "https://ads.example.test/alpha",
    gbpEvidence: "unknown",
    gbpSourceUrl: null,
  },
  {
    id: "beta-law-oakville",
    firmName: "Beta Law",
    city: "Oakville",
    websiteUrl: null,
    practiceAreas: ["Civil litigation"],
    observedLawyerCount: 7,
    observedLawyerCountQualifier: "at_least",
    observedLawyerCountDisplay: null,
    rosterSourceUrl: "https://beta.example.test/team",
    rosterCheckedAt: "2026-09-07",
    reconciliationStatus: "update_existing",
    legacyClusterLawyerCount: 2,
    reconciliationNote: "Legacy cluster corrected from the firm roster.",
    advertisingEvidence: "unknown",
    advertisingSourceUrl: null,
    gbpEvidence: "observed",
    gbpSourceUrl: "https://maps.example.test/beta",
  },
];

describe("gta prospect records", () => {
  it("assigns display bands from an observed firm roster count", () => {
    expect(lawyerCountBand(null)).toBe("unknown");
    expect(lawyerCountBand(1)).toBe("1");
    expect(lawyerCountBand(2)).toBe("2");
    expect(lawyerCountBand(4)).toBe("3-5");
    expect(lawyerCountBand(7)).toBe("6-10");
    expect(lawyerCountBand(11)).toBe("11+");
  });

  it("keeps an at-least roster count distinct from an exact count", () => {
    expect(observedLawyerCountLabel(records[0])).toBe("4 lawyers");
    expect(observedLawyerCountLabel(records[1])).toBe("At least 7 lawyers");
  });

  it("preserves a roster-specific count label when one is supplied", () => {
    expect(observedLawyerCountLabel({ ...records[1], observedLawyerCountDisplay: "3 core + counsel" })).toBe("3 core + counsel");
  });

  it("combines count, location, and optional-evidence filters", () => {
    expect(filterReconciledGtaProspects(records, { lawyerCountBand: "3-5", city: "Toronto", advertising: "observed" })).toEqual([records[0]]);
    expect(filterReconciledGtaProspects(records, { lawyerCountBand: "6-10", gbp: "observed" })).toEqual([records[1]]);
    expect(filterReconciledGtaProspects(records, { practiceArea: "family law" })).toEqual([records[0]]);
  });
});
