import type { NextRequest } from "next/server";
import { readPackageDetail } from "../../_package-read";
import { readId, readQuery, readRoute } from "../../_read-common";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ packageId: string }> }) {
  return readRoute(request, "read_package", async () => {
    readQuery(request, []);
    return { package: await readPackageDetail({ packageId: readId((await context.params).packageId) }) };
  });
}
