import { describe, expect, it } from "vitest";
import { buildFromRepository } from "../../../scripts/generate-gta-prospect-research-dry-run-manifest";

describe("GTA prospect research dry-run manifest", () => {
  it("selects exactly the independently accepted records from batches 001 through 009", async () => {
    const manifest = await buildFromRepository();

    expect(manifest.importPlan.acceptedRecordCount).toBe(103);
    expect(manifest.importPlan.rejectedRecordCount).toBe(0);
    expect(manifest.importRecords).toHaveLength(103);
    expect(manifest.provenance).toHaveLength(103);
    expect(manifest.exclusions).toHaveLength(92);
    expect(manifest.sourceBatches.map(batch => batch.acceptedForStagingCount)).toEqual([9, 6, 22, 8, 11, 16, 12, 15, 4]);
  });

  it("keeps held, rejected, and candidate-only records out of the importer-shaped data", async () => {
    const manifest = await buildFromRepository();
    const keys = new Set(manifest.importRecords.map(record => record.sourceRecordKey));

    expect(keys.has("gta-prospect-001-ap-lawyers-mississauga")).toBe(false);
    expect(keys.has("gta-prospect-003-b003-10")).toBe(false);
    expect(keys.has("gta-prospect-009-b009-05")).toBe(false);
    expect(manifest.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ batchId: "001", batchSourceRecordId: "ap-lawyers-mississauga", qaDisposition: "needs_count_review" }),
      expect.objectContaining({ batchId: "009", batchSourceRecordId: "B009-05", qaDisposition: "needs_count_review" }),
    ]));
  });

  it("retains the roster source, observation date, qualification, QA provenance, and legacy unknown state", async () => {
    const manifest = await buildFromRepository();
    const record = manifest.importRecords.find(candidate => candidate.sourceRecordKey === "gta-prospect-003-b003-01");
    const provenance = manifest.provenance.find(candidate => candidate.sourceRecordKey === "gta-prospect-003-b003-01");

    expect(record).toMatchObject({
      roster: { sourceUrl: "https://cohenlaw.ca/expertise/lawyers/", observedOn: "2026-09-07", lawyerCount: 4, qualifier: "exact" },
      legacyCrosswalk: null,
      legacyClusterLawyerCount: null,
    });
    expect(provenance).toMatchObject({
      batchId: "003",
      batchSourceRecordId: "B003-01",
      qaDisposition: "accepted_for_staging",
      legacyReconciliation: "unknown_no_stable_crosswalk",
    });
  });

  it("is deterministic and has no database, import, CRM, contact, deployment, or merge side effect", async () => {
    const first = await buildFromRepository();
    const second = await buildFromRepository();

    expect(second).toEqual(first);
    expect(first.actionsNotPerformed).toEqual(expect.arrayContaining([
      "database connection",
      "migration application",
      "data import",
      "CRM activity",
      "contact or outreach",
      "deployment",
      "merge",
    ]));
  });
});
