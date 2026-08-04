import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { clearOperatorWorkspaceCookie, getOperatorWorkspace } from "@/lib/operator-workspace";

export async function GET(req: NextRequest, { params }: { params: Promise<{ firmId: string }> }) {
  const { firmId } = await params;
  const session = await getOperatorSession();
  const workspace = await getOperatorWorkspace(firmId);
  const response = NextResponse.redirect(new URL("/admin", req.url));
  response.cookies.set(clearOperatorWorkspaceCookie());
  if (session && workspace) console.info("[operator-workspace] exited", { operatorId: session.lawyer_id ?? null, firmId, destination: "/admin" });
  return response;
}
