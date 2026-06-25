/**
 * GET /l/[code]
 *
 * Short sign-in link. Resolves the opaque code to its firm + member, mints the
 * normal HMAC portal token server-side, and redirects into the existing
 * /api/portal/login flow (which sets the session cookie and lands the member).
 *
 * The code is the credential. It carries no role or firm in the URL, so a
 * shared short link leaks nothing about the firm until it is redeemed. Expired
 * or unknown codes land on the login page with a calm message.
 *
 * Runs on app.caseloadselect.ca, where the middleware passes /l/ through (the
 * "app" subdomain is reserved, so no firm rewrite intercepts it).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveSigninCode } from "@/lib/portal-signin-codes";
import { generatePortalToken } from "@/lib/portal-auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const target = await resolveSigninCode(code);
  if (!target) {
    return NextResponse.redirect(new URL("/portal/login?error=expired", req.url));
  }

  const token = generatePortalToken(target.firmId, {
    role: target.role,
    lawyer_id: target.lawyerId ?? undefined,
  });

  const loginUrl = new URL("/api/portal/login", req.url);
  loginUrl.searchParams.set("token", token);
  return NextResponse.redirect(loginUrl);
}
