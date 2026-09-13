import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GtaProspectStableIdentityRegistryUnavailableError,
  listGtaProspectStableIdentitiesForOperator,
} from "@/lib/gta-prospect-stable-identity-reader";

const row = {
  source_record_key: "gta-prospect-002-b002-11",
  stable_firm_id: "FIRM-1C2XS2MW3NTR644JE1T3XVHFX2",
  canonical_domain: "example.test",
  source_url: "https://example.test/about",
  observed_on: "2026-09-13",
  confidence: "high",
};

describe("GTA prospect stable-identity reader", () => {
  it("returns only authoritative, source-linked identities", async () => {
    await expect(listGtaProspectStableIdentitiesForOperator({ rpc: async () => ({ data: [row], error: null }) })).resolves.toEqual([{
      sourceRecordKey: "gta-prospect-002-b002-11",
      firmId: "FIRM-1C2XS2MW3NTR644JE1T3XVHFX2",
      canonicalDomain: "example.test",
      sourceUrl: "https://example.test/about",
      observedOn: "2026-09-13",
      confidence: "high",
    }]);
  });

  it("treats a missing registry projection as unavailable rather than linked", async () => {
    await expect(listGtaProspectStableIdentitiesForOperator({ rpc: async () => ({ data: null, error: { code: "PGRST202", message: "missing" } }) }))
      .rejects.toBeInstanceOf(GtaProspectStableIdentityRegistryUnavailableError);
  });

  it("rejects duplicate portable identity allocation in the projection", async () => {
    await expect(listGtaProspectStableIdentitiesForOperator({ rpc: async () => ({ data: [row, { ...row, source_record_key: "gta-prospect-003-b003-05" }], error: null }) }))
      .rejects.toThrow("duplicate stable firm IDs");
  });
});
