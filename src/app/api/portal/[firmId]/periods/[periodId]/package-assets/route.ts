/**
 * POST /api/portal/[firmId]/periods/[periodId]/package-assets
 *
 * Registers a new asset candidate. Operator-only (requireOperator, the
 * same session-cookie gate every /api/admin/* and period route in this
 * codebase uses) -- a request also carrying an Authorization: Bearer
 * header (e.g. the Publishing Package Gateway's own credential) grants
 * nothing here: this route never reads that header, only the operator
 * session cookie, matching the gateway's own auth-boundary proof that its
 * credential cannot reach general package APIs.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { registerCandidate } from "@/lib/publishing-package-control-room-mutations";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, periodId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const result = await registerCandidate(firmId, periodId, {
    contentSlotId: body.content_slot_id as string,
    assetRole: body.asset_role as never,
    locale: body.locale as never,
    destination: body.destination as string,
    filename: body.filename as string,
    mimeType: body.mime_type as string,
    byteSize: body.byte_size as number,
    width: body.width as number,
    height: body.height as number,
    sha256: body.sha256 as string,
    altText: body.alt_text as string,
    textPolicy: body.text_policy as never,
    overlayLanguage: (body.overlay_language ?? null) as never,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, assetId: result.assetId }, { status: 200 });
}
