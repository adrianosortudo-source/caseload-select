/**
 * GET /api/portal/login?token=...
 *
 * Validates the magic-link token, records last_signed_in_at on the
 * firm_lawyers row (when present), sets a 30-day session cookie, and
 * redirects to the appropriate firm-scoped landing surface:
 *
 *   role='lawyer'    → /portal/[firmId]/triage
 *   role='client'    → /portal/[firmId]/triage (matter page routing follows)
 *
 * Operator tokens are rejected here. They have a dedicated consumer at
 * /api/operator/login that revalidates active operator membership.
 *
 * Backward compat: legacy tokens without a role default to 'lawyer'.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyPortalToken, createSessionCookie } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  appOrigin,
  isAppHost,
  isLocalOrPreviewHost,
  operatorOrigin,
} from "@/lib/app-origins";

function appUrl(req: NextRequest, pathname: string): URL {
  const base = isLocalOrPreviewHost(req.nextUrl.hostname) ? req.nextUrl.origin : appOrigin();
  return new URL(pathname, base);
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(appUrl(req, "/portal/login?error=missing"));
  }

  const payload = verifyPortalToken(token);
  if (!payload) {
    return NextResponse.redirect(appUrl(req, "/portal/login?error=invalid"));
  }
  if (payload.role === "operator") {
    // Preserve unexpired operator links issued before the routes were split.
    // The dedicated consumer performs current membership revalidation before
    // granting the cross-firm session.
    const operatorBase = isLocalOrPreviewHost(req.nextUrl.hostname)
      ? req.nextUrl.origin
      : operatorOrigin();
    const operatorConsumer = new URL("/api/operator/login", operatorBase);
    operatorConsumer.searchParams.set("token", token);
    return NextResponse.redirect(operatorConsumer);
  }

  // A lawyer/client token that reaches the operator origin must not write a
  // firm session cookie there. Re-run the same callback on the app origin so
  // the host-only cookie is scoped to the portal that owns it.
  if (!isLocalOrPreviewHost(req.nextUrl.hostname) && !isAppHost(req.nextUrl.hostname)) {
    const appConsumer = new URL("/api/portal/login", appOrigin());
    appConsumer.searchParams.set("token", token);
    return NextResponse.redirect(appConsumer);
  }

  // Record the sign-in moment on the firm_lawyers row if we have one. This must
  // be awaited: a Supabase query builder is lazy, so the prior `void` form never
  // executed (the request only fires on await or .then), which is why the access
  // page status never flipped from Invited to Active. Awaiting also guarantees
  // the write lands before the serverless function returns the redirect. The
  // builder resolves with { error } rather than throwing, so no try/catch is
  // needed; a row that does not exist (legacy branding-only flow) is a no-op.
  if (payload.lawyer_id) {
    await supabase
      .from("firm_lawyers")
      .update({ last_signed_in_at: new Date().toISOString() })
      .eq("id", payload.lawyer_id);
  }

  const landingUrl = appUrl(req, `/portal/${payload.firm_id}/triage`);

  const { name, value, options } = createSessionCookie(payload.firm_id, {
    role: payload.role,
    lawyer_id: payload.lawyer_id,
  });
  const response = NextResponse.redirect(landingUrl);
  response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
  return response;
}
