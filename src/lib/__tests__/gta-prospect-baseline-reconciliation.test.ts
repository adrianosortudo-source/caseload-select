import { describe, expect, it } from "vitest";

import {
  buildOperatorProspectBaseline,
  normalizeProspectFirmName,
  normalizeProspectStreetAddress,
  reconcileProspectCandidateAgainstBaseline,
} from "../gta-prospect-baseline-reconciliation";

describe("GTA prospect baseline reconciliation", () => {
  it("adapts the complete console baseline without treating legacy clusters as firms", () => {
    const baseline = buildOperatorProspectBaseline({
      fixtures: [{ id: "fixture-1", firmName: "Fixture Law", city: "Toronto", officeCities: ["Toronto"], websiteUrl: "https://fixture.test", practiceAreas: [], observedLawyerCount: 4, observedLawyerCountQualifier: "exact", observedLawyerCountDisplay: null, rosterSourceUrl: "https://fixture.test/team", rosterCheckedAt: "2026-09-08", reconciliationStatus: "provisional_new", legacyClusterLawyerCount: null, legacyCrosswalk: null, reconciliationNote: null, advertisingEvidence: "unknown", advertisingSourceUrl: null, gbpEvidence: "unknown", gbpSourceUrl: null }],
      ledgerProjection: [{ id: "ledger-1", firmName: "Ledger Law", city: "Mississauga", officeCities: ["Mississauga"], websiteUrl: "https://ledger.test", practiceAreas: [], observedLawyerCount: 5, observedLawyerCountQualifier: "exact", observedLawyerCountDisplay: null, rosterSourceUrl: "https://ledger.test/team", rosterCheckedAt: "2026-09-08", reconciliationStatus: "provisional_new", legacyClusterLawyerCount: null, legacyCrosswalk: null, reconciliationNote: null, advertisingEvidence: "unknown", advertisingSourceUrl: null, gbpEvidence: "unknown", gbpSourceUrl: null }],
      legacySource: [{ sourceRecordKey: "legacy:row-1", sourceId: "legacy-gta-directory-2026-07", sourceRowNumber: 1, sourceKind: "lso_address_cluster", identityStatus: "unresolved", firmId: null, canonicalDomain: null, candidate: { displayName: "Legacy Candidate", lawyerNames: "", lawyerCount: 2, address: "100-342 Queen Street West", city: "Toronto", postalCode: "", websiteUrl: "https://legacy.test", candidateDomain: "legacy.test" }, observations: { lsoObservedOn: "2026-07-12", gbpObservedOn: null }, raw: {} as never }],
    });

    expect(baseline).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: "fixture", recordId: "fixture-1", canonicalDomain: "https://fixture.test" }),
      expect.objectContaining({ origin: "ledger_projection", recordId: "ledger-1", canonicalDomain: "https://ledger.test" }),
      expect.objectContaining({ origin: "legacy_source", recordId: "legacy:row-1", streetAddress: "100-342 Queen Street West" }),
    ]));
  });

  it("checks fixture, ledger projection, and legacy baselines without selecting a merge target", () => {
    const review = reconcileProspectCandidateAgainstBaseline({
      candidateId: "batch-011-example",
      firmName: "Example Family Law LLP",
      canonicalDomain: "https://www.example.test/team",
      streetAddress: "Suite 200, 342 Queen St W",
      city: "Toronto",
    }, [
      { origin: "fixture", recordId: "fixture-example", firmName: "Example Family Law", canonicalDomain: "example.test" },
      { origin: "ledger_projection", recordId: "ledger-example", firmName: "A different firm", streetAddress: "200-342 Queen Street West", city: "Toronto" },
      { origin: "legacy_source", recordId: "legacy:row-42", firmName: "Example Family Law LLP", canonicalDomain: "https://example.test/contact" },
    ]);

    expect(review).toEqual({
      candidateId: "batch-011-example",
      state: "review_required",
      automaticMerge: false,
      matches: [
        { origin: "fixture", recordId: "fixture-example", fields: ["canonical_domain", "firm_name"] },
        { origin: "ledger_projection", recordId: "ledger-example", fields: ["street_address"] },
        { origin: "legacy_source", recordId: "legacy:row-42", fields: ["canonical_domain", "firm_name"] },
      ],
    });
  });

  it("normalizes legal suffixes and punctuation only for diagnostic exact-name review", () => {
    expect(normalizeProspectFirmName("Cappellacci DaRoza LLP")).toBe("cappellacci daroza");
    expect(normalizeProspectFirmName("Cappellacci & DaRoza, L.L.P.")).toBe("cappellacci and daroza");
  });

  it("does not collapse different suites while accepting equivalent street spellings", () => {
    expect(normalizeProspectStreetAddress("200-342 Queen St W")).toBe("unit=200;street=342 queen street west");
    expect(normalizeProspectStreetAddress("Suite 200, 342 Queen Street West")).toBe("unit=200;street=342 queen street west");
    expect(normalizeProspectStreetAddress("100-342 Queen Street West")).toBe("unit=100;street=342 queen street west");

    const review = reconcileProspectCandidateAgainstBaseline({
      candidateId: "suite-check",
      firmName: "Unrelated Firm",
      streetAddress: "200-342 Queen St W",
      city: "Toronto",
    }, [{
      origin: "legacy_source",
      recordId: "legacy:row-200",
      firmName: "Another Firm",
      streetAddress: "100-342 Queen Street West",
      city: "Toronto",
    }]);

    expect(review).toEqual({ candidateId: "suite-check", state: "clear", automaticMerge: false, matches: [] });
  });

  it("emits a clear review record when no deterministic baseline key matches", () => {
    expect(reconcileProspectCandidateAgainstBaseline({
      candidateId: "net-new",
      firmName: "Net New Law",
      canonicalDomain: "net-new.test",
    }, [{
      origin: "legacy_source",
      recordId: "legacy:row-1",
      firmName: "Different Law",
      canonicalDomain: "different.test",
    }])).toEqual({ candidateId: "net-new", state: "clear", automaticMerge: false, matches: [] });
  });
});
