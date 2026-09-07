import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECONCILED_GTA_PROSPECTS } from "../../reconciled-prospects";

const h = vi.hoisted(() => {
  class Unavailable extends Error {}
  const state = {
    session: null as { role: "operator" } | null,
    records: [] as unknown[],
    failure: null as Error | null,
  };
  return {
    state,
    read: vi.fn(async () => {
      if (state.failure) throw state.failure;
      return state.records;
    }),
    Unavailable,
  };
});

vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: () => Promise.resolve(h.state.session) }));
vi.mock("@/lib/gta-prospect-research-reader", () => ({
  GtaProspectLedgerUnavailableError: h.Unavailable,
  listGtaProspectResearchForOperator: h.read,
}));

import { GET } from "../route";

beforeEach(() => {
  h.state.session = null;
  h.state.records = [];
  h.state.failure = null;
  h.read.mockClear();
});

describe("reviewed GTA prospects route", () => {
  it("keeps the operator gate ahead of every ledger read", async () => {
    const response = await GET();
    expect(response.status).toBe(401);
    expect(h.read).not.toHaveBeenCalled();
  });

  it("returns the source-controlled fixture when the projection migration is unavailable", async () => {
    h.state.session = { role: "operator" };
    h.state.failure = new h.Unavailable();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      records: RECONCILED_GTA_PROSPECTS,
      source: "fixture",
      fallbackReason: "ledger_unavailable",
    });
  });

  it("does not cut over or mix sources when the authorized fixture seed is incomplete", async () => {
    h.state.session = { role: "operator" };
    h.state.records = RECONCILED_GTA_PROSPECTS.slice(0, -1);
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.source).toBe("fixture");
    expect(body.fallbackReason).toBe("fixture_seed_incomplete");
    expect(body.records).toEqual(RECONCILED_GTA_PROSPECTS);
  });

  it("uses only the ledger after the complete fixture seed is present", async () => {
    h.state.session = { role: "operator" };
    h.state.records = [...RECONCILED_GTA_PROSPECTS, { ...RECONCILED_GTA_PROSPECTS[0], id: "later-reviewed-firm", firmName: "Later reviewed firm" }];
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.source).toBe("ledger");
    expect(body.fallbackReason).toBeUndefined();
    expect(body.records).toEqual(h.state.records);
    expect(body.records.filter((record: { id: string }) => record.id === RECONCILED_GTA_PROSPECTS[0].id)).toHaveLength(1);
  });

  it("returns a visible server error for a real ledger failure rather than concealing it as fallback", async () => {
    h.state.session = { role: "operator" };
    h.state.failure = new Error("permission denied");
    const response = await GET();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "GTA prospect research records could not be loaded." });
  });
});
