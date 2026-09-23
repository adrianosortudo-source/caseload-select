import type { NextRequest } from "next/server";
import { getProspectEnrichmentFirmHistory } from "@/lib/prospect-enrichment-reader";
import { opaqueCursor, ReadApiError, readId, readLimit, readQuery, readRoute } from "../../../_read-common";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ firmId: string }> }) {
  return readRoute(request, "read_firm_history", async () => {
    const query = readQuery(request, ["table", "limit", "cursor"]);
    const table = query.get("table");
    if (!table || !/^[a-z][a-z0-9_]{1,100}$/.test(table)) throw new ReadApiError("A supported evidence table is required.", 422);
    return getProspectEnrichmentFirmHistory({ firmId: readId((await context.params).firmId), table, limit: readLimit(query), cursor: opaqueCursor(query.get("cursor")) });
  });
}
