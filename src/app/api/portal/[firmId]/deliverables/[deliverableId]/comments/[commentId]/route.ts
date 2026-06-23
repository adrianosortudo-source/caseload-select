/**
 * PATCH /api/portal/[firmId]/deliverables/[deliverableId]/comments/[commentId]
 *
 * Resolve or reopen a comment. Body: { resolved: boolean }.
 * Operator or firm-lawyer session. The comment's firm_id is checked.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { getDeliverableDetail, setCommentResolved } from "@/lib/deliverables";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string; commentId: string }> },
) {
  const { firmId, deliverableId, commentId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: { resolved?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.resolved !== "boolean") {
    return NextResponse.json({ error: "resolved (boolean) is required" }, { status: 400 });
  }

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!detail.comments.some((c) => c.id === commentId)) {
    return NextResponse.json({ error: "comment not found" }, { status: 404 });
  }

  const result = await setCommentResolved({
    commentId,
    firmId,
    resolved: body.resolved,
    actorRole: resolved.actor.role,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
