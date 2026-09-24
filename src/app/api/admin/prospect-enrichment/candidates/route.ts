import type { NextRequest } from "next/server";
import { listCandidateResearch } from "@/lib/prospect-enrichment-candidate-reader";
import { candidateQuery, candidateReadRoute } from "../_candidate-read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return candidateReadRoute(request, "candidate_list", () => listCandidateResearch(candidateQuery(request)));
}
