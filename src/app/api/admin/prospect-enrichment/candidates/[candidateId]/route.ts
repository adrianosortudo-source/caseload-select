import type { NextRequest } from "next/server";
import { getCandidateResearch } from "@/lib/prospect-enrichment-candidate-reader";
import { candidateCoverage, candidateReadRoute } from "../../_candidate-read";
import { readQuery } from "../../_read-common";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ candidateId: string }> }) {
  return candidateReadRoute(request, "candidate_detail", async () => {
    const query = readQuery(request, ["coverageRevision"]), { candidateId } = await context.params;
    return getCandidateResearch(candidateId, candidateCoverage(query.get("coverageRevision")));
  });
}
