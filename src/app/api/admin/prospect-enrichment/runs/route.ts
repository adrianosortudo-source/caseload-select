import type { NextRequest } from "next/server";
import { readRunList } from "../_run-read";
import { opaqueCursor, readLimit, readQuery, readRoute } from "../_read-common";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return readRoute(request, "list_runs", async () => {
    const query = readQuery(request, ["limit", "cursor"]);
    return readRunList({ limit: readLimit(query), cursor: opaqueCursor(query.get("cursor")) });
  });
}
