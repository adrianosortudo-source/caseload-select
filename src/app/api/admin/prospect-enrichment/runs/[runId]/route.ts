import type { NextRequest } from "next/server";
import { readRunDetail } from "../../_run-read";
import { opaqueCursor, readId, readLimit, readQuery, readRoute } from "../../_read-common";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  return readRoute(request, "read_run", async () => {
    const query = readQuery(request, ["limit", "cursor", "entryCursor"]);
    return { run: await readRunDetail({ runId: readId((await context.params).runId), limit: readLimit(query), cursor: opaqueCursor(query.get("cursor")), entryCursor: opaqueCursor(query.get("entryCursor")) }) };
  });
}
