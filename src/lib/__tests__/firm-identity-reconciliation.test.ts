import { describe, expect, it } from "vitest";

import {
  isStableFirmId,
  matchFirmIdentityCandidate,
  normalizeFirmDomain,
  resolveFirmIdentityEvidence,
  sourceRecordMappingKey,
  validateFirmSourceRecordMapping,
  type FirmSourceRecordMapping,
  type GovernedFirmIdentity,
  type StableFirmId,
} from "../firm-identity-reconciliation";

const ALPHA_ID = "FIRM-7XGYP723JDAXDAB2J76RVNSVD5" as StableFirmId;
const BETA_ID = "FIRM-0ASA53E0B4GEF0WGDPDBMXAWQ9" as StableFirmId;

const identities: readonly GovernedFirmIdentity[] = [
  { firmId: ALPHA_ID, canonicalName: "Alpha Law", canonicalDomain: "alpha.example" },
  { firmId: BETA_ID, canonicalName: "Beta Legal", canonicalDomain: "beta.example" },
];

const baseMapping = {
  sourceSystem: "legacy-crm",
  sourceRecordId: "row-17",
  observedAt: "2026-09-07T12:00:00.000Z",
  confidence: "high" as const,
  evidenceIds: ["EVID-ROW-17"],
  reason: "A named reviewer confirmed this source-record relationship.",
};

describe("firm identity normalization and mapping contract", () => {
  it("accepts governed Crockford IDs and canonicalizes safe web domains", () => {
    expect(isStableFirmId(ALPHA_ID)).toBe(true);
    expect(isStableFirmId("FIRM-not-a-governed-id")).toBe(false);
    expect(normalizeFirmDomain("https://WWW.Alpha.Example/team?ref=legacy")).toBe("alpha.example");
    expect(normalizeFirmDomain("ftp://alpha.example")).toBeNull();
    expect(normalizeFirmDomain("https://user:secret@alpha.example")).toBeNull();
  });

  it("uses a deterministic, collision-safe source-record key", () => {
    expect(sourceRecordMappingKey({ sourceSystem: " Legacy-CRM ", sourceRecordId: " row:17 " }))
      .toBe('["legacy-crm","row:17"]');
    expect(() => sourceRecordMappingKey({ sourceSystem: "", sourceRecordId: "row-17" })).toThrow();
  });

  it("enforces the evidence-bearing shape of each explicit match state", () => {
    const confirmed: FirmSourceRecordMapping = { ...baseMapping, matchState: "confirmed", firmId: ALPHA_ID };
    const unresolved: FirmSourceRecordMapping = {
      ...baseMapping,
      matchState: "unresolved",
      firmId: null,
      candidateFirmIds: [ALPHA_ID, BETA_ID],
    };
    const distinct: FirmSourceRecordMapping = {
      ...baseMapping,
      matchState: "distinct",
      firmId: null,
      distinctFromFirmIds: [ALPHA_ID],
    };

    expect(validateFirmSourceRecordMapping(confirmed)).toEqual([]);
    expect(validateFirmSourceRecordMapping(unresolved)).toEqual([]);
    expect(validateFirmSourceRecordMapping(distinct)).toEqual([]);
    expect(validateFirmSourceRecordMapping({ ...distinct, distinctFromFirmIds: [], evidenceIds: [] }))
      .toEqual(expect.arrayContaining([
        "Source mapping requires at least one evidence ID.",
        "Distinct source mappings require at least one firm ID they are distinct from.",
      ]));
  });
});

describe("evidence precedence", () => {
  it("resolves by source, then observation date, then confidence, independent of input order", () => {
    const observations = [
      { evidenceId: "legacy", source: "legacy_dataset" as const, observedAt: "2026-09-08", confidence: "high" as const, value: "Legacy Name" },
      { evidenceId: "older-first-party", source: "first_party_canonical" as const, observedAt: "2026-09-01", confidence: "high" as const, value: "Current Name" },
      { evidenceId: "newer-directory", source: "directory_record" as const, observedAt: "2026-09-08", confidence: "high" as const, value: "Directory Name" },
    ];

    expect(resolveFirmIdentityEvidence(observations).preferred?.evidenceId).toBe("older-first-party");
    expect(resolveFirmIdentityEvidence([...observations].reverse()).preferred?.evidenceId).toBe("older-first-party");

    const sameSource = [
      { evidenceId: "older", source: "first_party_canonical" as const, observedAt: "2026-09-01", confidence: "high" as const, value: "Old" },
      { evidenceId: "newer-low", source: "first_party_canonical" as const, observedAt: "2026-09-08", confidence: "low" as const, value: "New" },
    ];
    expect(resolveFirmIdentityEvidence(sameSource).preferred?.evidenceId).toBe("newer-low");
  });

  it("blocks equally ranked conflicting values instead of picking by input or evidence ID", () => {
    const resolution = resolveFirmIdentityEvidence([
      { evidenceId: "EVID-B", source: "public_regulator", observedAt: "2026-09-08", confidence: "high", value: "Alpha" },
      { evidenceId: "EVID-A", source: "public_regulator", observedAt: "2026-09-08", confidence: "high", value: "Beta" },
    ]);

    expect(resolution.state).toBe("conflict");
    expect(resolution.preferred).toBeNull();
    expect(resolution.contenders.map((item) => item.evidenceId)).toEqual(["EVID-A", "EVID-B"]);
  });
});

