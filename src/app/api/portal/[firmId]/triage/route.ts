/**
 * GET /api/portal/[firmId]/triage
 *
 * Returns the lawyer triage queue for a firm: every row in `screened_leads`
 * with status='triaging', sorted Band A → B → C, and within each band by
 * decision_deadline ascending (most urgent first).
 *
 * Auth: portal session cookie. The session's firm_id must match the path's
 * firmId, otherwise 403.
 *
 * Response:
 *   {
 *     items: [{
 *       lead_id, band, matter_type, practice_area,
 *       value_score, complexity_score, urgency_score, readiness_score,
 *       readiness_answered, whale_nurture, band_c_subtrack,
 *       decision_deadline, contact_name, submitted_at,
 *       snapshot,        -- pulled from brief_json.matter_snapshot
 *       fee_estimate,    -- pulled from brief_json.fee_estimate
 *     }]
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { sortTriageRows } from "@/lib/triage-sort";

interface BriefJson {
  matter_snapshot?: string;
  fee_estimate?: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> }
) {
  const { firmId } = await params;
  const session = await getPortalSession();
  if (!session || session.firm_id !== firmId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Triaging rows for this firm. We over-fetch a few columns we'll project
  // back out so the queue page can render without a second hop.
  const { data, error } = await supabase
    .from("screened_leads")
    .select(`
      lead_id, band, matter_type, practice_area,
      value_score, complexity_score, urgency_score, readiness_score,
      readiness_answered, whale_nurture, band_c_subtrack,
      decision_deadline, contact_name, submitted_at, brief_json
    `)
    .eq("firm_id", firmId)
    .eq("status", "triaging")
    .order("decision_deadline", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sort: band A first, then B, then C, then nulls; within each, deadline asc.
  // The query above ordered by deadline; sortTriageRows re-orders by band
  // primarily because Postgres `ORDER BY band` would alphabetize correctly
  // only by accident.
  const rows = sortTriageRows(data ?? []);

  const items = rows.map((r) => {
    const brief = (r.brief_json ?? {}) as BriefJson;
    return {
      lead_id: r.lead_id,
      band: r.band,
      matter_type: r.matter_type,
      practice_area: r.practice_area,
      value_score: r.value_score,
      complexity_score: r.complexity_score,
      urgency_score: r.urgency_score,
      readiness_score: r.readiness_score,
      readiness_answered: r.readiness_answered,
      whale_nurture: r.whale_nurture,
      band_c_subtrack: r.band_c_subtrack,
      decision_deadline: r.decision_deadline,
      contact_name: r.contact_name,
      submitted_at: r.submitted_at,
      snapshot: brief.matter_snapshot ?? null,
      fee_estimate: brief.fee_estimate ?? null,
    };
  });

  return NextResponse.json({ items });
}
