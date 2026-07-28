/**
 * POST /api/portal/[firmId]/periods
 *
 * Operator-only. Create a content-plan week (week number + theme + details +
 * rationale). The firm reads these; only the operator authors them.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { createPeriod } from "@/lib/deliverables";
import { parseStrategyBrief } from "@/lib/strategy-brief";

function cleanText(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s.length ? s : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: {
    week_number?: unknown;
    theme?: unknown;
    details?: unknown;
    rationale?: unknown;
    strategyBrief?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const weekNumber = typeof body.week_number === "number" ? body.week_number : NaN;
  if (!Number.isInteger(weekNumber) || weekNumber < 1) {
    return NextResponse.json({ error: "week_number must be a positive whole number" }, { status: 400 });
  }
  const strategyBrief = parseStrategyBrief(body.strategyBrief);
  if (strategyBrief === "invalid") {
    return NextResponse.json({ error: "Complete all six Weekly strategic brief fields, or leave them all blank." }, { status: 400 });
  }

  const result = await createPeriod({
    firmId,
    weekNumber,
    theme: cleanText(body.theme, 200),
    details: cleanText(body.details, 2000),
    rationale: cleanText(body.rationale, 2000),
    strategyBrief,
    actor: resolved.actor,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, period: result.period });
}
