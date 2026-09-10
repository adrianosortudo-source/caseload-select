import { describe, expect, it } from "vitest";

import { buildGtaProspectIdentitySnapshot, GTA_PROSPECT_SAFE_SLUG_PATTERN } from "../gta-prospect-identity-snapshot";
import { reconcileGtaProspectBatch012 } from "../gta-prospect-live-baseline-gate";
import type { ReconciledGtaProspect } from "../gta-prospect-records";

const ledger: ReconciledGtaProspect = {
  id: "ledger-1", firmName: "Live Existing Law", city: "Toronto", officeCities: ["Toronto"], websiteUrl: "https://existing.test",
  practiceAreas: [], observedLawyerCount: 4, observedLawyerCountQualifier: "exact", observedLawyerCountDisplay: null,
  rosterSourceUrl: "https://existing.test/team", rosterCheckedAt: "2026-09-09", reconciliationStatus: "provisional_new",
  legacyClusterLawyerCount: null, legacyCrosswalk: null, reconciliationNote: null, advertisingEvidence: "unknown", advertisingSourceUrl: null, gbpEvidence: "unknown", gbpSourceUrl: null,
};

const west = {
  schema_version: "2.0", batch_id: "gta-prospect-batch-012", lane: "west-north", records: [
    { record_id: "B012-WN-01", firm_name: "Live Existing Law", canonical_domain: "existing.test", accepted: false, import_ready: false, office_addresses: [{ city: "Toronto", published_address: "200-342 Queen St W, Toronto, ON M5V 1Z2" }], public_emails: [{ email: "owner-secret@example.test" }], crm: "CRM_SECRET", outreach: "SEND_NOW" },
    { record_id: "B012-WN-02", firm_name: "Different Law", canonical_domain: "different.test", accepted: false, import_ready: false, office_addresses: [{ city: "Toronto", published_address: "100-342 Queen Street West, Toronto, ON M5V 1Z2" }] },
  ],
};

const east = {
  schema_version: "2.0", batch_id: "gta-prospect-batch-012", lane: "east-outer", records: [
    { record_id: "B012-EAST-01", firm_name: "East Law", canonical_domain: "east.test", accepted: false, import_ready: false, office_addresses: [{ city: "Hamilton", published_address: "Suite 200, 10 King St W, Hamilton, ON L8P 1A1" }], public_emails: [{ email: "east-secret@example.test" }] },
  ],
};

function snapshot() {
  return buildGtaProspectIdentitySnapshot([ledger], new Date("2026-09-09T12:00:00.000Z"));
}

describe("Batch 012 live baseline gate", () => {
  it("adapts west records, preserves suite identity, and emits only safe allowlisted output", () => {
    const report = reconcileGtaProspectBatch012(snapshot(), [west], [{ origin: "legacy_source", recordId: "legacy:row-200<script>", firmName: "Other", streetAddress: "Suite 200, 342 Queen Street West", city: "Toronto" }]);
    expect(report.reviews[0]).toMatchObject({ candidate_id: "b012-wn-01", state: "review_required", automatic_merge: false, matches: expect.arrayContaining([expect.objectContaining({ origin: "ledger_projection", recordId: "ledger-1" }), expect.objectContaining({ origin: "legacy_source", fields: ["street_address"] })]) });
    expect(report.reviews[1]).toEqual({ candidate_id: "b012-wn-02", state: "clear", automatic_merge: false, matches: [] });
    expect(report.reviews.flatMap((review) => [review.candidate_id, ...review.matches.map((match) => match.recordId)]).every((id) => GTA_PROSPECT_SAFE_SLUG_PATTERN.test(id))).toBe(true);
    const stdout = JSON.stringify(report);
    expect(stdout).not.toMatch(/email|contact|crm|outreach|owner-secret@example\.test|CRM_SECRET|SEND_NOW/i);
    expect(stdout).not.toContain("legacy:row-200<script>");
  });

  it("adapts east records and allows deliberately empty address evidence", () => {
    const baseline = [{ origin: "legacy_source" as const, recordId: "legacy-east", firmName: "Other", streetAddress: "200-10 King Street West", city: "Hamilton" }];
    expect(reconcileGtaProspectBatch012(snapshot(), [east], baseline).reviews[0]).toMatchObject({ candidate_id: "b012-east-01", state: "review_required" });
    const empty = { ...east, records: [{ ...east.records[0], office_addresses: [] }] };
    expect(reconcileGtaProspectBatch012(snapshot(), [empty], []).reviews[0]).toMatchObject({ candidate_id: "b012-east-01", state: "clear" });
  });

  it("parses multiple west office cities independently", () => {
    const document = { ...west, records: [{ ...west.records[0], record_id: "B012-WN-H01", firm_name: "Multi Law", canonical_domain: "multi.test", office_addresses: [{ city: "Vaughan", published_address: "204-3100 Rutherford Road, Vaughan, ON L4K 5R1" }, { city: "Bolton", published_address: "34 Queen Street South, Bolton, ON L7E 1A1" }] }] };
    const baseline = [{ origin: "legacy_source" as const, recordId: "vaughan", firmName: "Other", streetAddress: "Suite 204, 3100 Rutherford Rd", city: "Vaughan" }, { origin: "legacy_source" as const, recordId: "bolton", firmName: "Other", streetAddress: "34 Queen St S", city: "Bolton" }];
    expect(reconcileGtaProspectBatch012(snapshot(), [document], baseline).reviews[0].matches).toHaveLength(2);
  });

  it("fails closed on schema, state, id, and malformed east evidence", () => {
    expect(() => reconcileGtaProspectBatch012(snapshot(), [{ ...west, schema_version: "3.0" }], [])).toThrow("Unsupported");
    expect(() => reconcileGtaProspectBatch012(snapshot(), [{ ...west, records: [{ ...west.records[0], accepted: true }] }], [])).toThrow("accepted or import-ready");
    expect(() => reconcileGtaProspectBatch012(snapshot(), [{ ...west, records: [{ ...west.records[0], import_ready: true }] }], [])).toThrow("accepted or import-ready");
    expect(() => reconcileGtaProspectBatch012(snapshot(), [{ ...west, records: [{ ...west.records[0], record_id: "B012-WN-01\nINJECT" }] }], [])).toThrow("bounded grammar");
    expect(() => reconcileGtaProspectBatch012(snapshot(), [{ ...east, records: [{ ...east.records[0], office_addresses: null }] }], [])).toThrow("address evidence");
    expect(() => reconcileGtaProspectBatch012(snapshot(), [{ ...east, records: [{ ...east.records[0], office_addresses: [{ city: "Hamilton", published_address: "not an address" }] }] }], [])).toThrow("malformed");
  });

  it("rejects duplicate candidate ids", () => {
    expect(() => reconcileGtaProspectBatch012(snapshot(), [west, west], [])).toThrow("Duplicate");
  });
});
