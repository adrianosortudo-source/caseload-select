import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import {
  exchangeGhlAuthorizationCode,
  GHL_OAUTH_STATE_COOKIE,
  ghlOauthConfig,
  persistGhlOauthInstallation,
  verifyGhlOauthState,
} from "@/lib/voice-screen-ghl-oauth";

function responseWithClearedState(response: NextResponse) {
  response.cookies.set(GHL_OAUTH_STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;
  const config = ghlOauthConfig();
  if (!config || new URL(config.redirectUri).origin !== req.nextUrl.origin) {
    return responseWithClearedState(NextResponse.json({ error: "ghl_oauth_unconfigured" }, { status: 503 }));
  }
  const code = req.nextUrl.searchParams.get("code") ?? "";
  const state = req.nextUrl.searchParams.get("state") ?? "";
  if (code.length < 1 || code.length > 4096 || !verifyGhlOauthState(state, req.cookies.get(GHL_OAUTH_STATE_COOKIE)?.value, config.stateSecret, config.locationId)) {
    return responseWithClearedState(NextResponse.json({ error: "invalid_oauth_callback" }, { status: 400 }));
  }
  try {
    const token = await exchangeGhlAuthorizationCode(code, config);
    await persistGhlOauthInstallation(token, config);
    return responseWithClearedState(NextResponse.redirect(new URL("/admin/voice-screen?ghl=connected", req.nextUrl.origin)));
  } catch {
    return responseWithClearedState(NextResponse.json({ error: "ghl_oauth_connect_failed" }, { status: 503 }));
  }
}
