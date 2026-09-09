import { describe, expect, it } from "vitest";

import {
  buildGtaProspectIdentitySnapshot,
  parseGtaProspectIdentitySnapshot,
} from "../gta-prospect-identity-snapshot";
import type { ReconciledGtaProspect } from "../gta-prospect-records";

const record: ReconciledGtaProspect = {
  id: "ledger-1", firmName: "Example & Law Law LLP", city: "Toronto", officeCities: ["Toronto"], websiteUrl: "https://www.example.test/team",
  practiceAreas: [], observedLawyerCount: 4, observedLawyerCountQualifier: "exact", observedLawyerCountDisplay: null,
  rosterSourceUrl: "https://example.test/team", rosterCheckedAt: "2026-09-09", reconciliationStatus: "provisional_new",
  legacyClusterLawyerCount: null, legacyCrosswalk: null, reconciliationNote: null, advertisingEvidence: "unknown", advertisingSourceUrl: null,
  gbpEvidence: "unknown", gbpSourceUrl: null, publicContacts: [{ name: "Owner", relationship: "owner", email: "owner@example.test", emailKind: "owner", sourceUrl: null, observedAt: "2026-09-09" }],
};

describe("GTA prospect identity snapshot", () => {
  it("exports only normalized identity keys and verifies count, hash, and date", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    const snapshot = buildGtaProspectIdentitySnapshot([record], now);
    expect(snapshot.records).toEqual([{ record_id: "ledger-1", normalized_firm_name: "example and law law", canonical_domain: "example.test" }]);
    expect(JSON.stringify(snapshot)).not.toContain("owner@example.test");
    expect(parseGtaProspectIdentitySnapshot(snapshot, { expectedCount: 1, now })).toEqual(snapshot);
  });

  it("fails closed on stale, count-mismatched, hash-mismatched, and drifted snapshots", () => {
    const snapshot = buildGtaProspectIdentitySnapshot([record], new Date("2026-09-09T12:00:00.000Z"));
    expect(() => parseGtaProspectIdentitySnapshot(snapshot, { expectedCount: 2, now: new Date("2026-09-09T12:00:00.000Z") })).toThrow("count mismatch");
    expect(() => parseGtaProspectIdentitySnapshot({ ...snapshot, records_sha256: "0".repeat(64) }, { expectedCount: 1, now: new Date("2026-09-09T12:00:00.000Z") })).toThrow("hash mismatch");
    expect(() => parseGtaProspectIdentitySnapshot({ ...snapshot, contacts: [] }, { expectedCount: 1, now: new Date("2026-09-09T12:00:00.000Z") })).toThrow("schema drift");
    expect(() => parseGtaProspectIdentitySnapshot(snapshot, { expectedCount: 1, now: new Date("2026-09-11T12:00:00.000Z") })).toThrow("stale");
  });
});
