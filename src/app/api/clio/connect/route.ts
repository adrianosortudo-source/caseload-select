/**
 * GET /api/clio/connect?firm_id=...
 *
 * Starts the Clio OAuth 2.0 flow. Redirects the browser to Clio's auth page.
 * The firm_id is passed as the OAuth state parameter and returned in the callback.
 *
 * Requires portal session auth (firm must be logged in).
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { getClioAuthUrl } from "@/lib/clio";

export async function GET(req: NextRequest) {
  const session = await getPortalSession();
  const firmId = req.nextUrl.searchParams.get("firm_id");

  if (!session || session.firm_id !== firmId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.CLIO_CLIENT_ID || !process.env.CLIO_REDIRECT_URI) {
    return NextResponse.json({ error: "Clio integration not configured" }, { status: 503 });
  }

  return NextResponse.redirect(getClioAuthUrl(firmId));
}