describe("deterministic high-confidence matching", () => {
  const candidate = {
    sourceSystem: "legacy-crm",
    sourceRecordId: "row-17",
    firmName: "Alpha Law",
    canonicalDomain: "https://www.alpha.example/contact",
  };

  it("authorizes only an exact governed stable ID or a unique canonical domain", () => {
    expect(matchFirmIdentityCandidate({ ...candidate, firmId: ALPHA_ID }, identities, [])).toMatchObject({
      matchState: "confirmed",
      firmId: ALPHA_ID,
      basis: "stable_firm_id",
      mergeAuthorized: true,
    });
    expect(matchFirmIdentityCandidate(candidate, identities, [])).toMatchObject({
      matchState: "confirmed",
      firmId: ALPHA_ID,
      basis: "unique_canonical_domain",
      mergeAuthorized: true,
    });
  });

  it("lets an explicit confirmed source mapping authorize the same identity", () => {
    const mapping: FirmSourceRecordMapping = { ...baseMapping, matchState: "confirmed", firmId: ALPHA_ID };
    expect(matchFirmIdentityCandidate(candidate, identities, [mapping])).toMatchObject({
      matchState: "confirmed",
      firmId: ALPHA_ID,
      basis: "confirmed_source_mapping",
      mergeAuthorized: true,
    });
  });

  it("keeps explicit unresolved and distinct decisions out of automatic merging", () => {
    const unresolved: FirmSourceRecordMapping = {
      ...baseMapping,
      matchState: "unresolved",
      firmId: null,
      candidateFirmIds: [ALPHA_ID, BETA_ID],
    };
    const distinct: FirmSourceRecordMapping = {
      ...baseMapping,
      matchState: "distinct",
      firmId: null,
      distinctFromFirmIds: [ALPHA_ID],
    };

    expect(matchFirmIdentityCandidate(candidate, identities, [unresolved])).toMatchObject({
      matchState: "unresolved",
      basis: "explicit_unresolved_mapping",
      mergeAuthorized: false,
    });
    expect(matchFirmIdentityCandidate(candidate, identities, [distinct])).toMatchObject({
      matchState: "distinct",
      basis: "explicit_distinct_mapping",
      mergeAuthorized: false,
    });
  });

  it("blocks conflicting identifiers, ambiguous domains, and name-only similarity", () => {
    expect(matchFirmIdentityCandidate({ ...candidate, firmId: BETA_ID }, identities, [])).toMatchObject({
      matchState: "unresolved",
      basis: "conflicting_high_confidence_identifiers",
      mergeAuthorized: false,
    });

    const duplicateDomainIdentities = [
      ...identities,
      { firmId: "FIRM-5A0EP5WBAVYXAZBMVK5CESF0N5" as StableFirmId, canonicalName: "Alpha Chambers", canonicalDomain: "alpha.example" },
    ];
    expect(matchFirmIdentityCandidate(candidate, duplicateDomainIdentities, [])).toMatchObject({
      matchState: "unresolved",
      basis: "ambiguous_canonical_domain",
      mergeAuthorized: false,
    });

    expect(matchFirmIdentityCandidate({ ...candidate, canonicalDomain: null }, identities, [])).toMatchObject({
      matchState: "unresolved",
      basis: "name_only_candidate",
      mergeAuthorized: false,
    });
  });

  it("blocks contradictory source mappings and is deterministic for equivalent mappings", () => {
    const confirmed: FirmSourceRecordMapping = { ...baseMapping, matchState: "confirmed", firmId: ALPHA_ID };
    const distinct: FirmSourceRecordMapping = {
      ...baseMapping,
      matchState: "distinct",
      firmId: null,
      distinctFromFirmIds: [ALPHA_ID],
    };
    expect(matchFirmIdentityCandidate(candidate, identities, [confirmed, distinct])).toMatchObject({
      matchState: "unresolved",
      basis: "conflicting_high_confidence_identifiers",
      mergeAuthorized: false,
    });

    const older = { ...confirmed, observedAt: "2026-09-01", reason: "Older confirmation." };
    const newer = { ...confirmed, observedAt: "2026-09-08", reason: "Newer confirmation." };
    expect(matchFirmIdentityCandidate(candidate, identities, [older, newer]).reasons).toEqual(["Newer confirmation."]);
    expect(matchFirmIdentityCandidate(candidate, identities, [newer, older]).reasons).toEqual(["Newer confirmation."]);
  });
});
