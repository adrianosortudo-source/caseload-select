/**
 * GET/POST /api/portal/[firmId]/deliverables/[deliverableId]/placements/[placementId]/receipts
 *
 * Publication receipts (Workstream 5): append-only evidence that a
 * specific approved version was published to this placement's
 * destination. Operator-only. "Published requires a receipt" -- this
 * route is the only way a receipt is ever created; there is no PATCH or
 * DELETE by design (the database enforces this too).
 *
 * Body (POST): { approved_version_id, claim_id, published_at, public_url?,
 *   external_post_id?, artifact_id? }
 *
 * approved_version_id must be the deliverable's OWN current
 * approved_version_id (never an arbitrary version): this route refuses to
 * record a receipt for anything else, so a receipt can never claim to
 * publish content the lawyer did not actually approve as current.
 *
 * claim_id (corrective release, workstream 1) is required for every new
 * root receipt: it must name an active publication_placement_claims row
 * obtained beforehand via POST .../claim, matching this firm, deliverable,
 * placement, and approved_version_id, and (where the claim carries an
 * authenticated identity) this same operator. A stale, released,
 * superseded, mismatched, or missing claim is rejected here with a clear
 * next_action before the insert is attempted; the database trigger is the
 * final authority regardless (defense in depth -- see
 * validate_publication_receipt_scope in
 * supabase/migrations/20260716220000_publication_receipt_actor_binding_and_hash_trust_fix.sql,
 * the current definition of the function).
 *
 * There is no artifact_sha256 field in this contract: a PDF's hash is never
 * caller-supplied. When artifact_id is bound, the server derives
 * artifact_sha256 exclusively from publication_artifacts.sha256 (and
 * rejects an active PDF artifact that has none registered).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { getDeliverableDetail } from "@/lib/deliverables";
import { createReceipt, listReceiptsForPlacement } from "@/lib/publication-receipts";
import { listPlacementsForDeliverable } from "@/lib/content-placements";
import { supabaseAdmin } from "@/lib/supabase-admin";

interface ClaimRow {
  id: string;
  firm_id: string;
  deliverable_id: string;
  placement_id: string;
  approved_version_id: string;
  status: "active" | "released" | "superseded";
  claimed_by_role: "operator" | "lawyer" | "system";
  claimed_by_id: string | null;
}

type ClaimValidation =
  | { ok: true; claim: ClaimRow }
  | { ok: false; status: number; error: string; nextAction: string };

/**
 * Server-loads and validates the claim named in the request -- never
 * accepts a claim's identity fields from the caller, only its id. Returns a
 * specific status/next_action per failure mode so the client knows whether
 * to reclaim, re-verify, or escalate, rather than a generic 400.
 */
async function loadAndValidateClaim(
  claimId: string,
  scope: { firmId: string; deliverableId: string; placementId: string; approvedVersionId: string },
  actor: { role: "operator" | "lawyer" | "system"; id: string | null },
): Promise<ClaimValidation> {
  const { data, error } = await supabaseAdmin
    .from("publication_placement_claims")
    .select("id, firm_id, deliverable_id, placement_id, approved_version_id, status, claimed_by_role, claimed_by_id")
    .eq("id", claimId)
    .maybeSingle();
  if (error) {
    return { ok: false, status: 500, error: error.message, nextAction: "retry" };
  }
  if (!data) {
    return { ok: false, status: 404, error: "claim_id does not reference an existing placement claim", nextAction: "reclaim_placement" };
  }
  const claim = data as ClaimRow;
  if (
    claim.firm_id !== scope.firmId ||
    claim.deliverable_id !== scope.deliverableId ||
    claim.placement_id !== scope.placementId ||
    claim.approved_version_id !== scope.approvedVersionId
  ) {
    return {
      ok: false,
      status: 422,
      error: "claim_id does not match this firm, deliverable, placement, and approved_version_id",
      nextAction: "reclaim_placement",
    };
  }
  if (claim.status !== "active") {
    return {
      ok: false,
      status: 409,
      error: `claim is ${claim.status}, not active; claims must still be active at receipt insertion time`,
      nextAction: "reclaim_placement",
    };
  }
  if (claim.claimed_by_role !== actor.role || (claim.claimed_by_id !== null && claim.claimed_by_id !== actor.id)) {
    return {
      ok: false,
      status: 403,
      error: "claim was reserved by a different operator",
      nextAction: "reclaim_placement",
    };
  }
  return { ok: true, claim };
}

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
    claim_id?: unknown;
    published_at?: unknown;
    public_url?: unknown;
    external_post_id?: unknown;
    artifact_id?: unknown;
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

  const claimId = typeof body.claim_id === "string" ? body.claim_id : null;
  if (!claimId) {
    return NextResponse.json(
      { error: "claim_id is required; obtain one from POST .../claim first", nextAction: "reclaim_placement" },
      { status: 400 },
    );
  }
  const claimValidation = await loadAndValidateClaim(
    claimId,
    { firmId, deliverableId, placementId, approvedVersionId },
    { role: "operator", id: resolved.actor.id ?? null },
  );
  if (!claimValidation.ok) {
    return NextResponse.json(
      { error: claimValidation.error, nextAction: claimValidation.nextAction },
      { status: claimValidation.status },
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
    claimId,
    artifactId: typeof body.artifact_id === "string" ? body.artifact_id : null,
    publicUrl: typeof body.public_url === "string" ? body.public_url : null,
    externalPostId: typeof body.external_post_id === "string" ? body.external_post_id : null,
    publishedAt,
    actorRole: "operator",
    actorId: resolved.actor.id ?? null,
    actorName: resolved.actor.name ?? "Operator",
  });
  if (!result.ok) {
    // Defense in depth: the route's own claim validation above should catch
    // every ordinary case, but if the claim state changed between that
    // check and this insert (a genuine race), the DB trigger's rejection
    // still surfaces as a clean, actionable response rather than a flat 400.
    //
    // Classified by the trigger's stable custom SQLSTATE ('CLM01', set by
    // validate_publication_receipt_scope() for every claim-binding
    // rejection), not by pattern-matching the exception message: a prior
    // /claim_id/i regex missed several of the trigger's own claim-related
    // messages (e.g. the actor_role and actor-identity mismatches, which
    // say "claim's", not "claim_id") and would silently misclassify any
    // future wording change as a generic error.
    const isClaimIssue = result.code === "CLM01";
    return NextResponse.json(
      { error: result.error, ...(isClaimIssue ? { nextAction: "reclaim_placement" } : {}) },
      { status: isClaimIssue ? 409 : 400 },
    );
  }

  return NextResponse.json({ ok: true, receipt: result.receipt });
}
