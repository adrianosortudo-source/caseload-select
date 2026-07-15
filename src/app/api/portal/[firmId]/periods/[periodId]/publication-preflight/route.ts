/**
 * GET /api/portal/[firmId]/periods/[periodId]/publication-preflight
 *
 * Workstream 7: the release-gate report. Read-only, operator-only, never
 * generates content. Reports may_publish per placement in this period with
 * the exact reason when false. "Missing metadata is actionable setup work,
 * not a generic blocked label; historical periods remain outside
 * enforcement until explicitly activated; new enforced periods fail
 * closed" (mega-assignment doctrine) -- all three are encoded in
 * buildPreflightReport (publication-preflight.ts), not repeated here.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { loadPublicationPreflightForPeriod } from "@/lib/publication-preflight-loader";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, periodId } = await params;
  const report = await loadPublicationPreflightForPeriod(periodId, firmId);
  if (!report) return NextResponse.json({ error: "period not found for this firm" }, { status: 404 });

  return NextResponse.json({ ok: true, ...report });
}
