/**
 * POST /api/portal/[firmId]/deliverables/[deliverableId]/placements/[placementId]/claim
 *
 * Corrective-release finding 4: atomically claims this exact
 * placement/version before an external publish action could begin.
 * Operator-only. This route, not buildPreflightReport() (a read-only
 * preview), is the actual authority a caller must obtain before
 * publishing -- see publication-placement-claims.ts. No external
 * publisher is invoked here or anywhere in this route; this is the
 * reservation step alone.
 *
 * Body: { approved_version_id, idempotency_key, supersedes_claim_id? }
 *
 * Repeating the same idempotency_key for this placement always returns the
 * same claim (ok:true, idempotentReplay:true), never a second reservation.
 * A competing claim (a different idempotency_key while another claim is
 * active) is rejected with 409 unless supersedes_claim_id explicitly
 * matches the current active claim.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { getDeliverableDetail } from "@/lib/deliverables";
import { listPlacementsForDeliverable } from "@/lib/content-placements";
import { claimPlacementForPublish } from "@/lib/publication-placement-claims";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string; placementId: string }> },
) {
  const resolved = await resolveDeliverableActor((await params).firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { firmId, deliverableId, placementId } = await params;

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const placements = await listPlacementsForDeliverable(deliverableId);
  if (!placements.some((p) => p.id === placementId)) {
    return NextResponse.json({ error: "placement not found on this deliverable" }, { status: 404 });
  }

  let body: {
    approved_version_id?: unknown;
    idempotency_key?: unknown;
    supersedes_claim_id?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const approvedVersionId =
    typeof body.approved_version_id === "string" ? body.approved_version_id : null;
  if (!approvedVersionId) {
    return NextResponse.json({ error: "approved_version_id is required" }, { status: 400 });
  }
  const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
  if (!idempotencyKey) {
    return NextResponse.json({ error: "idempotency_key is required" }, { status: 400 });
  }

  const result = await claimPlacementForPublish({
    firmId,
    deliverableId,
    placementId,
    approvedVersionId,
    idempotencyKey,
    actor: resolved.actor,
    supersedesClaimId:
      typeof body.supersedes_claim_id === "string" ? body.supersedes_claim_id : null,
  });

  if (!result.ok) {
    // use_new_idempotency_key (finding 4: idempotency identity scoping): the
    // same idempotency_key was already used for a materially different
    // request (different version/deliverable/actor/supersession) -- a real
    // conflict on the key's identity, the same class of 409 as an
    // already-active competing claim, not a 422 validation problem with the
    // request as submitted.
    const status =
      result.nextAction === "already_published" ||
      result.nextAction === "needs_reverification" ||
      result.nextAction === "use_new_idempotency_key"
        ? 409
        : 422;
    return NextResponse.json(
      { error: result.error, existingClaimId: result.existingClaimId, nextAction: result.nextAction },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    claimId: result.claimId,
    idempotentReplay: result.idempotentReplay,
    status: result.status,
  });
}
