/**
 * POST /api/admin/screened-leads/[id]/archive
 *
 * Operator-only. Soft-archive or restore one lead. Body { archived: boolean }.
 * Archived leads drop out of the Active and History triage views into the
 * Archived view; restoring puts them back.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { archiveLead } from "@/lib/screened-lead-admin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { archived?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.archived !== "boolean") {
    return NextResponse.json({ error: "body.archived must be a boolean" }, { status: 400 });
  }

  const result = await archiveLead({ id, archived: body.archived, role: session.role });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  return NextResponse.json({ ok: true, archived: body.archived });
}
