/**
 * GET /api/operator/login?token=...
 *
 * Consumes operator-only magic links, writes the operator session cookie and
 * redirects to the console. Lawyer and client tokens are rejected here.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createSessionCookie,
  revalidateOperatorMembership,
  verifyPortalToken,
} from "@/lib/portal-auth";
import { isLocalOrPreviewHost, isOperatorHost, operatorOrigin } from "@/lib/app-origins";

function operatorUrl(req: NextRequest, pathname: string): URL {
  const hostname = req.nextUrl.hostname;
  const base = isLocalOrPreviewHost(hostname) ? req.nextUrl.origin : operatorOrigin();
  return new URL(pathname, base);
}

export async function GET(req: NextRequest) {
  const hostname = req.nextUrl.hostname;
  if (!isLocalOrPreviewHost(hostname) && !isOperatorHost(hostname)) {
    return NextResponse.redirect(
      new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, operatorOrigin()),
    );
  }

  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(operatorUrl(req, "/operator/login?error=missing"));
  }

  const payload = verifyPortalToken(token);
  if (!payload || payload.role !== "operator" || !payload.lawyer_id) {
    return NextResponse.redirect(operatorUrl(req, "/operator/login?error=invalid"));
  }

  const operator = await revalidateOperatorMembership(payload, { recordSignIn: true });
  if (!operator) {
    return NextResponse.redirect(operatorUrl(req, "/operator/login?error=invalid"));
  }

  const { name, value, options } = createSessionCookie(payload.firm_id, {
    role: "operator",
    lawyer_id: operator.id,
  });
  const response = NextResponse.redirect(operatorUrl(req, "/admin"));
  response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
  return response;
}
