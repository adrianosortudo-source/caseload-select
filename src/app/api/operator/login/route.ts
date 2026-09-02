/**
 * GET /api/operator/login?token=...
 *
 * Consumes operator-only magic links, writes the operator session cookie and
 * redirects to the console. Lawyer and client tokens are rejected here.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSessionCookie, verifyPortalToken } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/operator/login?error=missing", req.url));
  }

  const payload = verifyPortalToken(token);
  if (!payload || payload.role !== "operator" || !payload.lawyer_id) {
    return NextResponse.redirect(new URL("/operator/login?error=invalid", req.url));
  }

  // Revalidate the signed identity at consumption time. A valid HMAC proves
  // the link was issued by us, but the member may have been disabled or moved
  // to another role/firm after issuance. Cross-firm access is granted only to
  // a currently active, exact operator membership.
  const { data: operator, error: operatorError } = await supabase
    .from("firm_lawyers")
    .update({ last_signed_in_at: new Date().toISOString() })
    .eq("id", payload.lawyer_id)
    .eq("firm_id", payload.firm_id)
    .eq("role", "operator")
    .eq("disabled", false)
    .select("id")
    .maybeSingle<{ id: string }>();
  if (operatorError) {
    console.error(`[operator-login] membership revalidation failed: ${operatorError.message}`);
  }
  if (!operator) {
    return NextResponse.redirect(new URL("/operator/login?error=invalid", req.url));
  }

  const { name, value, options } = createSessionCookie(payload.firm_id, {
    role: "operator",
    lawyer_id: operator.id,
  });
  const response = NextResponse.redirect(new URL("/admin", req.url));
  response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
  return response;
}
