/**
 * POST /api/portal/[firmId]/periods/[periodId]/deactivate-readiness
 *
 * DR-099. Operator-only. The one audited, exceptional path off an
 * enforced period's readiness_lifecycle. Once activatePeriodReadiness has
 * set a period to enforced, an ordinary UPDATE against content_periods
 * can no longer move it away (trg_validate_readiness_activation refuses
 * it, see 20260715195701_content_periods_enforced_monotonic.sql); this
 * route, and only this route, can. Requires a non-empty reason, which is
 * recorded append-only in content_periods_enforcement_audit alongside the
 * actor and the from/to lifecycle values. Never a blanket/bulk operation;
 * one period at a time, reviewed by the operator.
 *
 * Body: { toLifecycle: "setup_required" | "legacy_unreconciled", reason: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { deactivatePeriodReadiness } from "@/lib/deliverables";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; periodId: string }> },
) {
  const { firmId, periodId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { toLifecycle?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const toLifecycle = body.toLifecycle;
  if (toLifecycle !== "setup_required" && toLifecycle !== "legacy_unreconciled") {
    return NextResponse.json(
      { error: "toLifecycle must be setup_required or legacy_unreconciled" },
      { status: 400 },
    );
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json({ error: "a reason is required to deactivate enforcement" }, { status: 400 });
  }

  const result = await deactivatePeriodReadiness({
    periodId,
    firmId,
    toLifecycle,
    reason,
    actor: { role: "operator", id: resolved.actor.id ?? null, name: resolved.actor.name ?? null },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true, auditId: result.auditId, createdAt: result.createdAt });
}
