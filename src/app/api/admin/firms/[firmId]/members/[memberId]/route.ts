/**
 * PATCH /api/admin/firms/[firmId]/members/[memberId]
 *
 * Operator-only. Soft-disable or re-enable a firm member.
 * Body { disabled: boolean }.
 *
 * Disabling stops the member obtaining a NEW magic link (request-link and the
 * operator resend both skip disabled rows). An already-issued session is a
 * stateless 30-day cookie and is not revoked here.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { setFirmMemberDisabled } from "@/lib/firm-members";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; memberId: string }> },
) {
  const { firmId, memberId } = await params;
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { disabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.disabled !== "boolean") {
    return NextResponse.json({ error: "body.disabled must be a boolean" }, { status: 400 });
  }

  const result = await setFirmMemberDisabled({ firmId, memberId, disabled: body.disabled });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }

  return NextResponse.json({
    member: {
      id: result.member.id,
      email: result.member.email,
      role: result.member.role,
      disabled: result.member.disabled,
      disabled_at: result.member.disabled_at,
    },
  });
}
