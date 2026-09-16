import { describe, expect, it } from "vitest";

import { getGtaProspectAgentDraftRecordReview } from "../gta-prospect-agent-draft-inbox";

const draftId = "11111111-1111-4111-8111-111111111111";
const sourceRecordKey = "gta-prospect-review-001";

const stored = {
  draftId,
  sourceName: "test-source",
  payloadSha256: "a".repeat(64),
  reviewSha256: "b".repeat(64),
  importSourceSha256: "c".repeat(64),
  recordCount: 1,
  state: "ready_for_operator",
  records: [{
    id: sourceRecordKey, recordOrigin: "agent", firmName: "Review Firm", city: "Toronto", officeCities: ["Toronto"],
    websiteUrl: "https://review.example/", practiceAreas: ["Family law"], observedLawyerCount: 3,
    observedLawyerCountQualifier: "exact", observedLawyerCountDisplay: "3 lawyers", rosterSourceUrl: "https://review.example/team",
    rosterCheckedAt: "2026-09-15", reconciliationStatus: "provisional_new", legacyClusterLawyerCount: null, legacyCrosswalk: null,
    reconciliationNote: null, advertisingEvidence: "unknown", advertisingSourceUrl: null, gbpEvidence: "unknown", gbpSourceUrl: null,
    publicContacts: [{ name: "A. Owner", relationship: "owner", email: "owner@review.example", emailKind: "owner", sourceUrl: "https://review.example/team", observedAt: "2026-09-15" }],
  }],
  reviewRecords: [{ sourceRecordKey, disposition: "new", reason: "No matching stable source record key exists." }],
  reviewSummary: { received: 1, eligibleForApply: 1, new: 1, update: 0, duplicate: 0, reviewRequired: 0, invalid: 0 },
};

describe("staged AI record review projection", () => {
  it("returns only bounded public evidence and never raw package fields", async () => {
    const client = { rpc: async () => ({ data: stored, error: null }) };
    const result = await getGtaProspectAgentDraftRecordReview({ draftId, sourceRecordKey, client });
    expect(result).toMatchObject({ draftId, sourceRecordKey, firmName: "Review Firm", reviewSha256: "b".repeat(64), disposition: "new" });
    expect(result?.publicContacts).toEqual([expect.objectContaining({ name: "A. Owner", email: "owner@review.example", relationship: "owner", emailKind: "owner" })]);
    expect(result).not.toHaveProperty("records");
    expect(JSON.stringify(result)).not.toContain("payloadSha256");
  });
});
