import type { NextRequest } from "next/server";
import { getProspectEnrichmentFirmDetail } from "@/lib/prospect-enrichment-reader";
import { readId, readQuery, readRoute } from "../../_read-common";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ firmId: string }> }) {
  return readRoute(request, "read_firm", async () => {
    readQuery(request, []);
    return { firm: await getProspectEnrichmentFirmDetail({ firmId: readId((await context.params).firmId) }) };
  });
}
