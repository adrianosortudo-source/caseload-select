import { describe, expect, it } from "vitest";

import { GTA_PROSPECT_IMPORT_ACCEPTANCE_CASES } from "../__fixtures__/gta-prospect-import-acceptance";
import { normalizeProspectStreetAddress } from "../gta-prospect-baseline-reconciliation";
import { buildGtaProspectImportPlan } from "../gta-prospect-research-import";

describe("GTA operator import acceptance fixtures", () => {
  it("keeps a durable case for each protected import disposition", () => {
    expect(GTA_PROSPECT_IMPORT_ACCEPTANCE_CASES.map((item) => item.expectedDisposition)).toEqual([
      "new",
      "unchanged",
      "update",
      "update",
      "review_required",
      "new",
      "new",
      "invalid",
    ]);
  });

  it("keeps optional source blanks distinct from a deletion instruction", async () => {
    const fixture = GTA_PROSPECT_IMPORT_ACCEPTANCE_CASES.find((item) => item.id === "blank-optional-fields-do-not-erase-prior-observations");
    expect(fixture?.incoming.websiteUrl).toBeNull();
    expect(fixture?.existing?.websiteUrl).toBe("https://prior-site.test");
    expect(fixture?.expectedPreservedFields).toEqual(["websiteUrl", "publicContacts"]);
    await expect(buildGtaProspectImportPlan([fixture?.incoming])).resolves.toMatchObject({ rejected: [] });
  });

  it("keeps the must-not-merge suite fixture as different normalized addresses", () => {
    const fixture = GTA_PROSPECT_IMPORT_ACCEPTANCE_CASES.find((item) => item.id === "suite-variants-are-never-merged-by-the-importer");
    expect(normalizeProspectStreetAddress(fixture?.candidateAddress)).toBe("unit=200;street=342 queen street west");
    expect(normalizeProspectStreetAddress(fixture?.existingAddress)).toBe("unit=100;street=342 queen street west");
  });

  it("requires source-backed public-contact provenance and rejects the intentionally invalid row", async () => {
    const contact = GTA_PROSPECT_IMPORT_ACCEPTANCE_CASES.find((item) => item.id === "public-owner-email-retains-source-provenance-only");
    const invalid = GTA_PROSPECT_IMPORT_ACCEPTANCE_CASES.find((item) => item.id === "invalid-record-is-never-staged-or-applied");
    const contactPlan = await buildGtaProspectImportPlan([contact?.incoming]);
    const invalidPlan = await buildGtaProspectImportPlan([invalid?.incoming]);
    expect(contactPlan.accepted[0]?.publicContacts[0]).toMatchObject({
      relationship: "founder",
      emailKind: "owner",
      sourceUrl: "https://example-advocacy.test/team",
      observedAt: "2026-09-11",
    });
    expect(invalidPlan.rejected[0]?.issues.map((issue) => issue.message)).toContain("accepted records require a roster source URL");
  });
});

