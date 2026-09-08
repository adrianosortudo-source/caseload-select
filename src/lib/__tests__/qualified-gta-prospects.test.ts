import { describe, expect, it } from "vitest";
import { filterReconciledGtaProspects, type ReconciledGtaProspect } from "../gta-prospect-records";
import {
  QUALIFIED_GTA_PROSPECT_ARTIFACT,
  QUALIFIED_GTA_PROSPECT_EVIDENCE,
  QUALIFIED_GTA_PROSPECTS,
  evidenceForQualifiedProspect,
  mergeQualifiedProspects,
  normalizeCanonicalDomain,
} from "../qualified-gta-prospects";

function base(overrides: Partial<ReconciledGtaProspect> = {}): ReconciledGtaProspect {
  return {
    id: "existing-firm",
    firmName: "Existing display name",
    city: "Toronto",
    officeCities: ["Toronto"],
    websiteUrl: "https://example.test/",
    practiceAreas: ["Family law"],
    observedLawyerCount: 5,
    observedLawyerCountQualifier: "exact",
    observedLawyerCountDisplay: null,
    rosterSourceUrl: "https://example.test/team",
    rosterCheckedAt: "2026-09-06",
    reconciliationStatus: "update_existing",
    legacyClusterLawyerCount: 2,
    legacyCrosswalk: "Preserved legacy provenance.",
    reconciliationNote: "Preserved review note.",
    advertisingEvidence: "unknown",
    advertisingSourceUrl: null,
    gbpEvidence: "unknown",
    gbpSourceUrl: null,
    ...overrides,
  };
}

describe("qualified GTA prospect artifact", () => {
  it("retains the completed evidence-bearing cohort and its disabled action controls", () => {
    expect(QUALIFIED_GTA_PROSPECTS).toHaveLength(20);
    expect(QUALIFIED_GTA_PROSPECT_EVIDENCE).toHaveLength(94);
    expect(new Set(QUALIFIED_GTA_PROSPECTS.map((record) => record.firmId)).size).toBe(20);
    expect(new Set(QUALIFIED_GTA_PROSPECTS.map((record) => record.canonicalDomain)).size).toBe(20);
    expect(QUALIFIED_GTA_PROSPECTS.filter((record) => record.lawyerCount.observedCount === 2)).toHaveLength(16);
    expect(QUALIFIED_GTA_PROSPECTS.filter((record) => record.lawyerCount.observedCount === 3)).toHaveLength(4);
    expect(QUALIFIED_GTA_PROSPECTS.every((record) => record.lawyerCount.namedLawyers.length === record.lawyerCount.observedCount)).toBe(true);
    expect(QUALIFIED_GTA_PROSPECTS.every((record) => record.advertisingActivity.spendClaim === "not_made")).toBe(true);
    expect(QUALIFIED_GTA_PROSPECTS.every((record) => record.audit.state === "ready")).toBe(true);
    expect(QUALIFIED_GTA_PROSPECTS.every((record) => record.audit.verificationPriorities.length > 0)).toBe(true);
    expect(QUALIFIED_GTA_PROSPECTS.every((record) => Object.values(record.controls).every((value) => value === false))).toBe(true);
    expect(Object.values(QUALIFIED_GTA_PROSPECT_ARTIFACT.controls).every((value) => value === false)).toBe(true);
  });

  it("retains one ownership-safe source hash for every registered evidence record", () => {
    expect(new Set(QUALIFIED_GTA_PROSPECT_EVIDENCE.map((record) => record.evidenceId)).size).toBe(94);
    for (const dossier of QUALIFIED_GTA_PROSPECTS) {
      const evidence = evidenceForQualifiedProspect(dossier.firmId);
      const aggregateIds = new Set(dossier.evidenceIds);
      const fieldIds = [
        ...dossier.lawyerCount.evidenceIds,
        ...dossier.advertisingActivity.evidenceIds,
        ...dossier.websiteAndIntake.evidenceIds,
      ];
      expect(evidence.length).toBe(dossier.evidenceIds.length);
      expect(new Set(evidence.map((record) => record.evidenceId))).toEqual(new Set(dossier.evidenceIds));
      expect(evidence.every((record) => /^[a-f0-9]{64}$/.test(record.captureSha256))).toBe(true);
      expect(evidence.every((record) => record.sourceType.trim().length > 0)).toBe(true);
      expect(fieldIds.every((evidenceId) => aggregateIds.has(evidenceId))).toBe(true);
      expect(fieldIds.every((evidenceId) => evidence.find((record) => record.evidenceId === evidenceId)?.firmId === dossier.firmId)).toBe(true);
      const advertisingTypes = new Set(dossier.advertisingActivity.evidenceIds.map((evidenceId) => evidence.find((record) => record.evidenceId === evidenceId)?.sourceType));
      expect(new Set(dossier.advertisingActivity.sourceTypes)).toEqual(advertisingTypes);
    }
  });

  it("normalizes host identity without conflating paths or www aliases", () => {
    expect(normalizeCanonicalDomain("HTTPS://WWW.StruthersLaw.ca/contact?q=1")).toBe("strutherslaw.ca");
    expect(normalizeCanonicalDomain("strutherslaw.ca.")).toBe("strutherslaw.ca");
    expect(normalizeCanonicalDomain("not a host")).toBeNull();
  });
});

