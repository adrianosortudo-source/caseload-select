/**
 * /admin/prospects
 *
 * Serves the self-contained GTA prospect-list artifact (the exact browsable
 * HTML the operator has been using) as an operator-gated full page, reachable
 * from the console nav.
 *
 * Deliberately standalone: it returns one bundled HTML string. It does not
 * touch the agency CRM, the screen engine, or any other tool, holds no shared
 * state, and links to nothing. The prospect list is an independent research
 * surface, integrated into the console only by being reachable here.
 *
 * The HTML lives in prospects-content.ts (imported so the bundler always ships
 * it, dev and Vercel alike). Refreshing the list is a regenerate-and-redeploy,
 * not a runtime data source; see prospects-content.ts for the refresh steps.
 *
 * This is a route handler (not a page) so the artifact renders full-bleed with
 * its own filters and table, without the admin React shell wrapping it. Auth is
 * enforced here explicitly, because route handlers bypass the /admin layout gate.
 * It is a plain GET navigation, not framed, so the main app's frame-blocking
 * headers (frame-ancestors 'none' / X-Frame-Options: DENY) do not affect it.
 */
import { NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { PROSPECTS_HTML } from "./prospects-content";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await getOperatorSession())) {
    return NextResponse.redirect(new URL("/portal/login?error=missing", req.url));
  }
  return new NextResponse(PROSPECTS_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
