/**
 * GET /api/portal/[firmId]/preview/enter?target=lawyer
 * GET /api/portal/[firmId]/preview/enter?target=client&matterId=<id>
 *
 * Operator-only. Sets the signed `portal_preview` cookie (DR-084) and redirects
 * into the target view. While the cookie is set, the operator sees the target's
 * interface with no operator chrome, and the operator-accepting write routes
 * refuse to write. Exit clears the cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { makePreviewCookieValue, type PreviewTarget } from "@/lib/preview-mode";
import { logPreviewOpen } from "@/lib/preview-audit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.redirect(new URL("/portal/login", req.url));
  }

  const targetParam = req.nextUrl.searchParams.get("target");
  const matterId = req.nextUrl.searchParams.get("matterId") ?? undefined;
  const target: PreviewTarget = targetParam === "client" ? "client" : "lawyer";
  if (target === "client" && !matterId) {
    return NextResponse.json({ error: "matterId is required for a client preview" }, { status: 400 });
  }

  const dest =
    target === "client"
      ? new URL(`/portal/${firmId}/m/${matterId}`, req.url)
      : new URL(`/portal/${firmId}/triage`, req.url);

  const res = NextResponse.redirect(dest);
  const cookie = makePreviewCookieValue({
    operator_id: session.lawyer_id ?? "operator",
    firm_id: firmId,
    matter_id: matterId,
    target,
  });
  res.cookies.set(cookie.name, cookie.value, cookie.options);

  await logPreviewOpen({
    operatorId: session.lawyer_id ?? null,
    operatorEmail: null,
    firmId,
    matterId,
    target,
  });

  return res;
}
