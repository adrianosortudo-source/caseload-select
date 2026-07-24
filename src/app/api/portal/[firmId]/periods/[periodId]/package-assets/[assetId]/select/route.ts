/**
 * POST .../package-assets/[assetId]/select -- operator-only, no body.
 * Same auth boundary as package-assets/route.ts: only the operator session
 * cookie is consulted, never an Authorization header.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { selectCandidate } from "@/lib/publishing-package-control-room-mutations";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string; assetId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, periodId, assetId } = await params;
  const result = await selectCandidate(firmId, periodId, assetId);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, assetId: result.assetId }, { status: 200 });
}
