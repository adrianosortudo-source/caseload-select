/**
 * POST /api/portal/logout
 *
 * Clears the portal session cookie and redirects to the login page.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const firmId = req.nextUrl.searchParams.get("firm_id");
  const response = NextResponse.redirect(new URL("/portal/login", req.url));
  response.cookies.set("portal_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/portal",
    maxAge: 0,
  });
  return response;
}
