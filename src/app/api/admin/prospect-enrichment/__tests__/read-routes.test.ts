import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({
  session: null as null | { role: string; firm_id: string; lawyer_id: string; exp: number },
  packageList: vi.fn(), packageDetail: vi.fn(), runList: vi.fn(), runDetail: vi.fn(), firmDetail: vi.fn(), firmHistory: vi.fn(),
}));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: vi.fn(async () => state.session) }));
vi.mock("@/lib/client-import-server", () => ({ validateSameOrigin: vi.fn(() => true) }));
vi.mock("../_package-read", () => ({ PACKAGE_STATES: ["all", "held", "received", "ready_for_review", "identity_hold", "evidence_hold", "applied", "rejected", "superseded"], readPackageList: state.packageList, readPackageDetail: state.packageDetail }));
vi.mock("../_run-read", () => ({ readRunList: state.runList, readRunDetail: state.runDetail }));
vi.mock("@/lib/prospect-enrichment-reader", async (original) => ({ ...await original<typeof import("@/lib/prospect-enrichment-reader")>(), getProspectEnrichmentFirmDetail: state.firmDetail, getProspectEnrichmentFirmHistory: state.firmHistory }));
import { GET as packages } from "../packages/route";
import { GET as packageDetail } from "../packages/[packageId]/route";
import { GET as runs } from "../runs/route";
import { GET as runDetail } from "../runs/[runId]/route";
import { GET as firmDetail } from "../firms/[firmId]/route";
import { GET as history } from "../firms/[firmId]/history/route";
import { ReadApiError, datedCursor, encodeCursor } from "../_read-common";
import { ProspectEnrichmentReadError } from "@/lib/prospect-enrichment-reader";

