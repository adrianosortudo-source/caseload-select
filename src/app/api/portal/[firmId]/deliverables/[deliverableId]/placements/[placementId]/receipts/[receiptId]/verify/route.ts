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
import { resolveDeliverableActor } from "@/lib/deliverables-auth";
import { getDeliverableDetail } from "@/lib/deliverables";
import { listPlacementsForDeliverable } from "@/lib/content-placements";
import { getReceiptById, verifyReceipt } from "@/lib/publication-receipts";
import { validateReceiptForDestination } from "@/lib/channel-validation";
import { supabaseAdmin } from "@/lib/supabase-admin";

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "caseloadselect.ca";

export async function POST(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ firmId: string; deliverableId: string; placementId: string; receiptId: string }> },
) {
  const { firmId, deliverableId, placementId, receiptId } = await params;

  // Workstream 5: resolveDeliverableActor (not the plain requireOperator
  // gate) so this route has the real, currently-authenticated actor to
  // pass into verifyReceipt below -- the same resolver
  // deactivate-readiness/route.ts already uses for its own audited,
  // operator-only action.
  const resolved = await resolveDeliverableActor(firmId);
  if (!resolved) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (resolved.actor.role !== "operator") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const verifier = { role: resolved.actor.role, id: resolved.actor.id, name: resolved.actor.name };

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
      verifierRole: verifier.role,
      verifierId: verifier.id,
      verifierName: verifier.name,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, receipt: result.receipt, automated: false });
  }

  const { data: firm } = await supabaseAdmin
    .from("intake_firms")
    .select("custom_domain, subdomain")
    .eq("id", firmId)
    .maybeSingle();
  const firmRow = firm as { custom_domain?: string | null; subdomain?: string | null } | null;
  // custom_domain covers legacy firms; new firms onboard via the
  // subdomain column instead (src/middleware.ts), so a firm with no
  // custom_domain is NOT a firm with no expected host -- it is a firm
  // whose host lives under APP_DOMAIN. Falling through to null here
  // silently disables host verification for every subdomain-onboarded
  // firm: safeFetch still blocks private/loopback/metadata IPs, but with
  // no allowedHosts it accepts a 200 response from ANY public URL as
  // "verified" evidence this firm published the content.
  const expectedHost =
    firmRow?.custom_domain ?? (firmRow?.subdomain ? `${firmRow.subdomain}.${APP_DOMAIN}` : null);

  // A trusted sha256 to check the live PDF bytes against, resolved
  // server-side -- never from the request body, which a caller could set
  // to anything. receipt.artifact_sha256 is itself trustworthy whenever
  // artifact_id is set: the publication_receipt_integrity_hardening
  // trigger guarantees it either matches, or was auto-populated from,
  // publication_artifacts.sha256 at insert time, so no extra query is
  // needed for that case. Falls back to the approved version's own
  // asset_sha256 for a receipt with no artifact_id.
  let expectedSha256: string | null = null;
  if (placement.required_artifact_type === "pdf") {
    if (receipt.artifact_id) {
      expectedSha256 = receipt.artifact_sha256;
    } else if (receipt.approved_version_id) {
      const { data: version } = await supabaseAdmin
        .from("deliverable_versions")
        .select("asset_sha256")
        .eq("id", receipt.approved_version_id)
        .maybeSingle();
      expectedSha256 = (version as { asset_sha256?: string | null } | null)?.asset_sha256 ?? null;
    }
  }

  const check = await validateReceiptForDestination(placement.destination, receipt, {
    expectedHost,
    expectedSha256,
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
    verifierRole: verifier.role,
    verifierId: verifier.id,
    verifierName: verifier.name,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, automated: true, persisted: true, check, receipt: result.receipt });
}
