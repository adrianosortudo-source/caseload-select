/**
 * GET/POST /api/admin/content-performance/leads/[leadId]/evidence
 *
 * Content Performance / Content-to-Matter Attribution (Phase 2):
 * operator-facing evidence timeline for a single screened lead.
 * Operator-only, matching content_placements' operator-control-surface
 * posture -- lawyers see the aggregate client-safe view at
 * /api/portal/[firmId]/content-performance, never this raw evidence
 * timeline (it can carry evidence_note free text an operator wrote from
 * a call, and evidence_payload UTM strings).
 *
 * GET returns the full append-only evidence history for the lead
 * (oldest first).
 *
 * POST records ONE new evidence row -- self-reported or operator-
 * recorded offline referral only; observed digital evidence is
 * normalized separately via POST .../sync. Never creates marketing
 * consent, never overwrites a prior row (append-only; pass
 * supersedes_evidence_id to correct an earlier entry, which inserts a
 * new row rather than mutating the old one).
 *
 * Body (POST): { attribution_state: 'self_reported'|'offline_referral',
 *   self_report_category?, evidence_note?, deliverable_id?, placement_id?,
 *   supersedes_evidence_id? }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { getOperatorSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { listEvidenceForLead, recordAttributionEvidence } from "@/lib/content-attribution";
import type { AttributionSelfReportCategory } from "@/lib/types";

const SELF_REPORT_CATEGORIES: AttributionSelfReportCategory[] = [
  "referral",
  "search",
  "social",
  "ai_tool",
  "event",
  "existing_client",
  "other",
];

async function loadLeadFirmId(leadId: string): Promise<string | null> {
  const { data } = await supabase
    .from("screened_leads")
    .select("firm_id")
    .eq("id", leadId)
    .maybeSingle();
  return (data?.firm_id as string | undefined) ?? null;
}

async function resolveOperatorIdentity(): Promise<{ id: string | null; name: string | null }> {
  const session = await getOperatorSession();
  if (!session?.lawyer_id) return { id: null, name: "Operator" };
  const { data } = await supabase
    .from("firm_lawyers")
    .select("display_name")
    .eq("id", session.lawyer_id)
    .maybeSingle();
  return { id: session.lawyer_id, name: (data?.display_name as string | undefined) ?? "Operator" };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { leadId } = await params;
  const firmId = await loadLeadFirmId(leadId);
  if (!firmId) return NextResponse.json({ error: "lead not found" }, { status: 404 });

  const evidence = await listEvidenceForLead(firmId, leadId);
  return NextResponse.json({ ok: true, evidence });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { leadId } = await params;
  const firmId = await loadLeadFirmId(leadId);
  if (!firmId) return NextResponse.json({ error: "lead not found" }, { status: 404 });

  let body: {
    attribution_state?: unknown;
    self_report_category?: unknown;
    evidence_note?: unknown;
    deliverable_id?: unknown;
    placement_id?: unknown;
    supersedes_evidence_id?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const attributionState = body.attribution_state;
  if (attributionState !== "self_reported" && attributionState !== "offline_referral") {
    return NextResponse.json(
      { error: "attribution_state must be 'self_reported' or 'offline_referral'" },
      { status: 400 },
    );
  }

  const evidenceNote = typeof body.evidence_note === "string" ? body.evidence_note.trim() : "";
  if (!evidenceNote) {
    return NextResponse.json(
      { error: "evidence_note is required: describe what was said or observed" },
      { status: 400 },
    );
  }

  let selfReportCategory: AttributionSelfReportCategory | null = null;
  if (attributionState === "self_reported") {
    if (
      typeof body.self_report_category !== "string" ||
      !SELF_REPORT_CATEGORIES.includes(body.self_report_category as AttributionSelfReportCategory)
    ) {
      return NextResponse.json(
        { error: `self_report_category is required for self_reported evidence, one of: ${SELF_REPORT_CATEGORIES.join(", ")}` },
        { status: 400 },
      );
    }
    selfReportCategory = body.self_report_category as AttributionSelfReportCategory;
  }

  const actor = await resolveOperatorIdentity();

  const result = await recordAttributionEvidence({
    firmId,
    screenedLeadId: leadId,
    deliverableId: typeof body.deliverable_id === "string" ? body.deliverable_id : null,
    placementId: typeof body.placement_id === "string" ? body.placement_id : null,
    attributionState,
    evidenceMethod: attributionState === "self_reported" ? "self_report" : "operator_offline_referral",
    selfReportCategory,
    evidenceNote,
    observedAt: new Date().toISOString(),
    recordedByRole: "operator",
    recordedById: actor.id,
    recordedByName: actor.name,
    supersedesEvidenceId: typeof body.supersedes_evidence_id === "string" ? body.supersedes_evidence_id : null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, evidence: result.evidence });
}
