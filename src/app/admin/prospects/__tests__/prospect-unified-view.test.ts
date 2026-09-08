import { describe, expect, it } from "vitest";
import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";
import { filterUnifiedProspectState, prospectIdentityState, prospectSources } from "../prospect-unified-view";

function record(overrides: Partial<ReconciledGtaProspect> = {}): ReconciledGtaProspect {
  return {
    id: "fixture-firm",
    recordOrigin: "reviewed_fixture",
    firmName: "Fixture Firm",
    city: "Toronto",
    officeCities: ["Toronto"],
    websiteUrl: "https://example.com",
    practiceAreas: [],
    observedLawyerCount: 2,
    observedLawyerCountQualifier: "exact",
    observedLawyerCountDisplay: null,
    rosterSourceUrl: "https://example.com/team",
    rosterCheckedAt: "2026-09-07",
    reconciliationStatus: "provisional_new",
    legacyClusterLawyerCount: null,
    legacyCrosswalk: null,
    reconciliationNote: null,
    advertisingEvidence: "unknown",
    advertisingSourceUrl: null,
    gbpEvidence: "unknown",
    gbpSourceUrl: null,
    ...overrides,
  };
}

describe("unified prospect view", () => {
  it("shows multiple provenance badges without collapsing the sources", () => {
    const linked = record({
      recordOrigin: "research_ledger",
      firmId: "FIRM-TEST",
      legacyCrosswalk: "Reviewed legacy relationship.",
      qualifiedDossier: { audit: { state: "ready" } } as unknown as ReconciledGtaProspect["qualifiedDossier"],
    });
    expect(prospectSources(linked)).toEqual(["shared_registry", "research_ledger", "legacy_provenance"]);
    expect(prospectIdentityState(linked)).toBe("linked");
  });

  it("surfaces unresolved and duplicate records in the identity-review view", () => {
    const records = [
      record({ id: "linked", firmId: "FIRM-TEST" }),
      record({ id: "pending", reconciliationStatus: "new_pending_identity" }),
      record({ id: "duplicate", reconciliationStatus: "duplicate" }),
      record({ id: "provisional", reconciliationStatus: "provisional_new" }),
    ];
    expect(filterUnifiedProspectState(records, { quickView: "identity_review" }).map((item) => item.id)).toEqual(["pending", "duplicate"]);
    expect(filterUnifiedProspectState(records, { identity: "provisional" }).map((item) => item.id)).toEqual(["provisional"]);
  });
});
