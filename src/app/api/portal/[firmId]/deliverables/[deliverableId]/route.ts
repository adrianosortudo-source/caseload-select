/**
 * GET   /api/portal/[firmId]/deliverables/[deliverableId]   detail (versions + comments + approvals)
 * PATCH /api/portal/[firmId]/deliverables/[deliverableId]   { action: "archive" }
 *
 * Operator or firm-lawyer session. The loaded deliverable's firm_id is checked
 * against the URL firmId (defense-in-depth per the broad cookie path).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { getDeliverableDetail, archiveDeliverable } from "@/lib/deliverables";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...detail });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (body.action === "archive") {
    const result = await archiveDeliverable({ deliverableId, firmId });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
