import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GtaProspectLedgerUnavailableError,
  listGtaProspectResearchForOperator,
  type GtaProspectResearchReaderClient,
} from "../gta-prospect-research-reader";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "example-family-law",
    firm_name: "Example Family Law",
    city: "Toronto",
    office_cities: ["Toronto"],
    website_url: "https://example.test",
    practice_areas: [],
    observed_lawyer_count: 3,
    observed_lawyer_count_qualifier: "exact",
    observed_lawyer_count_display: null,
    roster_source_url: "https://example.test/team",
    roster_checked_at: "2026-09-07",
    reconciliation_status: "provisional_new",
    legacy_cluster_lawyer_count: null,
    legacy_crosswalk: null,
    reconciliation_note: "Reviewed against the legacy source.",
    advertising_evidence: "unknown",
    advertising_source_url: null,
    gbp_evidence: "observed",
    gbp_source_url: "https://www.google.com/maps",
    ...overrides,
  };
}

function client(data: unknown, error: { code?: string; message?: string } | null = null): GtaProspectResearchReaderClient {
  return { rpc: vi.fn(async () => ({ data, error })) };
}

describe("GTA prospect research reader", () => {
  it("maps only the typed, public research projection to the console contract", async () => {
    const db = client([row()]);
    await expect(listGtaProspectResearchForOperator(db)).resolves.toEqual([
      expect.objectContaining({
        id: "example-family-law",
        firmName: "Example Family Law",
        officeCities: ["Toronto"],
        practiceAreas: [],
        gbpEvidence: "observed",
      }),
    ]);
    expect(db.rpc).toHaveBeenCalledWith("list_gta_prospect_research_for_operator");
  });

  it("identifies only an absent projection RPC as the pre-migration fallback state", async () => {
    await expect(listGtaProspectResearchForOperator(client(null, {
      code: "PGRST202",
      message: "Could not find the function public.list_gta_prospect_research_for_operator without parameters in the schema cache",
    }))).rejects.toBeInstanceOf(GtaProspectLedgerUnavailableError);
  });

  it("fails closed on malformed data, duplicate stable keys, and authorization failures", async () => {
    await expect(listGtaProspectResearchForOperator(client([row({ roster_source_url: "not-a-url" })]))).rejects.toThrow("Invalid GTA prospect research projection");
    await expect(listGtaProspectResearchForOperator(client([row(), row()]))).rejects.toThrow("duplicate source record keys");
    await expect(listGtaProspectResearchForOperator(client(null, { code: "42501", message: "permission denied for function list_gta_prospect_research_for_operator" }))).rejects.toThrow("Could not read the GTA prospect research ledger");
  });
});
