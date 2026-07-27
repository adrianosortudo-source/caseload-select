/**
 * POST /api/portal/[firmId]/periods/[periodId]/package-manifest
 *
 * Creates (or revises) the package manifest for a period -- the activation
 * path for the Control Room. Operator-only, same auth boundary as the
 * other package-* routes: only the session cookie is consulted, never an
 * Authorization header.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { createPackageManifest } from "@/lib/publishing-package-control-room-mutations";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, periodId } = await params;

  let body: { manifest?: unknown; expected_piece_count?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.expected_piece_count !== "number") {
    return NextResponse.json({ error: "expected_piece_count is required" }, { status: 400 });
  }

  const result = await createPackageManifest(firmId, periodId, body.manifest, body.expected_piece_count);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, packageId: result.packageId, manifestRevision: result.manifestRevision }, { status: 200 });
}
