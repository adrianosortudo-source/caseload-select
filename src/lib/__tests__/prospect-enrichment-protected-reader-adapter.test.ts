import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { rpc: state.rpc, from: state.from } }));

import { getProspectEnrichmentFirmHistory } from "@/lib/prospect-enrichment-reader";

const firmId = "00000000-0000-4000-8000-000000000001";

describe("protected prospect research reader adapter", () => {
  beforeEach(() => {
    state.rpc.mockReset().mockImplementation(async (_name: string, args: Record<string, unknown>) => ({
      data: args.p_table === "gta_prospect_firms"
        ? [{ id: firmId, display_name: "Fixture Firm", source_record_key: "fixture-firm-001", website_url: null, enrichment_revision: 4 }]
        : [],
      error: null,
    }));
    state.from.mockReset().mockImplementation((table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        gt: () => query,
        order: () => query,
        limit: async () => ({ data: [], error: null }),
      };
      return query;
    });
  });

  it("routes protected GTA history and firm reads through fixed RPC arguments", async () => {
    await getProspectEnrichmentFirmHistory({ firmId, table: "gta_prospect_aliases" });
    expect(state.rpc).toHaveBeenCalledWith("read_prospect_enrichment_gta_evidence_v1", expect.objectContaining({
      p_firm_id: firmId, p_table: "gta_prospect_firms", p_limit: 1,
    }));
    expect(state.rpc).toHaveBeenCalledWith("read_prospect_enrichment_gta_evidence_v1", expect.objectContaining({
      p_firm_id: firmId, p_table: "gta_prospect_aliases", p_limit: 26,
    }));
    expect(state.rpc.mock.calls.every(([, args]) => !Object.hasOwn(args, "p_columns"))).toBe(true);
    expect(state.from.mock.calls.map(([table]) => table)).not.toContain("gta_prospect_aliases");
  });
});
