import { describe, expect, it } from "vitest";
import {
  filterReconciledGtaProspects,
  lawyerCountBand,
  observedLawyerCountLabel,
  type ReconciledGtaProspect,
} from "../gta-prospect-records";
import { RECONCILED_GTA_PROSPECTS } from "@/app/admin/prospects/reconciled-prospects";

const records: ReconciledGtaProspect[] = [
  {
    id: "alpha-law-toronto",
    firmName: "Alpha Law",
    city: "Toronto",
    officeCities: ["Toronto"],
    websiteUrl: "https://alpha.example.test",
    practiceAreas: ["Family law"],
    observedLawyerCount: 4,
    observedLawyerCountQualifier: "exact",
    observedLawyerCountDisplay: null,
    rosterSourceUrl: "https://alpha.example.test/team",
    rosterCheckedAt: "2026-09-07",
    reconciliationStatus: "provisional_new",
    legacyClusterLawyerCount: null,
    legacyCrosswalk: null,
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
    officeCities: ["Oakville"],
    websiteUrl: null,
    practiceAreas: ["Civil litigation"],
    observedLawyerCount: 7,
    observedLawyerCountQualifier: "at_least",
    observedLawyerCountDisplay: null,
    rosterSourceUrl: "https://beta.example.test/team",
    rosterCheckedAt: "2026-09-07",
    reconciliationStatus: "update_existing",
    legacyClusterLawyerCount: 2,
    legacyCrosswalk: "Legacy cluster 42, reviewed through firm domain.",
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

  it("filters the operator-only owner-contact display state without changing the core research contract", () => {
    const direct = { ...records[0], ownerContact: {
      ownerName: "Example Owner",
      ownerRole: "owner" as const,
      ownershipConfidence: "confirmed_owner" as const,
      emailAvailability: "direct_owner_email" as const,
      emailAddress: "owner@example.test",
    } };
    const general = { ...records[1], ownerContact: {
      ownerName: "Example Leader",
      ownerRole: "managing_partner" as const,
      ownershipConfidence: "leadership_only" as const,
      emailAvailability: "firm_general_email" as const,
      emailAddress: "info@example.test",
    } };

    expect(filterReconciledGtaProspects([direct, general, records[1]], { ownerContact: "identified" })).toEqual([direct, general]);
    expect(filterReconciledGtaProspects([direct, general, records[1]], { ownerContact: "direct_owner_email" })).toEqual([direct]);
    expect(filterReconciledGtaProspects([direct, general, records[1]], { ownerContact: "needs_direct_email" })).toEqual([general, records[1]]);
  });

  it("keeps the reviewed 20-firm batch and its reconciliation safeguards intact", () => {
    expect(RECONCILED_GTA_PROSPECTS).toHaveLength(20);
    expect(RECONCILED_GTA_PROSPECTS.filter((record) => record.reconciliationStatus === "update_existing")).toHaveLength(8);
    expect(RECONCILED_GTA_PROSPECTS.find((record) => record.firmName === "Lockyer + Hein")?.reconciliationStatus).toBe("new_pending_identity");
    expect(RECONCILED_GTA_PROSPECTS.find((record) => record.firmName === "Vakili Law Group")?.observedLawyerCountDisplay).toBe("3 core + counsel");
    expect(RECONCILED_GTA_PROSPECTS.find((record) => record.firmName === "Book Erskine")?.observedLawyerCountDisplay).toBe("4+");
  });

  it("keeps the reviewed batch's real count bands and observed advertising evidence", () => {
    expect(filterReconciledGtaProspects(RECONCILED_GTA_PROSPECTS, { lawyerCountBand: "3-5" })).toHaveLength(14);
    expect(filterReconciledGtaProspects(RECONCILED_GTA_PROSPECTS, { lawyerCountBand: "6-10" })).toHaveLength(6);
    expect(filterReconciledGtaProspects(RECONCILED_GTA_PROSPECTS, { advertising: "observed" }).map((record) => record.firmName)).toEqual([
      "KPA Lawyers Professional Corporation",
      "Angrove Law",
      "Heft Law",
    ]);
  });

  it("records the verified evidence links and does not invent legacy crosswalk IDs", () => {
    const kpa = RECONCILED_GTA_PROSPECTS.find((record) => record.firmName === "KPA Lawyers Professional Corporation");
    const angrove = RECONCILED_GTA_PROSPECTS.find((record) => record.firmName === "Angrove Law");
    const heft = RECONCILED_GTA_PROSPECTS.find((record) => record.firmName === "Heft Law");
    const falcone = RECONCILED_GTA_PROSPECTS.find((record) => record.firmName === "Falcone Law");

    expect(kpa?.advertisingSourceUrl).toBe("https://adstransparency.google.com/advertiser/AR18160649533254533121?region=CA");
    expect(angrove?.gbpSourceUrl).toContain("Angrove%20Law");
    expect(heft?.gbpSourceUrl).toContain("Heft%20Law");
    expect(kpa?.legacyClusterLawyerCount).toBeNull();
    expect(kpa?.legacyCrosswalk).toContain("row-level cluster ID unavailable");
    expect(falcone?.officeCities).toEqual(["Oakville", "Vaughan"]);
    expect(filterReconciledGtaProspects(RECONCILED_GTA_PROSPECTS, { city: "Oakville" })).toContain(falcone);
    expect(filterReconciledGtaProspects(RECONCILED_GTA_PROSPECTS, { city: "Vaughan" })).toContain(falcone);
  });
});
