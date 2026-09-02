/**
 * POST /api/portal/logout
 *
 * Clears the portal session cookie and redirects to the login page.
 *
 * Clears the cookie at BOTH "/" and "/portal" paths to handle the transition
 * window (cookies set before the path widening from "/portal" to "/" coexist
 * with new cookies until cleared). Browsers treat (name, path) as the cookie
 * identity, so each path needs its own delete-cookie.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const response = NextResponse.redirect(new URL("/portal/login", req.url));
  const baseOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 0,
  };
  response.cookies.set("portal_session", "", { ...baseOptions, path: "/" });
  response.headers.append(
    "Set-Cookie",
    `portal_session=; Path=/portal; Max-Age=0; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
  return response;
}
