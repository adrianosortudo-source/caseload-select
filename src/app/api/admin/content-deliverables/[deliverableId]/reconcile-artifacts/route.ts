/**
 * POST /api/admin/content-deliverables/[deliverableId]/reconcile-artifacts
 *
 * Operator-triggered, read-only reconciliation (Workstream 7): validates
 * every publication_artifacts row registered against this deliverable and
 * records the result as an append-only publication_artifact_validations
 * row. Never generates, edits, publishes, or approves anything; never
 * registers a new artifact on its own.
 */

import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { getOperatorSession } from "@/lib/portal-auth";
import { reconcileDeliverableArtifacts } from "@/lib/publication-reconciliation";

export async function POST(_req: Request, { params }: { params: Promise<{ deliverableId: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { deliverableId } = await params;
  const session = await getOperatorSession();
  const outcome = await reconcileDeliverableArtifacts(deliverableId, session?.lawyer_id ?? null);

  if (!outcome.ok) return NextResponse.json({ ok: false, error: outcome.error }, { status: 500 });
  return NextResponse.json({ ok: true, results: outcome.results }, { status: 200 });
}
