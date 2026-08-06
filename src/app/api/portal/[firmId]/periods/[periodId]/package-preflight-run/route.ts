/**
 * POST /api/portal/[firmId]/periods/[periodId]/package-preflight-run
 *
 * Operator-only. Builds PublicationInputs via loadPublicationInputs() (the
 * same helper the Release page uses -- one implementation, not two), then
 * runs and persists preflight via runPackagePreflight(). Loads the package
 * once here (needed for deliverableIds) and passes it straight through to
 * runPackagePreflight's optional preloaded argument, so there is exactly
 * one query for the package per request, not two.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { loadControlRoomPackage, loadPublicationInputs } from "@/lib/publishing-package-control-room-loader";
import { runPackagePreflight } from "@/lib/publishing-package-control-room-mutations";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, periodId } = await params;
  const result = await loadControlRoomPackage(firmId, periodId);
  if (!result) return NextResponse.json({ error: "package not found" }, { status: 404 });

  const deliverableIds = [...new Set(result.manifest.pieces.map((p) => p.deliverableId).filter((id): id is string => !!id))];
  const publicationInputs = await loadPublicationInputs(firmId, deliverableIds);

  const runResult = await runPackagePreflight(firmId, periodId, publicationInputs, result);
  if (!runResult.ok) return NextResponse.json({ error: runResult.error }, { status: 422 });
  return NextResponse.json(
    { ok: true, piecesClear: runResult.piecesClear, piecesBlocked: runResult.piecesBlocked, packageStatus: runResult.packageStatus },
    { status: 200 },
  );
}