describe("qualified prospect reconciliation", () => {
  it("adds every missing qualified firm once and is idempotent on a second pass", () => {
    const first = mergeQualifiedProspects([base()]);
    expect(first.report).toMatchObject({ inputCount: 20, added: 20, updated: 0, ambiguous: 0, unchangedBaseRecords: 1 });
    expect(first.records).toHaveLength(21);
    expect(new Set(first.records.map((record) => normalizeCanonicalDomain(record.canonicalDomain ?? record.websiteUrl))).size).toBe(21);

    const second = mergeQualifiedProspects(first.records);
    expect(second.report).toMatchObject({ added: 0, updated: 20, ambiguous: 0 });
    expect(second.records).toEqual(first.records);
  });

  it("enriches one canonical-domain match while preserving existing record provenance", () => {
    const matched = base({
      id: "old-struthers-row",
      firmName: "Struthers Law",
      websiteUrl: "https://www.strutherslaw.ca/contact.html",
    });
    const result = mergeQualifiedProspects([matched]);
    const enriched = result.records.find((record) => record.id === "old-struthers-row");

    expect(result.report).toMatchObject({ added: 19, updated: 1, ambiguous: 0 });
    expect(enriched).toMatchObject({
      id: "old-struthers-row",
      firmName: "Struthers Law",
      city: "Toronto",
      practiceAreas: ["Family law"],
      legacyCrosswalk: "Preserved legacy provenance.",
      firmId: "FIRM-7XGYP723JDAXDAB2J76RVNSVD5",
      canonicalDomain: "strutherslaw.ca",
      observedLawyerCount: 2,
      advertisingEvidence: "observed",
      gbpEvidence: "observed",
    });
  });

  it("holds a qualified identity when the canonical domain matches multiple base records", () => {
    const result = mergeQualifiedProspects([
      base({ id: "duplicate-a", websiteUrl: "https://strutherslaw.ca" }),
      base({ id: "duplicate-b", websiteUrl: "https://www.strutherslaw.ca/about" }),
    ]);
    expect(result.report).toMatchObject({ added: 19, updated: 0, ambiguous: 1 });
    expect(result.report.ambiguities[0]).toMatchObject({
      firmId: "FIRM-7XGYP723JDAXDAB2J76RVNSVD5",
      canonicalDomain: "strutherslaw.ca",
      recordIds: ["duplicate-a", "duplicate-b"],
    });
    expect(result.records.filter((record) => record.firmId === "FIRM-7XGYP723JDAXDAB2J76RVNSVD5")).toHaveLength(0);
  });

  it("supports the qualification filters without turning unknown evidence into a match", () => {
    const result = mergeQualifiedProspects([base()]).records;
    expect(filterReconciledGtaProspects(result, { qualification: "qualified" })).toHaveLength(20);
    expect(filterReconciledGtaProspects(result, { qualification: "needs_evidence" })).toHaveLength(1);
    expect(filterReconciledGtaProspects(result, { exactLawyerCount: "2-3", qualification: "qualified" })).toHaveLength(20);
    expect(filterReconciledGtaProspects(result, { exactLawyerCount: "3", qualification: "qualified" })).toHaveLength(4);
    expect(filterReconciledGtaProspects(result, { audit: "ready" })).toHaveLength(20);
    expect(filterReconciledGtaProspects(result, { advertisingActivity: "observable_historical" }).length).toBeGreaterThan(0);
    const advertisingSourceMatches = filterReconciledGtaProspects(result, { advertisingSourceType: "ad_library_record" });
    expect(advertisingSourceMatches).toHaveLength(8);
    expect(advertisingSourceMatches.every((record) => record.qualifiedDossier?.advertisingActivity.sourceTypes.includes("ad_library_record"))).toBe(true);
    expect(filterReconciledGtaProspects(result, { intakeChannel: "Form Or Questionnaire" })).toHaveLength(20);
    expect(filterReconciledGtaProspects(result, { lawyerCountConfidence: "high" })).toHaveLength(1);
    expect(filterReconciledGtaProspects(result, { cohortId: "qualified-prospects-2026-09-07" })).toHaveLength(20);
    expect(filterReconciledGtaProspects(result, { evidenceFreshness: "last_30_days", referenceDate: new Date("2026-09-20T00:00:00Z") })).toHaveLength(21);
  });
});
