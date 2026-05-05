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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string; leadId: string }> }
) {
  const { firmId, leadId } = await params;
  const session = await getPortalSession();
  if (!session || session.firm_id !== firmId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("screened_leads")
    .select(`
      lead_id, firm_id, status, status_changed_at, status_note,
      brief_json, brief_html, slot_answers,
      band, matter_type, practice_area,
      value_score, complexity_score, urgency_score, readiness_score,
      readiness_answered, whale_nurture, band_c_subtrack,
      decision_deadline, contact_name, contact_email, contact_phone,
      submitted_at, created_at
    `)
    .eq("lead_id", leadId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Hide cross-firm existence: 404 even when the row exists for another firm.
  if (!data || data.firm_id !== firmId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ lead: data });
}
