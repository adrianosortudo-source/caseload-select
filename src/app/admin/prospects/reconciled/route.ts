import { NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { RECONCILED_GTA_PROSPECTS } from "../reconciled-prospects";

export const dynamic = "force-dynamic";

/** Operator-gated read endpoint for the reviewed firm-expansion records. */
export async function GET() {
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    { records: RECONCILED_GTA_PROSPECTS },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
