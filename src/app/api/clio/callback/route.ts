/**
 * GET /api/clio/callback?code=...&state=...
 *
 * Clio OAuth callback. Exchanges the authorization code for tokens,
 * stores them in intake_firms.clio_config, then redirects to the portal.
 *
 * The state parameter contains the firm_id (set in /api/clio/connect).
 */

import { NextRequest, NextResponse } from "next/server";
import { exchangeClioCode, saveClioTokens, verifyClioState } from "@/lib/clio";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  // The firm is taken from the SIGNED state, not the raw query value. An
  // unverifiable state cannot bind tokens to a firm we did not initiate the
  // flow for. We do not echo an untrusted firmId into the redirect URL.
  const firmId = verifyClioState(req.nextUrl.searchParams.get("state"));

  if (!firmId) {
    return NextResponse.redirect(new URL(`/portal/login?clio=error`, req.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL(`/portal/${firmId}?clio=error`, req.url));
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
