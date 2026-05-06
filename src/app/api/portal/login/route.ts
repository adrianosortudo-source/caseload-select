/**
 * GET /api/portal/login?token=...
 *
 * Validates the magic-link token, records last_signed_in_at on the
 * firm_lawyers row (when present), sets a 30-day session cookie, and
 * redirects to the appropriate landing surface based on role:
 *
 *   role='operator'  → /admin/triage  (cross-firm queue)
 *   role='lawyer'    → /portal/[firmId]/triage  (firm-scoped queue)
 *
 * Backward compat: legacy tokens without a role default to 'lawyer'.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyPortalToken, createSessionCookie } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/portal/login?error=missing", req.url));
  }

  const payload = verifyPortalToken(token);
  if (!payload) {
    return NextResponse.redirect(new URL("/portal/login?error=invalid", req.url));
  }

  // Record the sign-in moment on the firm_lawyers row if we have one. Best
  // effort — if the row doesn't exist (legacy branding-only flow), skip.
  if (payload.lawyer_id) {
    void supabase
      .from("firm_lawyers")
      .update({ last_signed_in_at: new Date().toISOString() })
      .eq("id", payload.lawyer_id);
  }

  const landingUrl = payload.role === "operator"
    ? new URL("/admin/triage", req.url)
    : new URL(`/portal/${payload.firm_id}/triage`, req.url);

  const { name, value, options } = createSessionCookie(payload.firm_id, {
    role: payload.role,
    lawyer_id: payload.lawyer_id,
  });
  const response = NextResponse.redirect(landingUrl);
  response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
  return response;
}
