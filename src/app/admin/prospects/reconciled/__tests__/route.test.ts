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
      source: "fixture",
      sourceCounts: { ledger: 0, fixture: 20 },
      qualifiedImport: { inputCount: 20, added: 20, updated: 0, ambiguous: 0 },
      fallbackReason: "ledger_unavailable",
    });
  });

  it("uses the fixture-only fallback when the ledger has no records", async () => {
    h.state.session = { role: "operator" };
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.source).toBe("fixture");
    expect(body.sourceCounts).toEqual({ ledger: 0, fixture: 20 });
    expect(body.fallbackReason).toBe("ledger_empty");
    expect(body.records).toHaveLength(5_942);
    expect(body.qualifiedImport).toMatchObject({ inputCount: 20, added: 20, updated: 0, ambiguous: 0 });
    expect(body.records.filter((record: { qualifiedDossier?: unknown }) => record.qualifiedDossier)).toHaveLength(20);
  });

  it("shows nonempty ledger records alongside only the missing fixtures", async () => {
    h.state.session = { role: "operator" };
    const ledgerOverride = { ...RECONCILED_GTA_PROSPECTS[0], firmName: "Aastha Lawyers from ledger" };
    const ledgerAddition = { ...RECONCILED_GTA_PROSPECTS[0], id: "later-reviewed-firm", firmName: "Later reviewed firm" };
    h.state.records = [ledgerAddition, ledgerOverride];
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.source).toBe("hybrid");
    expect(body.sourceCounts).toEqual({ ledger: 2, fixture: 19 });
    expect(body.fallbackReason).toBeUndefined();
    expect(body.records).toHaveLength(5_943);
    expect(body.qualifiedImport).toMatchObject({ added: 20, updated: 0, ambiguous: 0 });
    expect(body.records.filter((record: { id: string }) => record.id === RECONCILED_GTA_PROSPECTS[0].id)).toHaveLength(1);
    expect(body.records.find((record: { id: string }) => record.id === RECONCILED_GTA_PROSPECTS[0].id).firmName).toBe("Aastha Lawyers from ledger");
    expect(body.records.map((record: { firmName: string }) => record.firmName)).toEqual(
      [...body.records.map((record: { firmName: string }) => record.firmName)].sort((left, right) => left.localeCompare(right, "en-CA", { sensitivity: "base" })),
    );
  });

  it("shows a 103-record ledger batch alongside the 20 disjoint fixtures", async () => {
    h.state.session = { role: "operator" };
    h.state.records = Array.from({ length: 103 }, (_, index) => ({
      ...RECONCILED_GTA_PROSPECTS[0],
      id: `imported-firm-${String(index + 1).padStart(3, "0")}`,
      firmName: `Imported firm ${String(index + 1).padStart(3, "0")}`,
    }));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.source).toBe("hybrid");
    expect(body.sourceCounts).toEqual({ ledger: 103, fixture: 20 });
    expect(body.records).toHaveLength(6_045);
    expect(body.qualifiedImport).toMatchObject({ added: 20, updated: 0, ambiguous: 0 });
    expect(new Set(body.records.map((record: { id: string }) => record.id)).size).toBe(6_045);
  });

  it("uses only ledger rows after every fixture key is represented", async () => {
    h.state.session = { role: "operator" };
    h.state.records = [...RECONCILED_GTA_PROSPECTS].reverse();
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.source).toBe("ledger");
    expect(body.sourceCounts).toEqual({ ledger: 20, fixture: 0 });
    expect(body.records).toHaveLength(5_942);
    expect(body.qualifiedImport).toMatchObject({ added: 20, updated: 0, ambiguous: 0 });
  });

  it("enriches a ledger record by normalized canonical domain instead of duplicating it", async () => {
    h.state.session = { role: "operator" };
    h.state.records = [{
      ...RECONCILED_GTA_PROSPECTS[0],
      id: "ledger-struthers",
      firmName: "Struthers Law from ledger",
      websiteUrl: "https://www.strutherslaw.ca/contact.html",
    }];
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.qualifiedImport).toMatchObject({ added: 19, updated: 1, ambiguous: 0 });
    expect(body.records.filter((record: { canonicalDomain?: string }) => record.canonicalDomain === "strutherslaw.ca")).toHaveLength(1);
    expect(body.records.find((record: { id: string }) => record.id === "ledger-struthers")).toMatchObject({
      firmName: "Struthers Law from ledger",
      firmId: "FIRM-7XGYP723JDAXDAB2J76RVNSVD5",
      observedLawyerCount: 2,
    });
  });

  it("returns a visible server error for a real ledger failure rather than concealing it as fallback", async () => {
    h.state.session = { role: "operator" };
    h.state.failure = new Error("permission denied");
    const response = await GET();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "GTA prospect research records could not be loaded." });
  });
});
