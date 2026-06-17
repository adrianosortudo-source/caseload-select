/**
 * GET  /api/admin/firms/[firmId]/members
 * POST /api/admin/firms/[firmId]/members
 *
 * Operator-only management of a firm's portal access (firm_lawyers rows).
 *
 * GET: list the firm's members.
 * POST: add a member. Body { email, role, displayName?, title? }. On insert
 *       the trg_firm_lawyers_invite trigger emails them a magic-link invite.
 *
 * Auth: operator session only (getOperatorSession). This is a cross-firm
 * console tool; firm and client sessions are rejected.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { listFirmMembers, addFirmMember, type FirmMemberRow } from "@/lib/firm-members";
import { validateMemberInput } from "@/lib/firm-members-pure";

function serialize(m: FirmMemberRow) {
  return {
    id: m.id,
    email: m.email,
    role: m.role,
    display_name: m.display_name,
    title: m.title,
    disabled: m.disabled,
    disabled_at: m.disabled_at,
    invitation_sent_at: m.invitation_sent_at,
    last_signed_in_at: m.last_signed_in_at,
    created_at: m.created_at,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const members = await listFirmMembers(firmId);
    return NextResponse.json({ items: members.map(serialize) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list failed" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { email?: string; role?: string; displayName?: string; title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const v = validateMemberInput({
    email: body.email ?? "",
    role: body.role ?? "",
    displayName: body.displayName ?? null,
    title: body.title ?? null,
  });
  if (!v.ok) {
    return NextResponse.json({ error: v.message, reason: v.reason }, { status: 400 });
  }

  const result = await addFirmMember({
    firmId,
    email: v.email,
    role: v.role,
    displayName: v.displayName,
    title: v.title,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: result.status },
    );
  }

  return NextResponse.json({ member: serialize(result.member) }, { status: 201 });
}
