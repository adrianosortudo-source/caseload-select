import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ session: null as null | { role: string; firm_id: string; lawyer_id: string; exp: number }, rpc: vi.fn() }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: vi.fn(async () => state.session) }));
vi.mock("@/lib/client-import-server", () => ({ validateSameOrigin: vi.fn(() => true) }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { rpc: state.rpc } }));
import { GET as list } from "../candidates/route";
import { GET as detail } from "../candidates/[candidateId]/route";
import { GET as history } from "../candidates/[candidateId]/history/route";
import { GET as content } from "../candidates/[candidateId]/history/[revisionId]/content/route";
import { candidateDetail, candidateHistory, candidateList, candidateSummaries } from "../../../../../../tests/prospect-enrichment/candidate-fixtures";
const id = candidateSummaries[0].id;
const req = (query = "") => new NextRequest("http://127.0.0.1:3100/api/admin/prospect-enrichment/candidates" + query);
const ctx = { params: Promise.resolve({ candidateId: id }) };
const revisionId = candidateHistory(id).items[0].id;
const contentCtx = { params: Promise.resolve({ candidateId: id, revisionId }) };
beforeEach(() => {
  vi.clearAllMocks(); state.session = { role: "operator", firm_id: id, lawyer_id: id, exp: 2_000_000_000 };
  state.rpc.mockImplementation(async (name: string) => ({ error: null, data: name === "list_prospect_research_candidates_v1" ? { ...candidateList, nextAfterId: null } : name === "get_prospect_research_candidate_v1" ? candidateDetail(id) : { ...candidateHistory(id), nextAfterId: null } }));
});
describe("protected candidate list/profile/history actual GET paths", () => {
  it("authenticates all routes before query or DB and denies nonoperators", async () => {
    state.session = null;
    for (const invoke of [() => list(req("?unknown=x")), () => detail(req(), ctx), () => history(req(), ctx), () => content(req(), contentCtx)]) { const response = await invoke(); expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("private, no-store"); }
    expect(state.rpc).not.toHaveBeenCalled(); state.session = { role: "lawyer", firm_id: id, lawyer_id: id, exp: 2_000_000_000 }; expect((await list(req())).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("returns every disposition through the real reader without qualification promotion", async () => {
    const response = await list(req()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json(); expect(body.items.map((item: { originalStatuses: string[] }) => item.originalStatuses[0] ?? "missing")).toEqual(["selected", "held", "rejected", "incomplete", "not_selected", "malformed", "missing", "conflicting_identity"]);
    expect(body.items.every((item: { verifiedFirmId: unknown; qualificationStates: string[] }) => item.verifiedFirmId === null && item.qualificationStates[0] === "needs_evidence")).toBe(true); expect(body.complete).toBe(false);
  });
  it("retains exact original history and typed facets on actual route", async () => {
    expect(await (await detail(req("?coverageRevision=42"), ctx)).json()).toEqual(candidateDetail(id));
    expect(await (await history(req("?coverageRevision=42"), ctx)).json()).toEqual(candidateHistory(id));
    expect((await list(req("?fieldPointer=%2FunknownFact&fieldValue=false"))).status).toBe(200);
    expect(state.rpc.mock.lastCall?.[1].p_filters).toEqual({ fieldPointer: "/unknownFact", fieldValue: false });
  });
  it.each(["?unknown=x", "?limit=101", "?cursor=/", "?fieldValue=false", "?observedFrom=2026-99-99", "?text=x&text=y"])("rejects invalid query %s", async query => { expect((await list(req(query))).status).toBe(422); expect(state.rpc).not.toHaveBeenCalled(); });
  it("reports reader errors without exposing SQL or returning empty success", async () => {
    state.rpc.mockResolvedValueOnce({ data: null, error: { message: "private SQL and raw data" } }); const response = await list(req()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private SQL");
  });
  it("reads only a bounded chunk for the exact candidate/revision/snapshot", async () => {
    const chunk = JSON.stringify(candidateHistory(id).items[0]), value = { candidateId: id, revisionId, coverageRevision: 42, offset: 0, nextOffset: null, chunk, totalCharacters: Array.from(chunk).length, contentSha256: createHash("sha256").update(chunk).digest("hex") };
    state.rpc.mockResolvedValueOnce({ data: value, error: null });
    const response = await content(req("?coverageRevision=42&offset=0"), contentCtx); expect(response.status).toBe(200); expect(await response.json()).toEqual(value);
    expect(state.rpc.mock.lastCall).toEqual(["get_prospect_research_candidate_revision_chunk_v1", { p_candidate_id: id, p_revision_id: revisionId, p_offset: 0, p_coverage_revision: 42 }]);
    expect((await content(req("?coverageRevision=42&offset=1"), contentCtx)).status).toBe(422);
    expect((await content(req("?offset=0"), contentCtx)).status).toBe(422);
  });
  it("rejects mutation methods by exporting GET only", async () => {
    expect(Object.keys(await import("../candidates/route")).sort()).toEqual(["GET", "dynamic", "runtime"]);
  });
});


it("scopes the protected GET to verified firm identity without promoting source statuses", async () => {
  const firmId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  const items = [candidateSummaries[0], candidateSummaries[2]].map((item, index) => ({ ...item, identityNamespace: `source:producer-${index}`, verifiedFirmId: firmId, identityState: "resolved" }));
  state.rpc.mockResolvedValueOnce({ data: { ...candidateList, items, filteredCount: 2, nextAfterId: null }, error: null });
  const response = await list(req("?firmId=" + firmId.toUpperCase()));
  expect(response.status).toBe(200); expect((await response.json()).items).toEqual(items);
  expect(state.rpc.mock.lastCall?.[1].p_filters).toEqual({ firmId });
  const escaped = await list(req("?firmId=" + firmId)); expect(escaped.status).toBe(503);
});

it("returns retained retraction proof through the protected detail GET", async () => {
  const fixture = { ...candidateDetail(id), profileChoices: [{ field_key: "websiteUrl", selected_value: "https://synthetic.example.test", evidenceState: "retracted", retractions: [{ event_type: "evidence_retracted", event_data: { targetTable: "prospect_source_captures", targetId: id } }] }] };
  state.rpc.mockResolvedValueOnce({ data: fixture, error: null });
  const response = await detail(req("?coverageRevision=42"), ctx); expect(response.status).toBe(200); expect(await response.json()).toEqual(fixture);
  state.rpc.mockResolvedValueOnce({ data: { ...fixture, profileChoices: [{ selected_value: true }] }, error: null });
  expect((await detail(req("?coverageRevision=42"), ctx)).status).toBe(503);
});
