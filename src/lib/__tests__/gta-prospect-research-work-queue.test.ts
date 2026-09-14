import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  claimGtaProspectResearchWorkItems,
  deferGtaProspectResearchWorkItem,
  listGtaProspectResearchWorkQueue,
  renewGtaProspectResearchWorkItemLease,
  resolveGtaProspectResearchWorkItem,
  seedGtaProspectResearchWorkQueue,
  sha256GtaProspectResearchQueue,
  validateGtaProspectResearchWorkSeed,
} from "../gta-prospect-research-work-queue";

const seed = {
  sourceSystem: "legacy_gta_domain_discovery_v1",
  sourceSha256: "a".repeat(64),
  items: [{
    sourceRecordKey: "legacy-gta-directory-2026-07:domain-example-test",
    candidateName: "Example Law PC",
    canonicalDomain: "example.test",
    candidateAddress: "1 Example Street, Toronto, ON",
    sourceUrls: ["https://example.test/"],
    priority: 100,
    candidateSnapshot: { source: "fixture", legacyCount: 2 },
  }],
};

const item = {
  id: "00000000-0000-0000-0000-000000000001",
  source_system: seed.sourceSystem,
  source_record_key: seed.items[0].sourceRecordKey,
  candidate_name: seed.items[0].candidateName,
  canonical_domain: seed.items[0].canonicalDomain,
  candidate_address: seed.items[0].candidateAddress,
  source_urls: seed.items[0].sourceUrls,
  candidate_snapshot: seed.items[0].candidateSnapshot,
  priority: 100,
  state: "leased",
  lease_owner: "worker-a",
  lease_expires_at: "2026-09-14T13:00:00Z",
  attempt_count: 1,
  next_attempt_at: null,
  last_error: null,
  resolution: null,
  canonical_firm_id: null,
};

describe("GTA prospect research work queue", () => {
  it("accepts a deterministic source-preserving seed and hashes keys in a stable order", () => {
    const validated = validateGtaProspectResearchWorkSeed(seed);
    expect(validated.items[0].canonicalDomain).toBe("example.test");
    expect(sha256GtaProspectResearchQueue({ b: 2, a: 1 })).toBe(sha256GtaProspectResearchQueue({ a: 1, b: 2 }));
  });

  it("rejects unsafe input before any queue RPC", async () => {
    const rpc = vi.fn();
    await expect(seedGtaProspectResearchWorkQueue({ seed: { ...seed, items: [] }, client: { rpc } })).rejects.toThrow("1 to 2,000 items");
    expect(rpc).not.toHaveBeenCalled();
    expect(() => validateGtaProspectResearchWorkSeed({ ...seed, items: [{ ...seed.items[0], sourceRecordKey: seed.items[0].sourceRecordKey }, { ...seed.items[0] }] })).toThrow("duplicate sourceRecordKey");
  });

  it("uses the private seed RPC and treats an exact seed replay as a receipt", async () => {
    const rpc = vi.fn(async (name: string) => {
      expect(name).toBe("seed_gta_prospect_research_work_items");
      return { data: { state: "already_seeded", item_count: 1, inserted: 0, already_seeded: 1 }, error: null };
    });
    await expect(seedGtaProspectResearchWorkQueue({ seed, client: { rpc } })).resolves.toEqual({ state: "already_seeded", itemCount: 1, inserted: 0, alreadySeeded: 1 });
    expect(rpc).toHaveBeenCalledWith("seed_gta_prospect_research_work_items", expect.objectContaining({ p_source_system: seed.sourceSystem, p_payload_sha256: seed.sourceSha256 }));
  });

  it("claims bounded leased work through the service-only RPC", async () => {
    const rpc = vi.fn(async (name: string) => {
      expect(name).toBe("claim_gta_prospect_research_work_items");
      return { data: [item], error: null };
    });
    await expect(claimGtaProspectResearchWorkItems({ workerId: "worker-a", limit: 25, client: { rpc } })).resolves.toEqual([expect.objectContaining({ state: "leased", sourceRecordKey: seed.items[0].sourceRecordKey })]);
    expect(rpc).toHaveBeenCalledWith("claim_gta_prospect_research_work_items", expect.objectContaining({ p_limit: 25, p_lease_minutes: 120 }));
  });

  it("requires an owned lease to resolve or defer work", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    await resolveGtaProspectResearchWorkItem({ itemId: item.id, workerId: "worker-a", resolution: "insufficient_evidence", note: "First-party roster page has no current team roster.", client: { rpc } });
    await renewGtaProspectResearchWorkItemLease({ itemId: item.id, workerId: "worker-a", client: { rpc: async () => ({ data: "2026-09-14T15:00:00Z", error: null }) } });
    await deferGtaProspectResearchWorkItem({ itemId: item.id, workerId: "worker-a", error: "Transient origin timeout.", retryAt: "2026-09-14T14:00:00Z", client: { rpc } });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["resolve_gta_prospect_research_work_item", "defer_gta_prospect_research_work_item"]);
    await expect(resolveGtaProspectResearchWorkItem({ itemId: item.id, workerId: "worker-a", resolution: "imported", note: "Imported.", client: { rpc } })).rejects.toThrow("canonicalFirmId is required");
  });

  it("reads queue counts and never accepts a malformed state", async () => {
    const good = { counts: { pending: 1, leased: 0, retry: 0, resolved: 2 }, items: [{ ...item, candidate_snapshot: undefined, state: "pending", lease_owner: null, lease_expires_at: null, attempt_count: 0 }] };
    await expect(listGtaProspectResearchWorkQueue({ client: { rpc: async () => ({ data: good, error: null }) } })).resolves.toEqual(expect.objectContaining({ counts: good.counts }));
    const bad = { ...good, items: [{ ...good.items[0], state: "oops" }] };
    await expect(listGtaProspectResearchWorkQueue({ client: { rpc: async () => ({ data: bad, error: null }) } })).rejects.toThrow("invalid state");
  });
});
