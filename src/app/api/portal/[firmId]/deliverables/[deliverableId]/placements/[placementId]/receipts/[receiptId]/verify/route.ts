/**
 * POST /api/portal/[firmId]/deliverables/[deliverableId]/placements/[placementId]/receipts/[receiptId]/verify
 *
 * Workstream 6: runs the channel-specific validator for this receipt's
 * destination and records the result as a new, append-only receipt row
 * (never mutates the one being checked -- see verifyReceipt in
 * publication-receipts.ts). Operator-only.
 *
 * Body (optional): { manualOutcome: "verified" | "failed", manualReason?: string }
 * Used only for destinations the automated validator cannot check itself
 * (LinkedIn, GBP, email): the automated pass returns "unverifiable" without
 * writing anything, and an operator who has personally confirmed the live
 * post resubmits with manualOutcome to record their own attestation. This
 * route never fabricates a "verified" result the automated check itself
 * could not support.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { getDeliverableDetail } from "@/lib/deliverables";
import { listPlacementsForDeliverable } from "@/lib/content-placements";
import { getReceiptById, verifyReceipt } from "@/lib/publication-receipts";
import { validateReceiptForDestination } from "@/lib/channel-validation";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ firmId: string; deliverableId: string; placementId: string; receiptId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { firmId, deliverableId, placementId, receiptId } = await params;
  const detail = await getDeliverableDetail(deliverableId);
  if (!detail || detail.deliverable.firm_id !== firmId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const placements = await listPlacementsForDeliverable(deliverableId);
  const placement = placements.find((p) => p.id === placementId);
  if (!placement) {
    return NextResponse.json({ error: "placement not found on this deliverable" }, { status: 404 });
  }

  const receipt = await getReceiptById(receiptId);
  if (!receipt || receipt.placement_id !== placementId) {
    return NextResponse.json({ error: "receipt not found on this placement" }, { status: 404 });
  }

  let body: { manualOutcome?: unknown; manualReason?: unknown } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.manualOutcome === "verified" || body.manualOutcome === "failed") {
    const result = await verifyReceipt(receiptId, {
      method: "operator_attestation",
      passed: body.manualOutcome === "verified",
      failureReason: typeof body.manualReason === "string" ? body.manualReason : undefined,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, receipt: result.receipt, automated: false });
  }

  const { data: firm } = await supabaseAdmin
    .from("intake_firms")
    .select("custom_domain")
    .eq("id", firmId)
    .maybeSingle();
  const expectedHost = (firm as { custom_domain?: string | null } | null)?.custom_domain ?? null;

  const check = await validateReceiptForDestination(placement.destination, receipt, {
    expectedHost,
    requiredArtifactType: placement.required_artifact_type,
  });

  if (check.outcome === "unverifiable") {
    return NextResponse.json({
      ok: true,
      automated: true,
      persisted: false,
      check,
      hint: "resubmit with { manualOutcome: 'verified' | 'failed' } after manually confirming the live post",
    });
  }

  const result = await verifyReceipt(receiptId, {
    method: check.method,
    passed: check.outcome === "verified",
    failureReason: check.reason,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, automated: true, persisted: true, check, receipt: result.receipt });
}
