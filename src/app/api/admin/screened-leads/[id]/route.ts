/**
 * DELETE /api/admin/screened-leads/[id]
 *
 * Operator-only. Hard-delete one lead. Leads with status='taken' are
 * protected (a client_matters row links back to them); the route returns 409
 * for those, directing the operator to archive instead. Inbound FKs are
 * ON DELETE SET NULL, so a permitted delete never cascades or errors.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { deleteLead } from "@/lib/screened-lead-admin";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await deleteLead({ id });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