const id = "00000000-0000-4000-8000-000000000001";
const request = (path = "") => new NextRequest("http://127.0.0.1:3100/api/admin/prospect-enrichment/" + path);
const allReaders = () => [state.packageList, state.packageDetail, state.runList, state.runDetail, state.firmDetail, state.firmHistory];
const invoke = [
  () => packages(request("packages")),
  () => packageDetail(request("packages/" + id), { params: Promise.resolve({ packageId: id }) }),
  () => runs(request("runs")),
  () => runDetail(request("runs/" + id), { params: Promise.resolve({ runId: id }) }),
  () => firmDetail(request("firms/" + id), { params: Promise.resolve({ firmId: id }) }),
  () => history(request("firms/" + id + "/history?table=prospect_service_observations"), { params: Promise.resolve({ firmId: id }) }),
];
beforeEach(() => {
  vi.clearAllMocks();
  state.session = { role: "operator", firm_id: id, lawyer_id: id, exp: 2_000_000_000 };
  state.packageList.mockResolvedValue({ packages: [], nextCursor: null });
  state.packageDetail.mockResolvedValue({ packageId: id, payload: { originalResearch: { content: { explicitNull: null, falseValue: false, emptyList: [] } } } });
  state.runList.mockResolvedValue({ runs: [], nextCursor: null });
  state.runDetail.mockResolvedValue({ summary: { runId: id }, reconciliation: { entries: [{ reconciliationState: "missing_package" }] } });
  state.firmDetail.mockResolvedValue({ firm: { id }, sections: [{ key: "sources", state: "error", errorId: "synthetic-id", items: [] }], complete: false });
  state.firmHistory.mockResolvedValue({ table: "prospect_service_observations", items: [], nextCursor: null });
});
describe("authenticated enrichment read route adapters", () => {
  it("denies all six read routes before calling readers when no operator session exists", async () => {
    state.session = null;
    for (const call of invoke) { const response = await call(); expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toContain("no-store"); }
    expect(allReaders().every((reader) => reader.mock.calls.length === 0)).toBe(true);
  });
  it("rejects a nonoperator session even if an auth provider erroneously returns it", async () => {
    state.session!.role = "lawyer";
    expect((await packages(request("packages"))).status).toBe(403);
    expect(state.packageList).not.toHaveBeenCalled();
  });
  it("keeps authentication ahead of invalid parameter details", async () => {
    state.session = null;
    expect((await packageDetail(request(), { params: Promise.resolve({ packageId: "not-an-id" }) })).status).toBe(401);
  });
  it.each(["limit=0", "limit=101", "limit=1.5", "limit=01", "limit=25&limit=25", "state=sync", "extra=value", "cursor=", "cursor=%2F"])("rejects invalid package query %s", async (query) => {
    expect((await packages(request("packages?" + query))).status).toBe(422);
    expect(state.packageList).not.toHaveBeenCalled();
  });
  it("passes the held filter and bounded pagination without translating it into qualification", async () => {
    const response = await packages(request("packages?state=held&limit=50"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ packages: [], nextCursor: null });
    expect(state.packageList).toHaveBeenCalledWith({ state: "held", limit: 50, cursor: undefined });
  });
  it("keeps the exact package wrapper and explicit null/false/empty evidence", async () => {
    const response = await invoke[1]();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ package: await state.packageDetail.mock.results[0].value });
  });
  it("returns separate run summary and manifest-entry pagination", async () => {
    const response = await runDetail(request("runs/" + id + "?limit=10&cursor=abc&entryCursor=def"), { params: Promise.resolve({ runId: id }) });
    expect(state.runDetail).toHaveBeenCalledWith({ runId: id, limit: 10, cursor: "abc", entryCursor: "def" });
    expect((await response.json()).run.reconciliation.entries[0].reconciliationState).toBe("missing_package");
  });
  it("preserves section errors and incomplete firm coverage", async () => {
    const response = await invoke[4](), body = await response.json();
    expect(response.status).toBe(200); expect(body.firm.complete).toBe(false); expect(body.firm.sections[0].state).toBe("error");
  });
  it("validates firm/history UUID and table shape before the reader", async () => {
    expect((await history(request("history?table=prospect_service_observations"), { params: Promise.resolve({ firmId: "bad" }) })).status).toBe(422);
    expect((await history(request("history?table=unsafe.table"), { params: Promise.resolve({ firmId: id }) })).status).toBe(422);
    expect((await history(request("history"), { params: Promise.resolve({ firmId: id }) })).status).toBe(422);
    expect(state.firmHistory).not.toHaveBeenCalled();
  });
  it("passes history scope and returns the exact history shape", async () => {
    const response = await history(request("history?table=prospect_service_observations&limit=100&cursor=abc"), { params: Promise.resolve({ firmId: id.toUpperCase() }) });
    expect(state.firmHistory).toHaveBeenCalledWith({ firmId: id, table: "prospect_service_observations", limit: 100, cursor: "abc" });
    expect(await response.json()).toEqual({ table: "prospect_service_observations", items: [], nextCursor: null });
  });
  it("reports missing records and reader failures without an empty success response", async () => {
    state.packageDetail.mockRejectedValueOnce(new ReadApiError("The research package was not found.", 404));
    expect((await invoke[1]()).status).toBe(404);
    state.firmDetail.mockRejectedValueOnce(new ProspectEnrichmentReadError("Research evidence could not be loaded."));
    const response = await invoke[4](); expect(response.status).toBe(503); expect((await response.json()).errorId).toBeTypeOf("string");
  });
  it("does not expose system-error text, SQL or evidence in the response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.packageList.mockRejectedValueOnce(new Error("private evidence and SQL text"));
    const response = await invoke[0](), body = await response.text();
    expect(response.status).toBe(503); expect(body).not.toContain("private evidence"); expect(body).not.toContain("SQL");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private evidence"); log.mockRestore();
  });
});
describe("scope-bound read cursors", () => {
  it("validates cursor scope and date fields before constructing a database filter", () => {
    const cursor = encodeCursor({ kind: "packages", scope: "held:all", createdAt: "2026-09-23T12:00:00.000Z", id });
    expect(datedCursor(cursor, "packages", "held:all")?.id).toBe(id);
    expect(() => datedCursor(cursor, "packages", "applied:all")).toThrow("does not belong");
    expect(() => datedCursor(encodeCursor({ kind: "packages", scope: "held:all", createdAt: "2026-09-23),id.gt.secret", id }), "packages", "held:all")).toThrow("invalid");
  });
});
