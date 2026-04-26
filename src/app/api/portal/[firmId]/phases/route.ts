/**
 * GET /api/portal/[firmId]/phases
 *
 * Tier 3 FACT Phase metrics.
 * Filter: live band distribution + SLA compliance.
 * Authority: Clio connection status + open matter count (live if connected).
 * Capture / Target: null until BrightLocal / GA4 / Google Ads integrations are live.
 *
 * Auth: portal session cookie.
 */

import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { isClioConnected, getClioMatters } from "@/lib/clio";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ firmId: string }> }
) {
  const { firmId } = await ctx.params;

  const session = await getPortalSession();
  if (!session || session.firm_id !== firmId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [sessionsMonth, leadsWithResponse, clioConnected] = await Promise.all([
    supabase
      .from("intake_sessions")
      .select("band")
      .eq("firm_id", firmId)
      .gte("created_at", monthStart),
    supabase
      .from("leads")
      .select("first_contact_at, created_at")
      .eq("law_firm_id", firmId)
      .gte("created_at", monthStart)
      .not("first_contact_at", "is", null),
    isClioConnected(firmId),
  ]);

  // Fetch recent Clio matters only if connected (non-fatal)
  const clioMatters = clioConnected
    ? await getClioMatters(firmId, 5).catch(() => [])
    : [];

  const sessions = sessionsMonth.data ?? [];
  const responseLeads = leadsWithResponse.data ?? [];

  // Band distribution
  const bandDist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const s of sessions) {
    const b = s.band as string;
    if (b && b in bandDist) bandDist[b]++;
  }

  // SLA compliance: % where first_contact_at - created_at < 60 seconds
  let slaCompliance = 0;
  if (responseLeads.length > 0) {
    const withinSLA = responseLeads.filter(l => {
      const ms = new Date(l.first_contact_at as string).getTime() - new Date(l.created_at as string).getTime();
      return ms >= 0 && ms / 1000 < 60;
    }).length;
    slaCompliance = Math.round((withinSLA / responseLeads.length) * 100);
  }

  const openMatters = clioMatters.filter(m => m.status?.toLowerCase() === "open");

  return NextResponse.json({
    filter: {
      band_distribution: bandDist,
      total: sessions.length,
      band_e_count: bandDist.E ?? 0,
      sla_compliance_pct: slaCompliance,
      sla_sample_size: responseLeads.length,
    },
    authority: {
      clio_connected: clioConnected,
      open_matter_count: clioConnected ? openMatters.length : null,
      recent_matters: clioMatters.map(m => ({
        id: m.id,
        display_number: m.display_number,
        description: m.description,
        status: m.status,
        client_name: m.client?.name ?? null,
        practice_area: m.practice_area?.name ?? null,
        open_date: m.open_date,
      })),
    },
    capture: null,
    target: null,
  });
}
