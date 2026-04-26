/**
 * POST /api/portal/generate
 *
 * Operator-only endpoint. Adriano calls this to generate a magic link for a firm.
 * The link is valid for 48 hours. Clicking it sets a 30-day session cookie.
 *
 * Auth: Bearer CRON_SECRET (same secret used for cron jobs)
 *
 * Body: { firm_id: string, base_url?: string }
 * Returns: { magic_link: string, expires_in_hours: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { generatePortalToken } from "@/lib/portal-auth";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { firm_id, base_url } = await req.json() as { firm_id?: string; base_url?: string };
  if (!firm_id) {
    return NextResponse.json({ error: "firm_id required" }, { status: 400 });
  }

  const token = generatePortalToken(firm_id);
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  const defaultOrigin = base_url
    ?? (appDomain ? `https://app.${appDomain}` : null)
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const magic_link = `${defaultOrigin}/api/portal/login?token=${encodeURIComponent(token)}`;

  return NextResponse.json({ magic_link, expires_in_hours: 48 });
}
