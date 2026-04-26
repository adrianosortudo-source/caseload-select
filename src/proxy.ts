/**
 * Next.js proxy (edge middleware)  -  host-based routing for white-label custom domains.
 *
 * When a request arrives on a custom domain (not the main app domain),
 * the proxy looks up the firm by custom_domain in Supabase, then rewrites:
 *
 *   custom-domain.com/          → /widget/{firmId}   (intake widget)
 *   custom-domain.com/portal    → /portal/{firmId}   (client portal)
 *   custom-domain.com/portal/*  → /portal/{firmId}/* (portal sub-routes)
 *
 * Main domain routes pass through untouched.
 *
 * The Supabase lookup uses a 60-second edge cache so the DB is not hit
 * on every request for the same domain.
 */

import { NextRequest, NextResponse } from "next/server";

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "caseloadselect.ca";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

async function firmIdForDomain(hostname: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/intake_firms?select=id&custom_domain=eq.${encodeURIComponent(hostname)}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      // Edge cache: re-validate every 60 seconds
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function proxy(req: NextRequest) {
  const hostname = req.headers.get("host")?.split(":")[0] ?? "";

  // Pass through main app domain and Vercel preview URLs
  if (
    hostname === APP_DOMAIN ||
    hostname.endsWith(`.${APP_DOMAIN}`) ||
    hostname.endsWith(".vercel.app") ||
    hostname === "localhost"
  ) {
    return NextResponse.next();
  }

  // Custom domain  -  look up firm
  const firmId = await firmIdForDomain(hostname);
  if (!firmId) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Rewrite portal paths
  if (pathname === "/portal" || pathname.startsWith("/portal/")) {
    const rest = pathname.slice("/portal".length) || "";
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = `/portal/${firmId}${rest}`;
    const response = NextResponse.rewrite(rewriteUrl);
    response.headers.set("x-firm-id", firmId);
    return response;
  }

  // Rewrite everything else to the intake widget
  const rewriteUrl = req.nextUrl.clone();
  rewriteUrl.pathname = `/widget/${firmId}`;
  const response = NextResponse.rewrite(rewriteUrl);
  response.headers.set("x-firm-id", firmId);
  return response;
}

export const config = {
  matcher: [
    // Run on all paths except Next.js internals and static assets
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
