/**
 * POST /api/portal/[firmId]/deliverables/[deliverableId]/versions/[versionId]/individual-review
 *
 * Operator-only control: "Require individual lawyer review for this
 * version" -- an exception that overrides standing publishing
 * authorization for one specific version, for unusual, sensitive,
 * uncertain, or high-risk content. set_deliverable_version_individual_
 * review_requirement independently rejects a non-operator actor_role at
 * the database layer as defense in depth; there is no lawyer- or
 * client-facing path to this route.
 *
 * Body: { required: boolean, reason?: string }  -- reason is required when
 * required is true (checked here and again in the RPC).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { getDeliverableDetail } from "@/lib/deliverables";
import { setDeliverableVersionIndividualReviewRequirement } from "@/lib/standing-publishing-authorization";

const MAX_REASON_LENGTH = 2000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string; versionId: string }> },
) {
  const { firmId, deliverableId, versionId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!detail.versions.some((v) => v.id === versionId)) {
    return NextResponse.json({ error: "version not found on this deliverable" }, { status: 404 });
  }

  let body: { required?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof body.required !== "boolean") {
    return NextResponse.json({ error: "body.required must be a boolean" }, { status: 400 });
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, MAX_REASON_LENGTH)
      : null;
  if (body.required && !reason) {
    return NextResponse.json(
      { error: "a reason is required to require individual review" },
      { status: 400 },
    );
  }

  const result = await setDeliverableVersionIndividualReviewRequirement({
    versionId,
    firmId,
    required: body.required,
    actor: { role: "operator", id: resolved.actor.id ?? null, name: resolved.actor.name ?? "Operator" },
    reason,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, versionId: result.versionId, requiresIndividualReview: result.requiresIndividualReview });
}
