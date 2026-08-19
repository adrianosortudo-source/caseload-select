/**
 * GET   /api/portal/[firmId]/deliverables/[deliverableId]   detail (versions + comments + approvals)
 * PATCH /api/portal/[firmId]/deliverables/[deliverableId]   archive, place, or record publication
 *
 * Operator or firm-lawyer session. The loaded deliverable's firm_id is checked
 * against the URL firmId (defense-in-depth per the broad cookie path).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { normalizeManualPublicationDate } from "@/lib/deliverables-pure";
import {
  getDeliverableDetail,
  archiveDeliverable,
  setDeliverablePublishedAt,
  setDeliverablePlacement,
} from "@/lib/deliverables";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const result = await getDeliverableDetail(deliverableId);
  if (!result.ok) {
    return NextResponse.json(
      { error: "could not load this deliverable, try again" },
      { status: 503 },
    );
  }
  if (!result.found || result.detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...result.detail });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string; deliverableId: string }> },
) {
  const { firmId, deliverableId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  let body: { action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const detailResult = await getDeliverableDetail(deliverableId);
  if (!detailResult.ok) {
    return NextResponse.json(
      { error: "could not load this deliverable, try again" },
      { status: 503 },
    );
  }
  if (!detailResult.found || detailResult.detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (body.action === "archive") {
    const result = await archiveDeliverable({ deliverableId, firmId });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "set_publication_record") {
    if (resolved.actor.role !== "operator") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const b = body as { published?: unknown; published_at?: unknown };
    if (typeof b.published !== "boolean") {
      return NextResponse.json({ error: "published must be true or false" }, { status: 400 });
    }
    const normalized = normalizeManualPublicationDate(b.published, b.published_at);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    const result = await setDeliverablePublishedAt({
      deliverableId,
      firmId,
      publishedAt: normalized.publishedAt,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, published_at: result.publishedAt });
  }

  if (body.action === "place") {
    // Operator-only: place a deliverable in a week and/or set its format.
    if (resolved.actor.role !== "operator") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const b = body as { period_id?: unknown; format?: unknown };
    const periodId = typeof b.period_id === "string" && b.period_id ? b.period_id : null;
    const rawFormat = typeof b.format === "string" ? b.format.trim().slice(0, 80) : "";
    const format = rawFormat.length > 0 ? rawFormat : null;
    const result = await setDeliverablePlacement({ deliverableId, firmId, periodId, format });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
