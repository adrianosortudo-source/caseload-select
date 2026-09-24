import "server-only";
import { createHash } from "node:crypto";
import {
  CandidateContractError, parseCandidateDetail, parseCandidateHistoryItem, parseCandidateMetadata, parseCandidateSummary,
  type CandidateDetail, type CandidateFilters, type CandidateHistory, type CandidateList,
} from "@/lib/prospect-enrichment-candidate-contract";

export type CandidateReadClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export class CandidateReadError extends Error {
  constructor(message: string, readonly status: 404 | 422 | 503) { super(message); this.name = "CandidateReadError"; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function row(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new CandidateContractError(); return value as Record<string, unknown>; }
function nonnegative(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new CandidateContractError(); return value as number; }
function scope(kind: string, filters: CandidateFilters | string): string {
  return createHash("sha256").update(JSON.stringify([kind, typeof filters === "string" ? filters : Object.entries(filters).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)])).digest("hex");
}
function cursorFor(value: unknown, coverageRevision: number, cursorScope: string): string | null {
  if (value === null) return null; if (typeof value !== "string" || !UUID.test(value)) throw new CandidateContractError();
  return Buffer.from(JSON.stringify({ version: 1, afterId: value, coverageRevision, scope: cursorScope })).toString("base64url");
}
function decode(cursor: string | undefined, expectedScope: string): { afterId: string | null; coverageRevision: number | null } {
  if (!cursor) return { afterId: null, coverageRevision: null };
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new Error();
    const value = row(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (Object.keys(value).sort().join(",") !== "afterId,coverageRevision,scope,version" || value.version !== 1 || value.scope !== expectedScope || typeof value.afterId !== "string" || !UUID.test(value.afterId)) throw new Error();
    return { afterId: value.afterId, coverageRevision: nonnegative(value.coverageRevision) };
  } catch { throw new CandidateReadError("The cursor does not belong to these research filters.", 422); }
}
async function rpc(name: string, args: Record<string, unknown>, client?: CandidateReadClient): Promise<unknown> {
  const db: CandidateReadClient = client ?? (await import("@/lib/supabase-admin")).supabaseAdmin as unknown as CandidateReadClient;
  let result; try { result = await db.rpc(name, args); } catch { throw new CandidateReadError("Candidate research could not be loaded. Coverage is unverified.", 503); }
  if (result.error) throw new CandidateReadError("Candidate research could not be loaded. Coverage is unverified.", 503);
  return result.data;
}
function pageLimit(value: number, max: number): number { if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new CandidateReadError("Invalid research page size.", 422); return value; }
function candidateId(value: string): string { if (!UUID.test(value)) throw new CandidateReadError("A valid candidate UUID is required.", 422); return value.toLowerCase(); }
function coverage(value: number | undefined): number | null { if (value === undefined) return null; try { return nonnegative(value); } catch { throw new CandidateReadError("The coverage revision is invalid.", 422); } }
export async function listCandidateResearch(input: { filters: CandidateFilters; limit?: number; cursor?: string }, client?: CandidateReadClient): Promise<CandidateList> {
  const cursorScope = scope("candidates", input.filters), page = decode(input.cursor, cursorScope);
  const data = row(await rpc("list_prospect_research_candidates_v1", { p_filters: { ...input.filters, ...(input.filters.fieldValue === undefined ? {} : { fieldValue: JSON.parse(input.filters.fieldValue) as unknown }), ...(input.filters.observedUnknown === undefined ? {} : { observedUnknown: input.filters.observedUnknown === "true" }), ...(input.filters.retrievedUnknown === undefined ? {} : { retrievedUnknown: input.filters.retrievedUnknown === "true" }) }, p_limit: pageLimit(input.limit ?? 25, 100), p_after_id: page.afterId, p_coverage_revision: page.coverageRevision }, client));
  const meta = parseCandidateMetadata(data);
  if (!Array.isArray(data.items) || (page.coverageRevision !== null && meta.coverageRevision !== page.coverageRevision)) throw new CandidateContractError();
  const items = data.items.map(parseCandidateSummary), inventoryCount = nonnegative(data.inventoryCount), filteredCount = nonnegative(data.filteredCount);
  if (filteredCount > inventoryCount || items.length > (input.limit ?? 25) || new Set(items.map(item => item.id)).size !== items.length) throw new CandidateContractError();
  const requestedFirmId = input.filters.firmId?.toLowerCase();
  if (requestedFirmId && items.some(item => item.identityState !== "resolved" || item.verifiedFirmId !== requestedFirmId)) throw new CandidateContractError();
  return { ...meta, items, inventoryCount, filteredCount, nextCursor: cursorFor(data.nextAfterId, meta.coverageRevision, cursorScope) };
}
export async function getCandidateResearch(id: string, coverageRevision?: number, client?: CandidateReadClient): Promise<CandidateDetail> {
  id = candidateId(id);
  const result = await rpc("get_prospect_research_candidate_v1", { p_candidate_id: candidateId(id), p_coverage_revision: coverage(coverageRevision) }, client);
  if (result === null) throw new CandidateReadError("This candidate is not present in the requested research snapshot.", 404);
  const parsed = parseCandidateDetail(result);
  if (parsed.candidate.id !== id || (coverageRevision !== undefined && parsed.coverageRevision !== coverageRevision)) throw new CandidateContractError();
  return parsed;
}
export async function getCandidateHistory(id: string, input: { limit?: number; cursor?: string; coverageRevision?: number }, client?: CandidateReadClient): Promise<CandidateHistory> {
  id = candidateId(id); const cursorScope = scope("candidate-history", id), page = decode(input.cursor, cursorScope), requested = coverage(input.coverageRevision);
  if (page.coverageRevision !== null && requested !== null && page.coverageRevision !== requested) throw new CandidateReadError("History cursor and coverage revision disagree.", 422);
  const cutoff = page.coverageRevision ?? requested;
  const result = await rpc("list_prospect_research_candidate_history_v1", { p_candidate_id: id, p_limit: pageLimit(input.limit ?? 10, 20), p_after_id: page.afterId, p_coverage_revision: cutoff }, client);
  if (result === null) throw new CandidateReadError("This candidate is not present in the requested research snapshot.", 404);
  const data = row(result), meta = parseCandidateMetadata(data);
  if (!Array.isArray(data.items) || (cutoff !== null && meta.coverageRevision !== cutoff)) throw new CandidateContractError();
  const items = data.items.map(parseCandidateHistoryItem);
  if (items.length > (input.limit ?? 10) || items.some(item => item.candidateId !== id) || new Set(items.map(item => item.id)).size !== items.length) throw new CandidateContractError();
  return { ...meta, items, nextCursor: cursorFor(data.nextAfterId, meta.coverageRevision, cursorScope) };
}

export async function getCandidateRevisionChunk(id: string, revisionId: string, offset: number, coverageRevision: number, client?: CandidateReadClient) {
  id = candidateId(id); revisionId = candidateId(revisionId);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % 65536 !== 0 || offset > 80_000_000) throw new CandidateReadError("Invalid revision content offset.", 422);
  const result = await rpc("get_prospect_research_candidate_revision_chunk_v1", { p_candidate_id: id, p_revision_id: revisionId, p_offset: offset, p_coverage_revision: coverage(coverageRevision) }, client);
  if (result === null) throw new CandidateReadError("This revision is not present in the requested candidate snapshot.", 404);
  const { parseCandidateRevisionChunk } = await import("@/lib/prospect-enrichment-candidate-content");
  const parsed = parseCandidateRevisionChunk(result);
  if (parsed.candidateId !== id || parsed.revisionId !== revisionId || parsed.coverageRevision !== coverageRevision || parsed.offset !== offset) throw new CandidateContractError();
  return parsed;
}
