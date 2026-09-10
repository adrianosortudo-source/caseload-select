import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { createGhlOauthState, GHL_OAUTH_STATE_COOKIE, ghlAuthorizationUrl, ghlOauthConfig } from "@/lib/voice-screen-ghl-oauth";

export async function GET(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const config = ghlOauthConfig();
  if (!config || new URL(config.redirectUri).origin !== req.nextUrl.origin) return NextResponse.json({ error: "ghl_oauth_unconfigured" }, { status: 503 });
  const state = createGhlOauthState(config.stateSecret, config.locationId);
  const response = NextResponse.redirect(ghlAuthorizationUrl(config, state));
  response.cookies.set(GHL_OAUTH_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
