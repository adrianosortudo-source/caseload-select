/**
 * GET /api/portal/[firmId]/periods/[periodId]/package-export
 *
 * Read-only, operator-only. Returns Section 19's 4 export artifacts
 * (full package manifest, gateway hero-binding manifest, human-readable
 * summary, blocker report). Never triggers an upload -- Export has no
 * network side effects.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { loadControlRoomPackage } from "@/lib/publishing-package-control-room-loader";
import { buildExportBundle } from "@/lib/publishing-package-gateway-export";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, periodId } = await params;
  const result = await loadControlRoomPackage(firmId, periodId);
  if (!result) return NextResponse.json({ error: "package not found" }, { status: 404 });

  const bundle = buildExportBundle(firmId, result.manifest, result.assets);
  return NextResponse.json({ ok: true, ...bundle }, { status: 200 });
}
