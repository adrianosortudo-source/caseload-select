import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { clearPreviewCookieValue } from "@/lib/preview-mode";
import { makeOperatorWorkspaceCookie, isSafeWorkspaceDestination } from "@/lib/operator-workspace";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";

export async function GET(req: NextRequest, { params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params;
  const session = await getOperatorSession();
  if (!session) return NextResponse.redirect(new URL("/portal/login", req.url));

  const { data: firm } = await supabase.from("intake_firms").select("id").eq("id", firmId).maybeSingle();
  if (!firm) return NextResponse.json({ error: "firm not found" }, { status: 404 });

  const requested = req.nextUrl.searchParams.get("next");
  const destination = requested && isSafeWorkspaceDestination(requested, firmId)
    ? requested
    : `/portal/${firmId}/triage`;
  const response = NextResponse.redirect(new URL(destination, req.url));
  response.cookies.set(makeOperatorWorkspaceCookie({ operatorId: session.lawyer_id ?? "operator", firmId }));
  response.cookies.set(clearPreviewCookieValue());
  console.info("[operator-workspace] entered", { operatorId: session.lawyer_id ?? null, firmId, destination });
  return response;
}
