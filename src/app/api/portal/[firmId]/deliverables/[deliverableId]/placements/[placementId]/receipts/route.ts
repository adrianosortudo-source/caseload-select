/**
 * GET/POST /api/portal/[firmId]/deliverables/[deliverableId]/placements/[placementId]/receipts
 *
 * Publication receipts (Workstream 5): append-only evidence that a
 * specific approved version was published to this placement's
 * destination. Operator-only. "Published requires a receipt" -- this
 * route is the only way a receipt is ever created; there is no PATCH or
 * DELETE by design (the database enforces this too).
 *
 * Body (POST): { approved_version_id, published_at, public_url?,
 *   external_post_id?, artifact_id?, artifact_sha256? }
 *
 * approved_version_id must be the deliverable's OWN current
 * approved_version_id (never an arbitrary version): this route refuses to
 * record a receipt for anything else, so a receipt can never claim to
 * publish content the lawyer did not actually approve as current.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { getDeliverableDetail } from "@/lib/deliverables";
import { createReceipt, listReceiptsForPlacement } from "@/lib/publication-receipts";
import { listPlacementsForDeliverable } from "@/lib/content-placements";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string; placementId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, deliverableId, placementId } = await params;
  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const placements = await listPlacementsForDeliverable(deliverableId);
  if (!placements.some((p) => p.id === placementId)) {
    return NextResponse.json({ error: "placement not found on this deliverable" }, { status: 404 });
  }

  const receipts = await listReceiptsForPlacement(placementId);
  return NextResponse.json({ ok: true, receipts });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string; placementId: string }> },
) {
  const { firmId, deliverableId, placementId } = await params;

  // Corrective-release finding 5 (extended): resolveDeliverableActor (not
  // the plain requireOperator gate) so this route has the real,
  // currently-authenticated operator's identity to record on the receipt
  // -- the same resolver the verify route already uses, closing the same
  // "every receipt attributed to the literal string Operator" gap at the
  // route that records the PRIMARY publish evidence, not just its later
  // verification.
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const placements = await listPlacementsForDeliverable(deliverableId);
  const placement = placements.find((p) => p.id === placementId);
  if (!placement) {
    return NextResponse.json({ error: "placement not found on this deliverable" }, { status: 404 });
  }

  let body: {
    approved_version_id?: unknown;
    published_at?: unknown;
    public_url?: unknown;
    external_post_id?: unknown;
    artifact_id?: unknown;
    artifact_sha256?: unknown;
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
  if (
    detail.deliverable.status !== "approved" ||
    detail.deliverable.approved_version_id !== approvedVersionId ||
    detail.deliverable.approved_version_id !== detail.deliverable.current_version_id
  ) {
    return NextResponse.json(
      {
        error:
          "approved_version_id must equal this deliverable's own current approved_version_id; a receipt cannot record publication of a version that is not the deliverable's current approved version",
      },
      { status: 409 },
    );
  }

  if (!body.public_url && !body.external_post_id) {
    return NextResponse.json(
      { error: "at least one of public_url or external_post_id is required as evidence" },
      { status: 400 },
    );
  }

  const publishedAt =
    typeof body.published_at === "string" && body.published_at
      ? body.published_at
      : new Date().toISOString();

  const result = await createReceipt({
    firmId,
    deliverableId,
    placementId,
    destination: placement.destination,
    locale: placement.locale,
    approvedVersionId,
    artifactId: typeof body.artifact_id === "string" ? body.artifact_id : null,
    artifactSha256: typeof body.artifact_sha256 === "string" ? body.artifact_sha256 : null,
    publicUrl: typeof body.public_url === "string" ? body.public_url : null,
    externalPostId: typeof body.external_post_id === "string" ? body.external_post_id : null,
    publishedAt,
    actorRole: "operator",
    actorId: resolved.actor.id ?? null,
    actorName: resolved.actor.name ?? "Operator",
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, receipt: result.receipt });
}
