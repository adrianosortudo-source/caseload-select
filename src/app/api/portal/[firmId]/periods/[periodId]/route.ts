/**
 * PATCH  /api/portal/[firmId]/periods/[periodId]   update a week's fields
 * DELETE /api/portal/[firmId]/periods/[periodId]   remove a week (deliverables
 *                                                  in it unassign automatically)
 *
 * Operator-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { updatePeriod, deletePeriod } from "@/lib/deliverables";
import type { ContentPeriod } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s.length ? s : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const { firmId, periodId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const patch: Partial<
    Pick<ContentPeriod, "starts_on" | "ends_on" | "theme" | "details" | "rationale">
  > = {};
  if (typeof body.starts_on === "string") {
    if (!DATE_RE.test(body.starts_on)) {
      return NextResponse.json({ error: "starts_on must be YYYY-MM-DD" }, { status: 400 });
    }
    patch.starts_on = body.starts_on;
  }
  if (typeof body.ends_on === "string") {
    if (!DATE_RE.test(body.ends_on)) {
      return NextResponse.json({ error: "ends_on must be YYYY-MM-DD" }, { status: 400 });
    }
    patch.ends_on = body.ends_on;
  }
  if (patch.starts_on && patch.ends_on && patch.ends_on < patch.starts_on) {
    return NextResponse.json({ error: "ends_on must be on or after starts_on" }, { status: 400 });
  }
  if ("theme" in body) patch.theme = cleanText(body.theme, 200);
  if ("details" in body) patch.details = cleanText(body.details, 2000);
  if ("rationale" in body) patch.rationale = cleanText(body.rationale, 2000);

  const result = await updatePeriod({ periodId, firmId, patch });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, period: result.period });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const { firmId, periodId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await deletePeriod({ periodId, firmId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
