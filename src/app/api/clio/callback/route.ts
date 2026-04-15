/**
 * GET /api/clio/callback?code=...&state=...
 *
 * Clio OAuth callback. Exchanges the authorization code for tokens,
 * stores them in intake_firms.clio_config, then redirects to the portal.
 *
 * The state parameter contains the firm_id (set in /api/clio/connect).
 */

import { NextRequest, NextResponse } from "next/server";
import { exchangeClioCode, saveClioTokens } from "@/lib/clio";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const firmId = req.nextUrl.searchParams.get("state");

  if (!code || !firmId) {
    return NextResponse.redirect(new URL(`/portal/${firmId ?? ""}?clio=error`, req.url));
  }

  try {
    const tokens = await exchangeClioCode(code);
    await saveClioTokens(firmId, tokens);
    return NextResponse.redirect(new URL(`/portal/${firmId}?clio=connected`, req.url));
  } catch (err) {
    console.error("[clio/callback] token exchange failed:", err);
    return NextResponse.redirect(new URL(`/portal/${firmId}?clio=error`, req.url));
  }
}
