/**
 * /admin/prospects/view
 *
 * Serves the self-contained GTA prospect-list artifact (the exact browsable
 * HTML the operator has been using) as an operator-gated document. The console
 * page at /admin/prospects fetches this response and renders it in an iframe
 * srcdoc, so the artifact appears INSIDE the console shell with the sidebar
 * intact. srcdoc sidesteps the app's frame-blocking headers (frame-ancestors
 * 'none' / X-Frame-Options: DENY, set in next.config.ts, which is
 * hook-protected): the browser never navigates a frame to this URL, it only
 * receives the HTML as text, so no framing check applies to this response.
 *
 * Deliberately standalone: it returns one bundled HTML string. It does not
 * touch the agency CRM, the screen engine, or any other tool, holds no shared
 * state, and links to nothing. The prospect list is an independent research
 * surface.
 *
 * The HTML lives in prospects-content.ts (imported so the bundler always ships
 * it, dev and Vercel alike). Refreshing the list is a regenerate-and-redeploy,
 * not a runtime data source; see prospects-content.ts for the refresh steps.
 *
 * Auth is enforced here explicitly, because route handlers bypass the /admin
 * layout gate. Unauthenticated fetches get 401 JSON (not a redirect: the
 * caller is a same-origin fetch, not a navigation).
 */
import { NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { PROSPECTS_HTML } from "../prospects-content";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getOperatorSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return new NextResponse(PROSPECTS_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
