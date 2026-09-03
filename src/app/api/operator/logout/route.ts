/**
 * POST /api/operator/logout
 *
 * Clears the shared portal session cookie and returns to operator sign in.
 */

import { NextRequest, NextResponse } from "next/server";
import { clearOperatorWorkspaceCookie } from "@/lib/operator-workspace";
import { clearPreviewCookieValue } from "@/lib/preview-mode";
import { isLocalOrPreviewHost, isOperatorHost, operatorOrigin } from "@/lib/app-origins";

export async function POST(req: NextRequest) {
  const hostname = req.nextUrl.hostname;
  if (!isLocalOrPreviewHost(hostname) && !isOperatorHost(hostname)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const base = isLocalOrPreviewHost(hostname) ? req.nextUrl.origin : operatorOrigin();
  const response = NextResponse.redirect(new URL("/operator/login", base));
  const baseOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 0,
  };
  response.cookies.set("portal_session", "", { ...baseOptions, path: "/" });
  const preview = clearPreviewCookieValue();
  response.cookies.set(preview.name, preview.value, preview.options);
  const workspace = clearOperatorWorkspaceCookie();
  response.cookies.set(workspace.name, workspace.value, workspace.options);
  // ResponseCookies keys by name, so calling cookies.set twice for the same
  // cookie drops the first path. Append the legacy path explicitly after all
  // distinct cookies have been set.
  response.headers.append(
    "Set-Cookie",
    `portal_session=; Path=/portal; Max-Age=0; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
  return response;
}
