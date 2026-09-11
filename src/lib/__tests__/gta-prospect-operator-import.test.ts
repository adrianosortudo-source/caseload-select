import { describe, expect, it, vi } from "vitest";

// The writer is deliberately server-only in the application. Vitest runs
// outside Next's server compiler, so make that boundary inert for this pure
// RPC contract.
vi.mock("server-only", () => ({}));

import { applyGtaProspectOperatorImport, defaultGtaProspectImportSourceName } from "../gta-prospect-operator-import";
import { buildGtaProspectImportPlan } from "../gta-prospect-research-import";

const record = {
  id: "operator-import-example",
  firmName: "Operator Import Example LLP",
  city: "Toronto",
  officeCities: ["Toronto"],
  websiteUrl: "https://example.test",
  practiceAreas: ["Family law"],
  observedLawyerCount: 3,
  observedLawyerCountQualifier: "exact",
  observedLawyerCountDisplay: "3 lawyers",
  rosterSourceUrl: "https://example.test/team",
  rosterCheckedAt: "2026-09-11",
  reconciliationStatus: "provisional_new",
  legacyClusterLawyerCount: null,
  legacyCrosswalk: null,
  reconciliationNote: "Fresh reviewed roster observation.",
  advertisingEvidence: "unknown",
  advertisingSourceUrl: null,
  gbpEvidence: "unknown",
  gbpSourceUrl: null,
  publicContacts: [],
};

describe("GTA prospect operator import writer", () => {
  it("uses a service-only batch receipt and completes a reviewed batch", async () => {
    const plan = await buildGtaProspectImportPlan([record]);
    const rpc = vi.fn(async (name: string) => {
      if (name === "begin_gta_prospect_operator_import_batch") return { data: { state: "ready", batch_id: "00000000-0000-0000-0000-000000000001" }, error: null };
      if (name === "gta_prospect_research_record_with_contacts_sha256") return { data: "a".repeat(64), error: null };
      if (name === "apply_gta_prospect_research_record_with_contacts") return { data: { state: "created", firm_id: "00000000-0000-0000-0000-000000000002", public_contacts: 0 }, error: null };
      if (name === "complete_gta_prospect_import_batch") return { data: null, error: null };
      return { data: null, error: { message: `Unexpected RPC ${name}` } };
    });
    await expect(applyGtaProspectOperatorImport({ sourceName: "gta-operator-upload", plan, client: { rpc } })).resolves.toEqual(expect.objectContaining({
      state: "applied",
      receipts: [expect.objectContaining({ sourceRecordKey: record.id, state: "created" })],
    }));
    expect(rpc).toHaveBeenCalledWith("complete_gta_prospect_import_batch", expect.any(Object));
  });

  it("treats an exact completed batch replay as a no-write receipt", async () => {
    const plan = await buildGtaProspectImportPlan([record]);
    const rpc = vi.fn(async () => ({ data: { state: "already_applied", batch_id: "00000000-0000-0000-0000-000000000001" }, error: null }));
    const result = await applyGtaProspectOperatorImport({ sourceName: "gta-operator-upload", plan, client: { rpc } });
    expect(result.state).toBe("already_applied");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("normalizes only safe deterministic batch names", () => {
    expect(defaultGtaProspectImportSourceName(" GTA-September-2026 ")).toBe("gta-september-2026");
    expect(defaultGtaProspectImportSourceName("contains spaces")).toBeNull();
  });
});
