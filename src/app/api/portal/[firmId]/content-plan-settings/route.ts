/**
 * PATCH /api/portal/[firmId]/content-plan-settings
 *
 * Operator-only. Set the content plan's batch ask note and a custom "review by"
 * deadline shown in the review-overview panel. Pass null to clear either field.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { denyWriteIfPreview } from "@/lib/preview-guard";
import { upsertContentPlanSettings } from "@/lib/deliverables";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const { firmId } = await params;
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const previewDenied = await denyWriteIfPreview(firmId);
  if (previewDenied) return previewDenied;

  let body: { ask?: unknown; review_by?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const ask =
    typeof body.ask === "string" && body.ask.trim() ? body.ask.trim().slice(0, 1000) : null;

  let reviewBy: string | null = null;
  if (typeof body.review_by === "string" && body.review_by.trim()) {
    if (!DATE_RE.test(body.review_by)) {
      return NextResponse.json({ error: "review_by must be YYYY-MM-DD" }, { status: 400 });
    }
    reviewBy = body.review_by;
  }

  const result = await upsertContentPlanSettings({ firmId, ask, reviewBy });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, settings: result.settings });
}
