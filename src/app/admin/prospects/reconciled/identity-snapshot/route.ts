import { NextResponse } from "next/server";

import { buildGtaProspectIdentitySnapshot } from "@/lib/gta-prospect-identity-snapshot";
import { listGtaProspectResearchForOperator } from "@/lib/gta-prospect-research-reader";
import { getOperatorSession } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

/** Operator-gated, read-only export containing identity keys only. */
export async function GET() {
  if (!(await getOperatorSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const snapshot = buildGtaProspectIdentitySnapshot(await listGtaProspectResearchForOperator());
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="gta-prospect-identity-snapshot-${snapshot.generated_on}.json"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Live prospect identity snapshot is unavailable." }, { status: 503 });
  }
}
