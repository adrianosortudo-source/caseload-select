import type { NextRequest } from "next/server";
import { getCandidateRevisionChunk } from "@/lib/prospect-enrichment-candidate-reader";
import { candidateCoverage } from "../../../../../_candidate-read";
import { ReadApiError, readQuery, readRoute } from "../../../../../_read-common";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ candidateId: string; revisionId: string }> }) {
  return readRoute(request, "candidate_revision_content", async () => {
    const query = readQuery(request, ["coverageRevision", "offset"]), { candidateId, revisionId } = await context.params;
    const revision = candidateCoverage(query.get("coverageRevision")), offset = candidateCoverage(query.get("offset"));
    if (revision === undefined || offset === undefined) throw new ReadApiError("Revision content requires its exact coverage snapshot and offset.", 422);
    return getCandidateRevisionChunk(candidateId, revisionId, offset, revision);
  });
}
