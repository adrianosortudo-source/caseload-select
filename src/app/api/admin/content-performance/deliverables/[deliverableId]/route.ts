/**
 * GET /api/admin/content-performance/deliverables/[deliverableId]
 *
 * Content Performance / Content-to-Matter Attribution (Phase 3, point 1):
 * operator deliverable/version performance view. Operator-only.
 *
 * Returns: the deliverable, its placements, the current receipt per
 * placement (readiness state), and the current attribution evidence for
 * every enquiry linked to this deliverable (attribution-state breakdown
 * plus outcome/matter-stage where the existing client_matters record
 * supports it). No inflated causal language is computed here -- this
 * route returns evidence-graded facts; wording lives in the UI layer
 * per the Content Performance client-language guidelines.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { getDeliverableDetail } from "@/lib/deliverables";
import { listPlacementsForDeliverable } from "@/lib/content-placements";
import { listCurrentReceiptsByPlacementForDeliverable } from "@/lib/publication-receipts";
import { listCurrentAttributionForDeliverable } from "@/lib/content-attribution";
import { countByAttributionState } from "@/lib/content-attribution-pure";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ deliverableId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { deliverableId } = await params;
  const detail = await getDeliverableDetail(deliverableId);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [placements, currentReceiptsByPlacement, attribution] = await Promise.all([
    listPlacementsForDeliverable(deliverableId),
    listCurrentReceiptsByPlacementForDeliverable(deliverableId, detail.deliverable.approved_version_id),
    listCurrentAttributionForDeliverable(detail.deliverable.firm_id, deliverableId),
  ]);

  const attributionBreakdown = countByAttributionState(attribution);
  const outcomeCounts = attribution.reduce<Record<string, number>>((acc, row) => {
    if (!row.matter_stage) return acc;
    acc[row.matter_stage] = (acc[row.matter_stage] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    ok: true,
    deliverable: detail.deliverable,
    placements,
    currentReceiptsByPlacement,
    attribution,
    attributionBreakdown,
    outcomeCounts,
  });
}
