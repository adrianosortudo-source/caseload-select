/**
 * POST .../package-assets/[assetId]/supersede -- operator-only, body
 * { replacement_asset_id }. Same auth boundary as package-assets/route.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { supersedeCandidate } from "@/lib/publishing-package-control-room-mutations";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string; assetId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, periodId, assetId } = await params;

  let body: { replacement_asset_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const result = await supersedeCandidate(firmId, periodId, assetId, body.replacement_asset_id as string);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, assetId: result.assetId }, { status: 200 });
}
