/**
 * GET /api/dev/login?redirect=/admin/seo-check
 *
 * Local-only fixture. Establishes an operator session cookie without a real
 * magic link, so authenticated operator surfaces (Recent saved scans,
 * Download PDF, any /admin/* page) can be smoke-tested end-to-end on a
 * developer's machine without real credentials. Every prior operator-flow
 * verification in this codebase's history had to stop short of the
 * authenticated path for exactly this reason.
 *
 * Hard double-gated so this can never work on a real deployment:
 *   - `process.env.VERCEL` is set on every Vercel build (production AND
 *     preview), so any Vercel-hosted instance 404s unconditionally.
 *   - `NODE_ENV === "production"` also 404s, covering any non-Vercel
 *     production-mode run (e.g. `next start` after `next build` locally).
 * Only `next dev` on a local machine, with neither flag set, passes.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSessionCookie } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

// Nil UUID: an obviously-fake firm id. Operator sessions are cross-firm, so
// firm_id on the token is only informational (which firm the operator last
// switched into), never an access boundary for the operator role.
const DEV_FIXTURE_FIRM_ID = "00000000-0000-0000-0000-000000000000";

export async function GET(req: NextRequest) {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  const redirectPath = req.nextUrl.searchParams.get("redirect") || "/admin/seo-check";
  // Same-origin path only: never let this become an open redirect.
  const safePath = redirectPath.startsWith("/") && !redirectPath.startsWith("//") ? redirectPath : "/admin/seo-check";

  const { name, value, options } = createSessionCookie(DEV_FIXTURE_FIRM_ID, { role: "operator" });
  const response = NextResponse.redirect(new URL(safePath, req.url));
  response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
  return response;
}
