/**
 * POST /api/portal/[firmId]/deliverables/notify-pending
 *
 * Operator-only batch action. Announces every in_review deliverable for this
 * firm that has not yet been announced (review_notified_at IS NULL). Each
 * deliverable enqueues a notification_outbox row; the existing 5-minute
 * digest cron then groups them into ONE digest email per recipient. Idempotent:
 * re-running picks up only the still-unannounced rows.
 *
 * Returns: { ok: true, notified: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { notifyPendingReviews } from "@/lib/deliverables";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await notifyPendingReviews({ firmId, actor: resolved.actor });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, notified: result.notified });
}
