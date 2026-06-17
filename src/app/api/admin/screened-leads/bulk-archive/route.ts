/**
 * POST /api/admin/screened-leads/bulk-archive
 *
 * Operator-only. Archive finalised leads (passed / referred / declined) older
 * than N days. Never touches triaging or taken leads. Body:
 *   { olderThanDays: number, firmId?: string }
 * Returns { ok, count }.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOperatorSession } from "@/lib/portal-auth";
import { bulkArchiveOlderThan } from "@/lib/screened-lead-admin";
import { isValidOlderThanDays } from "@/lib/screened-lead-admin-pure";

export async function POST(req: NextRequest) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { olderThanDays?: unknown; firmId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isValidOlderThanDays(body.olderThanDays)) {
    return NextResponse.json(
      { error: "olderThanDays must be a number between 0 and 3650" },
      { status: 400 },
    );
  }
  const firmId = typeof body.firmId === "string" && body.firmId ? body.firmId : null;

  const result = await bulkArchiveOlderThan({
    days: body.olderThanDays,
    role: session.role,
    firmId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  return NextResponse.json({ ok: true, count: result.count });
}
