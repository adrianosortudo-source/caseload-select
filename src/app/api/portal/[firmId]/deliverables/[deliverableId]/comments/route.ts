/**
 * POST /api/portal/[firmId]/deliverables/[deliverableId]/comments
 *
 * Add a comment anchored to a specific version. The annotation (text passage,
 * image pin/region, or PDF page) is optional; a null annotation is a general
 * comment on the version. Operator or firm-lawyer session.
 *
 * Body: { version_id, body, annotation?, parent_comment_id? }
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { getDeliverableDetail, addComment } from "@/lib/deliverables";
import { cleanCommentBody, validateAnnotation } from "@/lib/deliverables-pure";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: {
    version_id?: unknown;
    body?: unknown;
    annotation?: unknown;
    parent_comment_id?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const versionId = typeof body.version_id === "string" ? body.version_id : null;
  if (!versionId || !detail.versions.some((v) => v.id === versionId)) {
    return NextResponse.json({ error: "valid version_id is required" }, { status: 400 });
  }

  const cleanBody = cleanCommentBody(body.body);
  if (!cleanBody) {
    return NextResponse.json({ error: "comment body is required" }, { status: 400 });
  }

  const annotation = validateAnnotation(body.annotation);
  const parentId =
    typeof body.parent_comment_id === "string" ? body.parent_comment_id : null;
  if (parentId && !detail.comments.some((c) => c.id === parentId)) {
    return NextResponse.json(
      { error: "parent_comment_id not found in this deliverable" },
      { status: 400 },
    );
  }

  const result = await addComment({
    deliverableId,
    versionId,
    firmId,
    annotation,
    body: cleanBody,
    parentCommentId: parentId,
    actor: resolved.actor,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, comment: result.comment });
}
