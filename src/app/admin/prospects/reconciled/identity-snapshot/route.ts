import { NextResponse } from "next/server";

import { buildGtaProspectIdentitySnapshot } from "@/lib/gta-prospect-identity-snapshot";
import { listGtaProspectResearchForOperator } from "@/lib/gta-prospect-research-reader";
import { getOperatorSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...PRIVATE_NO_STORE_HEADERS, ...headers },
  });
}

/** Operator-gated, read-only export containing identity keys only. */
export async function GET() {
  if (!(await getOperatorSession())) return jsonResponse({ error: "Unauthorized" }, 401);
  try {
    const snapshot = buildGtaProspectIdentitySnapshot(await listGtaProspectResearchForOperator());
    return jsonResponse(snapshot, 200, {
      "Content-Disposition": `attachment; filename="gta-prospect-identity-snapshot-${snapshot.generated_on}.json"`,
    });
  } catch {
    return jsonResponse({ error: "Live prospect identity snapshot is unavailable." }, 503);
  }
}
