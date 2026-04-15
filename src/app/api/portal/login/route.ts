/**
 * GET /api/portal/login?token=...
 *
 * Validates the magic link token, sets a 30-day session cookie,
 * then redirects to /portal/[firmId].
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyPortalToken, createSessionCookie } from "@/lib/portal-auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/portal/login?error=missing", req.url));
  }

  const payload = verifyPortalToken(token);
  if (!payload) {
    return NextResponse.redirect(new URL("/portal/login?error=invalid", req.url));
  }

  const { name, value, options } = createSessionCookie(payload.firm_id);
  const response = NextResponse.redirect(new URL(`/portal/${payload.firm_id}`, req.url));
  response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
  return response;
}
