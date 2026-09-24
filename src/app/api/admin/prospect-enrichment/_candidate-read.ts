import type { NextRequest } from "next/server";
import { CandidateContractError, CANDIDATE_FILTER_KEYS, parseCandidateFilters } from "@/lib/prospect-enrichment-candidate-contract";
import { CandidateReadError } from "@/lib/prospect-enrichment-candidate-reader";
import { opaqueCursor, ReadApiError, readQuery, readRoute } from "./_read-common";
export const candidateQueryKeys = [...CANDIDATE_FILTER_KEYS, "limit", "cursor"];
export function candidateQuery(request: NextRequest) {
  const query = readQuery(request, candidateQueryKeys);
  const rawLimit = query.get("limit");
  if (rawLimit !== null && !/^[1-9]\d{0,2}$/.test(rawLimit)) throw new ReadApiError("Invalid page size.", 422);
  try { return { filters: parseCandidateFilters(query), limit: rawLimit === null ? 25 : Number(rawLimit), cursor: opaqueCursor(query.get("cursor")) }; }
  catch (cause) { if (cause instanceof CandidateContractError) throw new ReadApiError(cause.message, 422); throw cause; }
}
export function candidateCoverage(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new ReadApiError("Invalid coverage revision.", 422);
  return Number(value);
}
export function candidateReadRoute(request: NextRequest, operation: string, work: () => Promise<unknown>) {
  return readRoute(request, operation, async () => {
    try { return await work(); }
    catch (cause) {
      if (cause instanceof CandidateReadError) throw new ReadApiError(cause.message, cause.status);
      if (cause instanceof CandidateContractError) throw new ReadApiError("Candidate research returned an incomplete projection. Coverage remains unverified.", 503);
      throw cause;
    }
  });
}
