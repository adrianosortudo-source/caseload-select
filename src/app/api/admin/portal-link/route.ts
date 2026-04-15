/**
 * GET /api/admin/portal-link?firmId=xxx
 *
 * Generates a 48-hour magic link for a firm's client portal.
 * Admin-only. No external auth required (admin UI is not publicly exposed).
 *
 * Returns: { magic_link: string, expires_in_hours: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { generatePortalToken } from "@/lib/portal-auth";

export async function GET(req: NextRequest) {
  const firmId = req.nextUrl.searchParams.get("firmId");
  if (!firmId) {
    return NextResponse.json({ error: "firmId required" }, { status: 400 });
  }

  const token = generatePortalToken(firmId);
  const origin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : req.nextUrl.origin;

  const magic_link = `${origin}/api/portal/login?token=${encodeURIComponent(token)}`;

  return NextResponse.json({ magic_link, expires_in_hours: 48 });
}
