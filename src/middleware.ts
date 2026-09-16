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
 *   /                  → /widget-public/{firmId} (Screen 2.0 intake widget at the apex of the firm's host)
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
import {
  appOrigin,
  isAppHost,
  isLocalOrPreviewHost,
  isOperatorHost,
  isOperatorUiPath,
  operatorOrigin,
} from "@/lib/app-origins";
import {
  isPrivacyRecoveryProtectedPath,
  PRIVACY_RECOVERY_ROUTE,
  recoveryCircuitIsOpen,
} from "@/lib/privacy-recovery-edge";
import {
  PREVIEW_QA_COOKIE_NAME,
  PREVIEW_QA_BOOTSTRAP_UI_PATH,
  isPreviewQaBootstrapRequest,
  isPreviewQaReadRequest,
} from "@/lib/preview-qa-policy";

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "caseloadselect.ca";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function nextWithTrustedRequestContext(req: NextRequest): NextResponse {
  const requestHeaders = new Headers(req.headers);
  // A client cannot choose its QA allowlist route. This overwrites any inbound
  // values before a server component evaluates the read-only policy.
  requestHeaders.set("x-caseload-request-path", req.nextUrl.pathname);
  requestHeaders.set("x-caseload-request-method", req.method);
  return NextResponse.next({ request: { headers: requestHeaders } });
}
/** Edge-compatible mirror of the server recovery gate. Once the feature is
 * enabled, an absent/malformed breaker response is closed, never assumed open.
 * This catches operational APIs before their route code can enqueue a send or
 * mutate a tenant during restore replay. */
export async function privacyRecoveryApiGate(pathname: string): Promise<NextResponse | null> {
  if (!isPrivacyRecoveryProtectedPath(pathname)) return null;
  if (process.env.PRIVACY_DELETION_REGISTRY_ENABLED !== "true") return null;
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!baseUrl || !token) {
    return NextResponse.json({ error: "privacy recovery circuit is closed" }, { status: 503 });
  }
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/get/${encodeURIComponent("privacy:deletion-registry:v2:recovery-circuit")}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (!response.ok) throw new Error("registry unavailable");
    const body = await response.json() as { result?: unknown };
    if (recoveryCircuitIsOpen(body.result)) return null;
  } catch {
    // The protected default is a 503; do not disclose Redis errors.
  }
  return NextResponse.json({ error: "privacy recovery circuit is closed" }, { status: 503 });
}

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

/**
 * S8 Phase 1 Story 12: branded subdomain lookup.
 *
 * Distinct from custom_domain (full apex like client.drglaw.ca). The
 * subdomain column stores just the leftmost segment ("drglaw" for
 * "drglaw.caseloadselect.ca"). Per-firm unique when set.
 */
async function firmIdForSubdomain(subdomain: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/intake_firms?select=id&subdomain=eq.${encodeURIComponent(subdomain)}&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
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

  // Everything else lands on the intake widget for that firm. /widget-public
  // is the canonical Screen 2.0 surface (/api/intake-v2), the same engine the
  // DRG embed uses; the legacy /widget (v2.1 / /api/screen) is retired for new
  // surfaces. A firm cutting over a custom intake domain must land on the
  // current engine, not the old one.
  const rewriteUrl = req.nextUrl.clone();
  rewriteUrl.pathname = `/widget-public/${firmId}`;
  const response = NextResponse.rewrite(rewriteUrl);
  response.headers.set("x-firm-id", firmId);
  return response;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const hostname = req.nextUrl.hostname;
  const { pathname, search } = req.nextUrl;

  const recoveryGate = await privacyRecoveryApiGate(pathname);
  if (recoveryGate) return recoveryGate;

  // A QA cookie is an unambiguous read-only principal. It cannot navigate to a
  // different console page through an RSC request or use an unsafe method.
  // The bootstrap exception lets a browser replace its short-lived credential.
  if (req.cookies.has(PREVIEW_QA_COOKIE_NAME)
    && !isPreviewQaReadRequest(pathname, req.method)
    && !isPreviewQaBootstrapRequest(pathname, req.method)) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // The server component independently verifies the preview-only environment.
  // These headers keep the exact bootstrap UI out of caches and search results
  // before that component can render, including its intentional 404 elsewhere.
  if (pathname === PREVIEW_QA_BOOTSTRAP_UI_PATH) {
    const response = nextWithTrustedRequestContext(req);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  // Local dev + Vercel preview URLs → pass through
  if (isLocalOrPreviewHost(hostname)) {
    return nextWithTrustedRequestContext(req);
  }

  // Keep browser navigation on the origin that owns its host-only session.
  // Only UI GET/HEAD surfaces redirect here: cookie-writing POST routes enforce
  // their host in the route handler so a redirect can never replay a body or
  // turn an unsafe cross-origin request into an authenticated mutation.
  if (req.method === "GET" || req.method === "HEAD") {
    if (!isOperatorHost(hostname) && isOperatorUiPath(pathname)) {
      return NextResponse.redirect(new URL(`${pathname}${search}`, operatorOrigin()));
    }
    if (isOperatorHost(hostname) && pathname === "/") {
      return NextResponse.redirect(new URL(`/admin${search}`, operatorOrigin()));
    }
    if (isOperatorHost(hostname) && pathname === "/portal/login") {
      return NextResponse.redirect(new URL(`${pathname}${search}`, appOrigin()));
    }
  }

  // The operator origin is deliberately noindex, including portal previews
  // and shared API responses that cannot be represented in robots.txt alone.
  if (isOperatorHost(hostname)) {
    const response = nextWithTrustedRequestContext(req);
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    return response;
  }

  // Apex of the main app domain → pass through (marketing site)
  if (hostname === APP_DOMAIN) {
    return nextWithTrustedRequestContext(req);
  }

  // Subdomain under the main app domain
  if (hostname.endsWith(`.${APP_DOMAIN}`)) {
    const subdomain = hostname.slice(0, hostname.length - APP_DOMAIN.length - 1);

    // Reserved subdomains run the main app untouched
    if (RESERVED_SUBDOMAINS.has(subdomain)) {
      return nextWithTrustedRequestContext(req);
    }

    // S8 Phase 1 Story 12: try the branded-subdomain column first
    // (the new path; just the segment is stored). Fall back to the
    // legacy custom_domain match (full hostname) if no subdomain row
    // exists. This lets old custom_domain firms keep working
    // unchanged while new firms onboard via the subdomain column.
    let firmId = await firmIdForSubdomain(subdomain);
    if (!firmId) firmId = await firmIdForDomain(hostname);
    if (!firmId) return nextWithTrustedRequestContext(req);
    return rewriteForFirm(req, firmId);
  }

  // Fully custom domain (firm's own apex or subdomain)
  const firmId = await firmIdForDomain(hostname);
  if (!firmId) return nextWithTrustedRequestContext(req);
  return rewriteForFirm(req, firmId);
}

export const config = {
  matcher: [
    // QA access is a principal-wide capability boundary.  It must see static
    // paths too, so a QA cookie cannot bypass the safe-method rule merely by
    // targeting a route that resembles an asset.  preview-qa-policy grants
    // only the exact runtime assets required to render an allowlisted page.
    "/:path*",
  ],
};
