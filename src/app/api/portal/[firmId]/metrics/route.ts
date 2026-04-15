/**
 * GET /api/portal/[firmId]/metrics
 *
 * Returns aggregated metrics for the firm dashboard.
 * Read-only. Requires portal session.
 *
 * Returns:
 *   - sessions_total: all-time intake session count
 *   - sessions_this_month: intake sessions in current calendar month
 *   - sessions_complete: sessions with status = 'complete'
 *   - otp_verified_rate: % of complete sessions where otp_verified = true
 *   - band_distribution: { A, B, C, D, E } counts from complete sessions
 *   - leads_total: total leads in pipeline
 *   - leads_by_stage: { stage: count } map
 */

import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { supabase } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ firmId: string }> }) {
  const session = await getPortalSession();
  const { firmId } = await params;

  if (!session || session.firm_id !== firmId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [sessionsAll, sessionsMonth, sessionsComplete, leadsAll] = await Promise.all([
    supabase
      .from("intake_sessions")
      .select("id", { count: "exact", head: true })
      .eq("firm_id", firmId),
    supabase
      .from("intake_sessions")
      .select("id", { count: "exact", head: true })
      .eq("firm_id", firmId)
      .gte("created_at", monthStart.toISOString()),
    supabase
      .from("intake_sessions")
      .select("band, otp_verified")
      .eq("firm_id", firmId)
      .eq("status", "complete"),
    supabase
      .from("leads")
      .select("stage, band")
      .eq("law_firm_id", firmId),
  ]);

  const complete = sessionsComplete.data ?? [];
  const band_distribution = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  let verified = 0;
  for (const s of complete) {
    const b = s.band as keyof typeof band_distribution;
    if (b in band_distribution) band_distribution[b]++;
    if (s.otp_verified) verified++;
  }

  const leads = leadsAll.data ?? [];
  const leads_by_stage: Record<string, number> = {};
  for (const l of leads) {
    leads_by_stage[l.stage] = (leads_by_stage[l.stage] ?? 0) + 1;
  }

  return NextResponse.json({
    sessions_total: sessionsAll.count ?? 0,
    sessions_this_month: sessionsMonth.count ?? 0,
    sessions_complete: complete.length,
    otp_verified_rate: complete.length > 0 ? Math.round((verified / complete.length) * 100) : 0,
    band_distribution,
    leads_total: leads.length,
    leads_by_stage,
  });
}
