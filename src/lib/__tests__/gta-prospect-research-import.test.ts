import { describe, expect, it, vi } from "vitest";
import { RECONCILED_GTA_PROSPECTS } from "@/app/admin/prospects/reconciled-prospects";
import {
  buildGtaProspectImportPlan,
  executeGtaProspectImport,
  reviewGtaProspectImport,
} from "../gta-prospect-research-import";

function candidate(id: string) {
  return {
    id,
    firmName: "Example Family Law",
    city: "Toronto",
    officeCities: ["Toronto"],
    websiteUrl: "https://example.test",
    practiceAreas: ["Family law"],
    observedLawyerCount: 2,
    observedLawyerCountQualifier: "exact",
    observedLawyerCountDisplay: null,
    rosterSourceUrl: "https://example.test/team",
    rosterCheckedAt: "2026-09-06",
    reconciliationStatus: "provisional_new",
    legacyClusterLawyerCount: null,
    legacyCrosswalk: null,
    reconciliationNote: null,
    advertisingEvidence: "unknown",
    advertisingSourceUrl: null,
    gbpEvidence: "unknown",
    gbpSourceUrl: null,
  };
}

describe("GTA prospect research importer", () => {
  it("validates the reviewed 20-record console batch without changing its source artifact", async () => {
    const plan = await buildGtaProspectImportPlan(RECONCILED_GTA_PROSPECTS);
    expect(plan.accepted).toHaveLength(20);
    expect(plan.rejected).toEqual([]);
    expect(plan.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("requires roster provenance, an observation date, and an explicit count qualifier", async () => {
    const record = candidate("missing-provenance");
    const plan = await buildGtaProspectImportPlan([{ ...record, rosterSourceUrl: null, rosterCheckedAt: "not-a-date", observedLawyerCountQualifier: "unknown", observedLawyerCount: 2 }]);
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected[0]?.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      "accepted records require a roster source URL",
      "accepted records require a roster observation date",
      "unknown count qualifier requires a null observed lawyer count",
    ]));
  });

  it("refuses contact, outreach, and CRM-shaped source fields", async () => {
    const plan = await buildGtaProspectImportPlan([{ ...candidate("forbidden-contact"), email: "person@example.test", outreach_status: "queued" }]);
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected[0]?.issues[0]?.message).toContain("unrecognized fields are forbidden");
  });

  it("rejects objects in nullable scalar fields and invalid calendar dates", async () => {
    const plan = await buildGtaProspectImportPlan([{ ...candidate("strict-shape"), observedLawyerCountDisplay: { text: "two" }, reconciliationNote: ["bad"], rosterCheckedAt: "2026-02-30" }]);
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected[0]?.issues.map(issue => issue.message)).toEqual(expect.arrayContaining(["observedLawyerCountDisplay must be a nullable string", "reconciliationNote must be a nullable string", "accepted records require a roster observation date"]));
  });

  it("preserves supported stable source fields in the canonical projection", async () => {
    const plan = await buildGtaProspectImportPlan([candidate("preserved-fields")]);
    expect(plan.accepted[0]).toMatchObject({ sourceRecordKey: "preserved-fields", city: "Toronto", practiceAreas: ["Family law"], legacyClusterLawyerCount: null, legacyCrosswalk: null });
  });

  it("accepts source-backed public owner and email observations without adding outreach state", async () => {
    const plan = await buildGtaProspectImportPlan([{
      ...candidate("public-owner"),
      publicContacts: [{ name: "Avery Founder", relationship: "founder", email: "avery@example.test", emailKind: "owner", sourceUrl: "https://example.test/team", observedAt: "2026-09-07" }],
    }]);
    expect(plan.rejected).toEqual([]);
    expect(plan.accepted[0]?.publicContacts).toEqual([expect.objectContaining({ name: "Avery Founder", relationship: "founder", email: "avery@example.test" })]);
  });

  it("does not merge different source identities merely because names and domains collide", async () => {
    const first = candidate("same-name-a");
    const second = { ...candidate("same-name-b"), officeCities: ["Mississauga"] };
    const plan = await buildGtaProspectImportPlan([first, second]);
    expect(plan.accepted.map((record) => record.sourceRecordKey)).toEqual(["same-name-a", "same-name-b"]);
    expect(plan.rejected).toEqual([]);
  });

  it("rejects a concurrent source-key collision instead of selecting a fuzzy merge target", async () => {
    const record = candidate("stable-source-key");
    const plan = await buildGtaProspectImportPlan([record, { ...record, firmName: "Renamed Example Family Law" }]);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected[0]?.issues.map((issue) => issue.message)).toContain("duplicate source record key within batch");
  });

  it("rejects unknown nested-shaped import data rather than retaining raw fields", async () => {
    const plan = await buildGtaProspectImportPlan([{ ...candidate("raw-reject"), officeObservations: [{ city: "Toronto", email: "no@example.test" }] }]);
    expect(plan.accepted).toEqual([]);
    expect(plan.rejected[0]?.issues[0]?.message).toContain("unrecognized fields are forbidden");
  });

  it("makes dry runs and unauthenticated requests no-write paths", async () => {
    const plan = await buildGtaProspectImportPlan([candidate("no-write")]);
    const writer = { apply: vi.fn(async () => undefined) };
    await expect(executeGtaProspectImport({ plan, dryRun: true, operatorAuthorized: true, writer })).resolves.toMatchObject({ state: "dry_run" });
    await expect(executeGtaProspectImport({ plan, dryRun: false, operatorAuthorized: false, writer })).resolves.toMatchObject({ state: "unauthorized" });
    expect(writer.apply).not.toHaveBeenCalled();
  });

  it("classifies only stable source keys as updates and blocks unresolved identity decisions", async () => {
    const result = await reviewGtaProspectImport([
      candidate("known-source"),
      { ...candidate("identity-hold"), reconciliationStatus: "new_pending_identity" },
      { ...candidate("known-source"), firmName: "Duplicate source key" },
    ], new Set(["known-source"]));
    expect(result.summary).toMatchObject({ received: 3, update: 1, duplicate: 1, reviewRequired: 1, eligibleForApply: 1 });
    expect(result.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRecordKey: "known-source", disposition: "update" }),
      expect.objectContaining({ sourceRecordKey: "identity-hold", disposition: "review_required" }),
    ]));
  });
});
