/**
 * GET /api/portal/[firmId]/preview/exit
 *
 * Clears the `portal_preview` cookie (DR-084) and returns the operator to the
 * console. Safe to call with no cookie set.
 */

import { NextRequest, NextResponse } from "next/server";
import { clearPreviewCookieValue } from "@/lib/preview-mode";

export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/admin", req.url));
  const cookie = clearPreviewCookieValue();
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
