/**
 * GET /api/portal/[firmId]/standing-authorization
 *
 * Current standing publishing authorization state for this firm. Readable
 * by the firm's lawyer session or an operator (read-only, matching the
 * operator-view convention elsewhere in the portal) -- but see enable/
 * disable in the sibling routes, which are lawyer-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { getStandingAuthorizationState } from "@/lib/standing-publishing-authorization";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getPortalSession();
  if (!session || session.role === "client") {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (session.role === "lawyer" && session.firm_id !== firmId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const state = await getStandingAuthorizationState(firmId);
  return NextResponse.json({
    ok: true,
    active: state?.active ?? false,
    latestEvent: state?.latestEvent ?? null,
  });
}
