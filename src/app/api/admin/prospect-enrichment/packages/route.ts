import type { NextRequest } from "next/server";
import { PACKAGE_STATES, readPackageList } from "../_package-read";
import { opaqueCursor, ReadApiError, readLimit, readQuery, readRoute } from "../_read-common";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return readRoute(request, "list_packages", async () => {
    const query = readQuery(request, ["state", "limit", "cursor"]);
    const state = query.get("state") ?? "all";
    if (!(PACKAGE_STATES as readonly string[]).includes(state)) throw new ReadApiError("The research state filter is invalid.", 422);
    return readPackageList({ state, limit: readLimit(query), cursor: opaqueCursor(query.get("cursor")) });
  });
}
