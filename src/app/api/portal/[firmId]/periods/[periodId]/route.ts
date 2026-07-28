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
import { parseStrategyBrief } from "@/lib/strategy-brief";
import type { ContentPeriod } from "@/lib/types";

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
    Pick<ContentPeriod, "week_number" | "theme" | "details" | "rationale" | "strategyBrief">
  > = {};
  if ("week_number" in body) {
    if (typeof body.week_number !== "number" || !Number.isInteger(body.week_number) || body.week_number < 1) {
      return NextResponse.json({ error: "week_number must be a positive whole number" }, { status: 400 });
    }
    patch.week_number = body.week_number;
  }
  if ("theme" in body) patch.theme = cleanText(body.theme, 200);
  if ("details" in body) patch.details = cleanText(body.details, 2000);
  if ("rationale" in body) patch.rationale = cleanText(body.rationale, 2000);
  if ("strategyBrief" in body) {
    const strategyBrief = parseStrategyBrief(body.strategyBrief);
    if (strategyBrief === "invalid") {
      return NextResponse.json({ error: "Complete all six Weekly strategic brief fields, or leave them all blank." }, { status: 400 });
    }
    patch.strategyBrief = strategyBrief;
  }

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
