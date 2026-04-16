/**
 * GET /api/portal/[firmId]/dashboard
 *
 * Tier 1 Partner Dashboard metrics.
 * Returns 6 KPI tiles + sparkline data (6-week weekly aggregates).
 *
 * Auth: portal session cookie (firm_id must match route firmId).
 * Never returns raw CPI scores, AI rationale, or operator data.
 */

import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-auth";
import { supabase } from "@/lib/supabase";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ firmId: string }> }
) {
  const { firmId } = await ctx.params;

  // ── Auth ────────────────────────────────────────────────────────
  const session = await getPortalSession();
  if (!session || session.firm_id !== firmId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Date windows ─────────────────────────────────────────────────
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = monthStart;

  // 6-week window for sparklines (ending now, going back 6 full weeks)
  const weekBoundaries: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    d.setHours(0, 0, 0, 0);
    weekBoundaries.push(d);
  }
  const sparklineStart = weekBoundaries[0];

  // ── Parallel queries ─────────────────────────────────────────────
  const [
    firmResult,
    sessionsMonth,
    sessionsPrev,
    sessionsSparkline,
    leadsMonth,
    leadsPrev,
    leadsSparkline,
    leadsWithResponse,
    leadsActiveValue,
  ] = await Promise.all([
    // Firm config (ad spend, practice areas)
    supabase
      .from("intake_firms")
      .select("monthly_ad_spend")
      .eq("id", firmId)
      .single(),

    // Intake sessions this month (inquiries + qualified)
    supabase
      .from("intake_sessions")
      .select("id, band, created_at")
      .eq("firm_id", firmId)
      .gte("created_at", monthStart.toISOString()),

    // Intake sessions prev month (for delta)
    supabase
      .from("intake_sessions")
      .select("id, band")
      .eq("firm_id", firmId)
      .gte("created_at", prevMonthStart.toISOString())
      .lt("created_at", prevMonthEnd.toISOString()),

    // Intake sessions for 6-week sparkline
    supabase
      .from("intake_sessions")
      .select("band, created_at")
      .eq("firm_id", firmId)
      .gte("created_at", sparklineStart.toISOString()),

    // Leads this month (signed cases)
    supabase
      .from("leads")
      .select("id, stage, estimated_value, updated_at")
      .eq("law_firm_id", firmId)
      .gte("updated_at", monthStart.toISOString()),

    // Leads prev month signed cases (for delta)
    supabase
      .from("leads")
      .select("id, stage")
      .eq("law_firm_id", firmId)
      .eq("stage", "client_won")
      .gte("updated_at", prevMonthStart.toISOString())
      .lt("updated_at", prevMonthEnd.toISOString()),

    // Leads sparkline (signed by week)
    supabase
      .from("leads")
      .select("stage, updated_at")
      .eq("law_firm_id", firmId)
      .eq("stage", "client_won")
      .gte("updated_at", sparklineStart.toISOString()),

    // Leads with first_contact_at for avg response time
    supabase
      .from("leads")
      .select("first_contact_at, created_at")
      .eq("law_firm_id", firmId)
      .gte("created_at", monthStart.toISOString())
      .not("first_contact_at", "is", null),

    // Active pipeline for value sum
    supabase
      .from("leads")
      .select("estimated_value")
      .eq("law_firm_id", firmId)
      .not("stage", "in", "(client_won,client_lost)"),
  ]);

  const sessions = sessionsMonth.data ?? [];
  const sessionsPrevData = sessionsPrev.data ?? [];
  const sessionsSparkData = sessionsSparkline.data ?? [];
  const leadsMonthData = leadsMonth.data ?? [];
  const leadsPrevData = leadsPrev.data ?? [];
  const leadsSparkData = leadsSparkline.data ?? [];
  const responseLeads = leadsWithResponse.data ?? [];
  const activeLeads = leadsActiveValue.data ?? [];
  const adSpend = (firmResult.data?.monthly_ad_spend as number | null) ?? null;

  // ── KPI calculations ─────────────────────────────────────────────

  // 1. Inquiries this month
  const inquiriesNow = sessions.length;
  const inquiriesPrev = sessionsPrevData.length;
  const inquiriesDelta = inquiriesPrev > 0
    ? Math.round(((inquiriesNow - inquiriesPrev) / inquiriesPrev) * 100)
    : null;

  // 2. Qualified leads (band A or B)
  const qualifiedNow = sessions.filter(s => s.band === "A" || s.band === "B").length;
  const qualifiedPrev = sessionsPrevData.filter(s => s.band === "A" || s.band === "B").length;
  const qualifiedDelta = qualifiedPrev > 0
    ? Math.round(((qualifiedNow - qualifiedPrev) / qualifiedPrev) * 100)
    : null;

  // 3. Signed cases
  const signedNow = leadsMonthData.filter(l => l.stage === "client_won").length;
  const signedPrev = leadsPrevData.length;
  const signedDelta = signedPrev > 0
    ? Math.round(((signedNow - signedPrev) / signedPrev) * 100)
    : null;

  // 4. Cost per signed case
  const cpsc = signedNow > 0 && adSpend !== null
    ? Math.round((adSpend + 3500) / signedNow)
    : null;

  // 5. Avg response time (seconds) — median of first_contact_at - created_at
  let avgResponseSecs: number | null = null;
  if (responseLeads.length > 0) {
    const deltas = responseLeads
      .map(l => {
        const ms = new Date(l.first_contact_at as string).getTime() - new Date(l.created_at as string).getTime();
        return ms / 1000;
      })
      .filter(d => d >= 0)
      .sort((a, b) => a - b);
    if (deltas.length > 0) {
      const mid = Math.floor(deltas.length / 2);
      avgResponseSecs = deltas.length % 2 === 0
        ? Math.round((deltas[mid - 1] + deltas[mid]) / 2)
        : Math.round(deltas[mid]);
    }
  }

  // 6. Pipeline value
  const pipelineValue = activeLeads.reduce((sum, l) => {
    const v = l.estimated_value as number | null;
    return sum + (v ?? 0);
  }, 0);

  // 7. Funnel conversion: qualified leads → signed (Band A+B → client_won)
  const funnelConversion = qualifiedNow > 0
    ? Math.round((signedNow / qualifiedNow) * 100)
    : null;

  // ── Sparkline aggregation helper ─────────────────────────────────
  function bucketByWeek<T extends { created_at?: string; updated_at?: string }>(
    rows: T[],
    dateField: "created_at" | "updated_at"
  ): number[] {
    return weekBoundaries.slice(0, 6).map((wStart, i) => {
      const wEnd = weekBoundaries[i + 1];
      return rows.filter(r => {
        const d = new Date(r[dateField] as string);
        return d >= wStart && d < wEnd;
      }).length;
    });
  }

  const inquiriesSparkline = bucketByWeek(sessionsSparkData, "created_at");
  const qualifiedSparkline = weekBoundaries.slice(0, 6).map((wStart, i) => {
    const wEnd = weekBoundaries[i + 1];
    return sessionsSparkData.filter(s => {
      const d = new Date(s.created_at as string);
      return d >= wStart && d < wEnd && (s.band === "A" || s.band === "B");
    }).length;
  });
  const signedSparkline = bucketByWeek(leadsSparkData, "updated_at");

  return NextResponse.json({
    tiles: {
      inquiries: {
        value: inquiriesNow,
        delta: inquiriesDelta,
        sparkline: inquiriesSparkline,
      },
      qualified: {
        value: qualifiedNow,
        delta: qualifiedDelta,
        sparkline: qualifiedSparkline,
      },
      signed: {
        value: signedNow,
        delta: signedDelta,
        sparkline: signedSparkline,
      },
      cpsc: {
        value: cpsc,
        delta: null,
        sparkline: null,
      },
      avgResponseSecs: {
        value: avgResponseSecs,
        delta: null,
        sparkline: null,
      },
      pipelineValue: {
        value: pipelineValue,
        delta: null,
        sparkline: null,
      },
      funnelConversion: {
        value: funnelConversion,
        delta: null,
        sparkline: null,
      },
    },
  });
}
