/**
 * GET /api/admin/portal-link?firmId=xxx
 *
 * Generates a 48-hour magic link for a firm's client portal.
 *
 * Auth: requireOperator() on every call. The route mints a lawyer-grade
 * magic link for ANY firmId, so the gate must live here, not in the UI.
 * "The admin UI is not publicly exposed" is not protection: the route is
 * reachable by anyone who knows the URL. Same doctrine as the Jim Manico
 * audit fixes on /api/admin/domain and /api/admin/firms (APP-001/002).
 * Sole caller is PortalLinkButton on the operator /firms page, which
 * rides the operator session cookie.
 *
 * Returns: { magic_link: string, expires_in_hours: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { generatePortalToken } from "@/lib/portal-auth";
import { requireOperator } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const denied = await requireOperator();
  if (denied) return denied;

  const firmId = req.nextUrl.searchParams.get("firmId");
  if (!firmId) {
    return NextResponse.json({ error: "firmId required" }, { status: 400 });
  }

  const token = generatePortalToken(firmId);
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  const origin = appDomain
    ? `https://app.${appDomain}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : req.nextUrl.origin;

  const magic_link = `${origin}/api/portal/login?token=${encodeURIComponent(token)}`;

  return NextResponse.json({ magic_link, expires_in_hours: 48 });
}
