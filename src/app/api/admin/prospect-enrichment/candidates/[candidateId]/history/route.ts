import type { NextRequest } from "next/server";
import { getCandidateHistory } from "@/lib/prospect-enrichment-candidate-reader";
import { candidateCoverage } from "../../../_candidate-read";
import { opaqueCursor, ReadApiError, readQuery, readRoute } from "../../../_read-common";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ candidateId: string }> }) {
  return readRoute(request, "candidate_history", async () => {
    const query = readQuery(request, ["coverageRevision", "cursor", "limit"]), { candidateId } = await context.params, limit = query.get("limit");
    if (limit !== null && !/^[1-9]\d?$/.test(limit)) throw new ReadApiError("Invalid history page size.", 422);
    return getCandidateHistory(candidateId, { coverageRevision: candidateCoverage(query.get("coverageRevision")), cursor: opaqueCursor(query.get("cursor")), limit: limit === null ? 10 : Number(limit) });
  });
}
