/**
 * GET /api/portal/[firmId]/triage/[leadId]
 *
 * Returns a single screened lead's full record for the brief view. The
 * brief_html field is the moment-in-time snapshot the screen rendered at
 * submit; the portal dumps it verbatim.
 *
 * Auth: portal session must match firmId. Returns 404 (not 403) when the
 * lead exists but belongs to a different firm, to avoid leaking existence.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getScoringPortForRead } from "@/lib/scoring-port-read";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; leadId: string }> }
) {
  const { firmId, leadId } = await params;
  const session = await getPortalSession();
  // Operators can read any firm's brief; lawyers only their own. Client
  // sessions (matter-scoped magic links) never touch the triage surface.
  const isAuthorized = !!session && session.role !== "client" && (session.role === "operator" || session.firm_id === firmId);
  if (!session || !isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [leadResult, firmResult] = await Promise.all([
    supabase
      .from("screened_leads")
      .select(`
        lead_id, firm_id, status, status_changed_at, status_note,
        brief_json, brief_html, slot_answers,
        band, matter_type, practice_area,
        value_score, complexity_score, urgency_score, readiness_score,
        readiness_answered, whale_nurture, band_c_subtrack,
        decision_deadline, contact_name, contact_email, contact_phone,
        submitted_at, created_at,
        score_confidence, score_completeness, score_explanation,
        score_missing_fields, field_provenance, score_version
      `)
      .eq("lead_id", leadId)
      .maybeSingle(),
    supabase
      .from("intake_firms")
      .select("read_scoring_port")
      .eq("id", firmId)
      .maybeSingle(),
  ]);

  if (leadResult.error) {
    return NextResponse.json({ error: leadResult.error.message }, { status: 500 });
  }
  const data = leadResult.data;
  // Hide cross-firm existence: 404 even when the row exists for another firm.
  if (!data || data.firm_id !== firmId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const firmConfig = {
    read_scoring_port: firmResult.data?.read_scoring_port === true,
  };
  const scoringPort = getScoringPortForRead(
    {
      id: data.lead_id,
      matter_type: data.matter_type,
      band: data.band,
      slot_answers: data.slot_answers,
      score_confidence: data.score_confidence,
      score_completeness: data.score_completeness,
      score_explanation: data.score_explanation,
      score_missing_fields: data.score_missing_fields,
      field_provenance: data.field_provenance,
      score_version: data.score_version,
    },
    firmConfig,
  );

  return NextResponse.json({ lead: data, scoring_port: scoringPort });
}
