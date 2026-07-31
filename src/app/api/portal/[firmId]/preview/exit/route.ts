/**
 * GET /api/portal/[firmId]/preview/exit
 *
 * Clears the `portal_preview` cookie (DR-084) and returns the operator to the
 * console. Safe to call with no cookie set.
 */

import { NextRequest, NextResponse } from "next/server";
import { clearPreviewCookieValue } from "@/lib/preview-mode";
import { getOperatorSession } from "@/lib/portal-auth";

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/admin", req.url));
  const session = await getOperatorSession();
  const cookie = clearPreviewCookieValue();
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  if (session) console.info("[operator-workspace] switched to lawyer preview exited", { operatorId: session.lawyer_id ?? null, destination: "/admin" });
  return res;
}
