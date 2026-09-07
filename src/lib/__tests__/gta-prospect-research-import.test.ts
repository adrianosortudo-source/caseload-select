import { describe, expect, it, vi } from "vitest";
import { RECONCILED_GTA_PROSPECTS } from "@/app/admin/prospects/reconciled-prospects";
import {
  buildGtaProspectImportPlan,
  executeGtaProspectImport,
  type GtaProspectResearchRecord,
} from "../gta-prospect-research-import";

function candidate(id: string): GtaProspectResearchRecord {
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
    expect(plan.rejected[0]?.issues[0]?.message).toContain("contact, outreach, or CRM fields are not allowed");
  });

  it("does not merge different source identities merely because names and domains collide", async () => {
    const first = candidate("same-name-a");
    const second = { ...candidate("same-name-b"), officeCities: ["Mississauga"] };
    const plan = await buildGtaProspectImportPlan([first, second]);
    expect(plan.accepted.map((record) => record.id)).toEqual(["same-name-a", "same-name-b"]);
    expect(plan.rejected).toEqual([]);
  });

  it("rejects a concurrent source-key collision instead of selecting a fuzzy merge target", async () => {
    const record = candidate("stable-source-key");
    const plan = await buildGtaProspectImportPlan([record, { ...record, firmName: "Renamed Example Family Law" }]);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected[0]?.issues.map((issue) => issue.message)).toContain("duplicate source record key within batch");
  });

  it("keeps same-street offices with different or missing suites distinct", async () => {
    const record = {
      ...candidate("suite-guard"),
      officeObservations: [
        { city: "Toronto", addressRaw: "100 King St W, Suite 200", streetNormalized: "100 king st w", suiteRaw: "200", sourceUrl: "https://example.test/contact", observedOn: "2026-09-06" },
        { city: "Toronto", addressRaw: "100 King St W", streetNormalized: "100 king st w", suiteRaw: null, sourceUrl: "https://example.test/contact", observedOn: "2026-09-06" },
      ],
    };
    const plan = await buildGtaProspectImportPlan([record]);
    expect(plan.accepted[0]?.officeObservations).toHaveLength(2);
    expect(plan.rejected).toEqual([]);
  });

  it("makes dry runs and unauthenticated requests no-write paths", async () => {
    const plan = await buildGtaProspectImportPlan([candidate("no-write")]);
    const writer = { apply: vi.fn(async () => undefined) };
    await expect(executeGtaProspectImport({ plan, dryRun: true, operatorAuthorized: true, writer })).resolves.toMatchObject({ state: "dry_run" });
    await expect(executeGtaProspectImport({ plan, dryRun: false, operatorAuthorized: false, writer })).resolves.toMatchObject({ state: "unauthorized" });
    expect(writer.apply).not.toHaveBeenCalled();
  });
});
