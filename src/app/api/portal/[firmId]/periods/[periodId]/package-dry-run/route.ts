/**
 * POST /api/portal/[firmId]/periods/[periodId]/package-dry-run
 *
 * Operator-only. Builds the gateway export manifest and runs
 * runAssetBindingDryRun against it -- zero network calls, zero writes, by
 * construction (see publishing-package-gateway-export.ts). The real bind
 * still only ever happens through scripts/publishing-bind-heroes.mjs,
 * never from this route.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { loadControlRoomPackage } from "@/lib/publishing-package-control-room-loader";
import { buildGatewayExportManifest, runAssetBindingDryRun } from "@/lib/publishing-package-gateway-export";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, periodId } = await params;
  const result = await loadControlRoomPackage(firmId, periodId);
  if (!result) return NextResponse.json({ error: "package not found" }, { status: 404 });

  const exportResult = buildGatewayExportManifest(firmId, result.manifest, result.assets);
  const dryRun = runAssetBindingDryRun(exportResult);
  return NextResponse.json(dryRun, { status: 200 });
}
