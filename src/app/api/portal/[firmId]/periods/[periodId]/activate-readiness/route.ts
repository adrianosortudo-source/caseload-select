/**
 * POST /api/portal/[firmId]/periods/[periodId]/activate-readiness
 *
 * DR-097. Operator-only. Activates publication-readiness enforcement for
 * one period, gated by the activation preflight (evaluateActivationPreflight
 * in lib/publication-readiness.ts): every active deliverable in the period
 * must already have deliverable_role, locale, and publication_destination
 * set. Refuses with 409 and the blocking deliverable ids otherwise. Never a
 * blanket/bulk operation; one period at a time, reviewed by the operator.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { activatePeriodReadiness } from "@/lib/deliverables";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const { firmId, periodId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await activatePeriodReadiness({ periodId, firmId });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, blockingDeliverableIds: result.blockingDeliverableIds },
      { status: result.blockingDeliverableIds ? 409 : 400 },
    );
  }
  return NextResponse.json({ ok: true, period: result.period });
}
