import { describe, expect, it } from "vitest";

import { buildGtaProspectIdentitySnapshot } from "../gta-prospect-identity-snapshot";
import { reconcileGtaProspectBatch012 } from "../gta-prospect-live-baseline-gate";
import type { ReconciledGtaProspect } from "../gta-prospect-records";

const ledger: ReconciledGtaProspect = {
  id: "ledger-1", firmName: "Live Existing Law", city: "Toronto", officeCities: ["Toronto"], websiteUrl: "https://existing.test",
  practiceAreas: [], observedLawyerCount: 4, observedLawyerCountQualifier: "exact", observedLawyerCountDisplay: null,
  rosterSourceUrl: "https://existing.test/team", rosterCheckedAt: "2026-09-09", reconciliationStatus: "provisional_new",
  legacyClusterLawyerCount: null, legacyCrosswalk: null, reconciliationNote: null, advertisingEvidence: "unknown", advertisingSourceUrl: null, gbpEvidence: "unknown", gbpSourceUrl: null,
};
const west = {
  schema_version: "1.1", batch_id: "gta-prospect-batch-012", lane: "west-north", records: [
    { record_id: "B012-1", firm_name: "Live Existing Law", canonical_domain: "existing.test", accepted: false, import_ready: false, office: { cities: ["Toronto"], published_address: "200-342 Queen St W, Toronto, ON M5V 1Z2" } },
    { record_id: "B012-2", firm_name: "Different Law", canonical_domain: "different.test", accepted: false, import_ready: false, office: { cities: ["Toronto"], published_address: "100-342 Queen Street West, Toronto, ON M5V 1Z2" } },
  ],
};

describe("Batch 012 live baseline gate", () => {
  it("uses the live identity snapshot and retains suite-safe legacy comparison", () => {
    const snapshot = buildGtaProspectIdentitySnapshot([ledger], new Date("2026-09-09T12:00:00.000Z"));
    const report = reconcileGtaProspectBatch012(snapshot, [west], [{ origin: "legacy_source", recordId: "legacy-200", firmName: "Other", streetAddress: "Suite 200, 342 Queen Street West", city: "Toronto" }]);
    expect(report.reviews[0]).toMatchObject({ state: "review_required", automatic_merge: false, matches: expect.arrayContaining([expect.objectContaining({ origin: "ledger_projection", recordId: "ledger-1" }), expect.objectContaining({ origin: "legacy_source", recordId: "legacy-200", fields: ["street_address"] })]) });
    expect(report.reviews[1]).toEqual({ candidate_id: "B012-2", state: "clear", automatic_merge: false, matches: [] });
    expect(JSON.stringify(report)).not.toMatch(/email|contact|crm|outreach/i);
  });

  it("rejects unsupported lane schema and pre-approved research rows", () => {
    const snapshot = buildGtaProspectIdentitySnapshot([ledger], new Date("2026-09-09T12:00:00.000Z"));
    expect(() => reconcileGtaProspectBatch012(snapshot, [{ ...west, schema_version: "2.0" }], [])).toThrow("Unsupported");
    expect(() => reconcileGtaProspectBatch012(snapshot, [{ ...west, records: [{ ...west.records[0], accepted: true }] }], [])).toThrow("accepted or import-ready");
  });
});
