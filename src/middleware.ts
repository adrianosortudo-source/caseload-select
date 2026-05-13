/**
 * Next.js edge middleware — host-based routing for the multi-tenant portal.
 *
 * The app serves three classes of hostname:
 *
 *   1. Apex + reserved subdomains under the main app domain:
 *        caseloadselect.ca           (marketing site, future)
 *        app.caseloadselect.ca       (main operator app — current production)
 *        www.caseloadselect.ca       (marketing site / redirect, future)
 *        api.caseloadselect.ca       (reserved)
 *        staging.caseloadselect.ca   (reserved)
 *        preview.caseloadselect.ca   (reserved)
 *      → pass through, normal Next.js routing
 *
 *   2. Firm subdomains under the main app domain:
 *        drglaw.caseloadselect.ca
 *        kennylaw.caseloadselect.ca
 *      → look up firm in intake_firms.custom_domain, rewrite to /portal/{firmId}
 *
 *   3. Fully custom domains (firm owns the domain):
 *        client.drglaw.ca
 *        intake.kennylaw.com
 *      → look up firm in intake_firms.custom_domain, rewrite to /portal/{firmId}
 *
 * Rewrite map (for both class-2 and class-3 hosts):
 *   /                  → /widget/{firmId}        (intake widget at the apex of the firm's host)
 *   /portal            → /portal/{firmId}        (client portal)
 *   /portal/*          → /portal/{firmId}/*      (portal sub-routes)
 *
 * The Supabase lookup uses Next.js's `revalidate: 60` so the same hostname only
 * hits the database once a minute.
 *
 * Migrated from src/proxy.ts on 2026-05-13. The proxy.ts file was never wired
 * into the request pipeline (Next.js middleware requires the file to be named
 * `middleware.ts` and the function exported as `middleware`); this is the
 * activation pass.
 */

import { NextRequest, NextResponse } from "next/server";

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "caseloadselect.ca";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Subdomains under APP_DOMAIN that are NOT firm portals. Anything else under
// APP_DOMAIN is treated as a firm subdomain and looked up against intake_firms.
const RESERVED_SUBDOMAINS = new Set([
  "app",
  "www",
  "api",
  "staging",
  "preview",
  "admin",
]);

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

function rewriteForFirm(req: NextRequest, firmId: string): NextResponse {
  const { pathname } = req.nextUrl;

  // Portal paths
  if (pathname === "/portal" || pathname.startsWith("/portal/")) {
    const rest = pathname.slice("/portal".length) || "";
    const rewriteUrl = req.nextUrl.clone();
    rewriteUrl.pathname = `/portal/${firmId}${rest}`;
    const response = NextResponse.rewrite(rewriteUrl);
    response.headers.set("x-firm-id", firmId);
    return response;
  }

  // Everything else lands on the intake widget for that firm
  const rewriteUrl = req.nextUrl.clone();
  rewriteUrl.pathname = `/widget/${firmId}`;
  const response = NextResponse.rewrite(rewriteUrl);
  response.headers.set("x-firm-id", firmId);
  return response;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const hostname = req.headers.get("host")?.split(":")[0] ?? "";

  // Local dev + Vercel preview URLs → pass through
  if (hostname === "localhost" || hostname.endsWith(".vercel.app")) {
    return NextResponse.next();
  }

  // Apex of the main app domain → pass through (marketing site)
  if (hostname === APP_DOMAIN) {
    return NextResponse.next();
  }

  // Subdomain under the main app domain
  if (hostname.endsWith(`.${APP_DOMAIN}`)) {
    const subdomain = hostname.slice(0, hostname.length - APP_DOMAIN.length - 1);

    // Reserved subdomains run the main app untouched
    if (RESERVED_SUBDOMAINS.has(subdomain)) {
      return NextResponse.next();
    }

    // Firm subdomain — look up firm by exact hostname match
    const firmId = await firmIdForDomain(hostname);
    if (!firmId) return NextResponse.next();
    return rewriteForFirm(req, firmId);
  }

  // Fully custom domain (firm's own apex or subdomain)
  const firmId = await firmIdForDomain(hostname);
  if (!firmId) return NextResponse.next();
  return rewriteForFirm(req, firmId);
}

export const config = {
  matcher: [
    // Run on all paths except Next.js internals and static assets
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
