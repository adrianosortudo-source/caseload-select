/**
 * POST /api/admin/content-performance/leads/[leadId]/sync
 *
 * Content Performance / Content-to-Matter Attribution (Phase 2A):
 * normalizes this lead's already-captured UTM/referrer fields
 * (screened_leads.utm_*, .referrer) into an attribution evidence row.
 * Operator-triggered, per lead -- deliberately NOT an automated bulk
 * backfill sweep. Deterministic matching only (utm_content/utm_term
 * exact-matched against a real placement id); no fuzzy, topic, or
 * timing inference. Idempotent: calling this twice for the same lead
 * does not create a duplicate observed-evidence row.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { syncObservedEvidenceForLead } from "@/lib/content-attribution";

async function loadLeadFirmId(leadId: string): Promise<string | null> {
  const { data } = await supabase
    .from("screened_leads")
    .select("firm_id")
    .eq("id", leadId)
    .maybeSingle();
  return (data?.firm_id as string | undefined) ?? null;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const denied = await requireOperator();
  if (denied) return denied;

  const { leadId } = await params;
  const firmId = await loadLeadFirmId(leadId);
  if (!firmId) return NextResponse.json({ error: "lead not found" }, { status: 404 });

  const result = await syncObservedEvidenceForLead(firmId, leadId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (!result.evidence) {
    return NextResponse.json({ ok: true, evidence: null, message: "no new observed evidence to record" });
  }
  return NextResponse.json({ ok: true, evidence: result.evidence });
}
