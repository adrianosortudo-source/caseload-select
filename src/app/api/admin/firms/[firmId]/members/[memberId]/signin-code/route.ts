/**
 * POST /api/admin/firms/[firmId]/members/[memberId]/signin-code
 *
 * Operator-only. Mints a SHORT sign-in link for a member and returns the URL
 * for the operator to copy and hand out of band (WhatsApp, text) when the
 * magic-link email is quarantined. The short link is /l/{code}; redeeming it
 * mints the normal token and logs the member in. Reusable until expiry (48h).
 *
 * Refuses disabled members (parity with the resend route). The code carries no
 * role or firm in the URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { createSigninCode } from "@/lib/portal-signin-codes";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; memberId: string }> },
) {
  const { firmId, memberId } = await params;
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: member, error } = await supabase
    .from("firm_lawyers")
    .select("id, role, disabled")
    .eq("id", memberId)
    .eq("firm_id", firmId)
    .maybeSingle<{ id: string; role: string; disabled: boolean }>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!member) {
    return NextResponse.json({ error: "member not found" }, { status: 404 });
  }
  if (member.disabled) {
    return NextResponse.json(
      { error: "member is disabled; enable before creating a link" },
      { status: 409 },
    );
  }

  const role: "lawyer" | "operator" = member.role === "operator" ? "operator" : "lawyer";
  const result = await createSigninCode({
    firmId,
    lawyerId: member.id,
    role,
    createdByRole: "operator",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const url = new URL(`/l/${result.code}`, req.url).toString();
  return NextResponse.json({ ok: true, url, expiresAt: result.expiresAt });
}
