import { describe, expect, it, vi } from "vitest";
import { CandidateContractError, parseCandidateDetail, parseCandidateField, parseCandidateFilters, parseCandidateHistoryItem, parseCandidateMetadata, parseCandidateSummary } from "../prospect-enrichment-candidate-contract";
import { candidateDetail, candidateHistory, candidateList, candidateSummaries } from "../../../tests/prospect-enrichment/candidate-fixtures";
import { getCandidateHistory, getCandidateResearch, listCandidateResearch } from "../prospect-enrichment-candidate-reader";
const id = candidateSummaries[0].id;
const client = (data: unknown) => ({ rpc: vi.fn(async (name: string, args: Record<string, unknown>) => { void name; void args; return { data, error: null }; }) });
describe("all-candidate retained research contract", () => {
  it.each(candidateSummaries)("keeps $identityKey without inventing a firm UUID or promoting qualification", candidate => {
    expect(parseCandidateSummary(candidate)).toEqual(candidate);
    expect(parseCandidateDetail(candidateDetail(candidate.id)).candidate.verifiedFirmId).toBeNull();
    for (const item of candidateHistory(candidate.id).items) expect(parseCandidateHistoryItem(item)).toEqual(item);
  });
  it("retains blank original status and deeply nested JSON without turning the list unavailable", () => {
    expect(parseCandidateSummary({ ...candidateSummaries[0], originalStatuses: [""] }).originalStatuses).toEqual([""]);
    let deep: unknown = { retained: true }; for (let index = 0; index < 100; index++) deep = { nested: deep };
    expect(parseCandidateHistoryItem({ ...candidateHistory(id).items[0], originalJson: deep }).originalJson).toEqual(deep);
  });
  it("retains exact malformed keys safely as JSON data", () => {
    const item = { ...candidateHistory(id).items[0], originalJson: JSON.parse('{"__proto__":{"polluted":true}}') };
    const parsed = parseCandidateHistoryItem(item);
    expect(JSON.stringify(parsed.originalJson)).toBe('{"__proto__":{"polluted":true}}'); expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it.each([null, false, "false", "", [], {}])("accepts exact typed field value %j", value => {
    const scalarType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const field = { ...candidateHistory(id).items[0].fields[0], scalarType, value };
    expect(parseCandidateField(field).value).toEqual(value);
    expect(parseCandidateFilters(new URLSearchParams({ fieldPointer: "/a~1b~0c", fieldValue: JSON.stringify(value) })).fieldValue).toBe(JSON.stringify(value));
  });
  it.each(["observedFrom=2026-02-30", "observedFrom=2026-99-99", "retrievedFrom=2026-09-24&retrievedTo=2026-09-01", "observedUnknown=true&observedFrom=2026-09-01", "identityState=claimed", "fieldValue=false", "fieldPointer=/bad~2path", "fieldPointer=/a&fieldValue=%7B%22x%22%3A1%7D", "sourceUrl=javascript:alert(1)", "sourceUrl=https://user:password@example.test", "text=a&text=b"])("rejects invalid filters %s", query => {
    expect(() => parseCandidateFilters(new URLSearchParams(query))).toThrow(CandidateContractError);
  });
  it("rejects inconsistent resolution and false completeness", () => {
    expect(() => parseCandidateSummary({ ...candidateSummaries[0], identityState: "resolved" })).toThrow();
    expect(() => parseCandidateMetadata({ coverageRevision: 1, readWarnings: ["missing"], complete: true })).toThrow();
  });
});
describe("candidate RPC read adapter", () => {
  it("normalizes a valid uppercase candidate UUID before comparing database identity", async () => {
    const lower = "abcdefab-cdef-4abc-8def-abcdefabcdef", fixture = candidateDetail(id);
    const value = { ...fixture, candidate: { ...fixture.candidate, id: lower } }, db = client(value);
    expect(await getCandidateResearch(lower.toUpperCase(), 42, db)).toEqual(value); expect(db.rpc.mock.lastCall?.[1].p_candidate_id).toBe(lower);
  });
  it("uses only bounded RPC calls and freezes cursor/filter coverage", async () => {
    const db = client({ ...candidateList, items: [candidateSummaries[0]], nextAfterId: id });
    const page = await listCandidateResearch({ filters: { fieldPointer: "/unknownFact", fieldValue: "false" }, limit: 1 }, db);
    expect(db.rpc).toHaveBeenCalledWith("list_prospect_research_candidates_v1", { p_filters: { fieldPointer: "/unknownFact", fieldValue: false }, p_limit: 1, p_after_id: null, p_coverage_revision: null });
    db.rpc.mockResolvedValueOnce({ data: { ...candidateList, items: [candidateSummaries[1]], nextAfterId: null }, error: null });
    await listCandidateResearch({ filters: { fieldPointer: "/unknownFact", fieldValue: "false" }, limit: 1, cursor: page.nextCursor! }, db);
    expect(db.rpc.mock.lastCall?.[1]).toMatchObject({ p_after_id: id, p_coverage_revision: 42 });
    await expect(listCandidateResearch({ filters: { fieldPointer: "/unknownFact", fieldValue: "true" }, cursor: page.nextCursor! }, db)).rejects.toMatchObject({ status: 422 });
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });
  it("fails closed on missing RPC, malformed result and changed coverage", async () => {
    await expect(listCandidateResearch({ filters: {} }, { rpc: vi.fn(async () => ({ data: null, error: { message: "private SQL" } })) })).rejects.toMatchObject({ status: 503 });
    await expect(listCandidateResearch({ filters: {} }, client({ ...candidateList, items: "bad" }))).rejects.toThrow(CandidateContractError);
    await expect(getCandidateResearch(id, 41, client(candidateDetail(id)))).rejects.toThrow(CandidateContractError);
  });
  it("keeps candidate history fields, dates, unknowns, retractions and immutable raw revisions", async () => {
    const fixture = candidateHistory(id), db = client({ ...fixture, nextAfterId: null });
    expect(await getCandidateHistory(id, { coverageRevision: 42 }, db)).toEqual(fixture);
    expect(db.rpc).toHaveBeenCalledWith("list_prospect_research_candidate_history_v1", { p_candidate_id: id, p_limit: 10, p_after_id: null, p_coverage_revision: 42 });
  });
  it("refuses foreign candidate history and invalid limits before DB", async () => {
    await expect(getCandidateHistory(id, {}, client({ ...candidateHistory(candidateSummaries[1].id), nextAfterId: null }))).rejects.toThrow(CandidateContractError);
    const db = client(null); await expect(getCandidateHistory(id, { limit: 21 }, db)).rejects.toMatchObject({ status: 422 }); expect(db.rpc).not.toHaveBeenCalled();
  });
  it("uses boolean unknown-date RPC filters and maps missing history to 404", async () => {
    const db = client({ ...candidateList, nextAfterId: null });
    await listCandidateResearch({ filters: { observedUnknown: "true", retrievedUnknown: "true" } }, db);
    expect(db.rpc.mock.lastCall?.[1].p_filters).toEqual({ observedUnknown: true, retrievedUnknown: true });
    await expect(getCandidateHistory(id, {}, client(null))).rejects.toMatchObject({ status: 404 });
  });
  it("distinguishes missing detail from an empty successful projection", async () => {
    await expect(getCandidateResearch(id, undefined, client(null))).rejects.toMatchObject({ status: 404 });
  });
});
