/**
 * /portal/[firmId]/dashboard — Tier 1 Partner Dashboard
 *
 * Six KPI tiles in a 2x3 grid. Each shows: value, delta vs prior month,
 * and a 6-week SVG sparkline.
 *
 * Data fetched server-side from Supabase (same auth as layout).
 * Client AutoRefresh component re-calls the API route every 5 minutes.
 */

import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { supabase } from "@/lib/supabase";
import KpiTiles from "./KpiTiles";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ firmId: string }>;
}) {
  const session = await getPortalSession();
  const { firmId } = await params;

  if (!session || session.firm_id !== firmId) {
    redirect("/portal/login");
  }

  // ── Date windows ─────────────────────────────────────────────────
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = monthStart;

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
    leadsWonMonth,
    leadsWonPrev,
    leadsWonSpark,
    leadsWithResponse,
    leadsActiveValue,
  ] = await Promise.all([
    supabase.from("intake_firms").select("monthly_ad_spend").eq("id", firmId).single(),

    supabase.from("intake_sessions").select("id, band, created_at")
      .eq("firm_id", firmId).gte("created_at", monthStart.toISOString()),

    supabase.from("intake_sessions").select("id, band")
      .eq("firm_id", firmId)
      .gte("created_at", prevMonthStart.toISOString())
      .lt("created_at", prevMonthEnd.toISOString()),

    supabase.from("intake_sessions").select("band, created_at")
      .eq("firm_id", firmId).gte("created_at", sparklineStart.toISOString()),

    supabase.from("leads").select("id, stage, updated_at")
      .eq("law_firm_id", firmId).eq("stage", "client_won")
      .gte("updated_at", monthStart.toISOString()),

    supabase.from("leads").select("id, stage")
      .eq("law_firm_id", firmId).eq("stage", "client_won")
      .gte("updated_at", prevMonthStart.toISOString())
      .lt("updated_at", prevMonthEnd.toISOString()),

    supabase.from("leads").select("stage, updated_at")
      .eq("law_firm_id", firmId).eq("stage", "client_won")
      .gte("updated_at", sparklineStart.toISOString()),

    supabase.from("leads").select("first_contact_at, created_at")
      .eq("law_firm_id", firmId)
      .gte("created_at", monthStart.toISOString())
      .not("first_contact_at", "is", null),

    supabase.from("leads").select("estimated_value")
      .eq("law_firm_id", firmId)
      .not("stage", "in", "(client_won,client_lost)"),
  ]);

  const sessions = sessionsMonth.data ?? [];
  const sessionsPrevData = sessionsPrev.data ?? [];
  const sessionsSparkData = sessionsSparkline.data ?? [];
  const wonMonth = leadsWonMonth.data ?? [];
  const wonPrev = leadsWonPrev.data ?? [];
  const wonSpark = leadsWonSpark.data ?? [];
  const responseLeads = leadsWithResponse.data ?? [];
  const activeLeads = leadsActiveValue.data ?? [];
  const adSpend = (firmResult.data?.monthly_ad_spend as number | null) ?? null;

  // ── KPI calculations ─────────────────────────────────────────────

  const delta = (now: number, prev: number) =>
    prev > 0 ? Math.round(((now - prev) / prev) * 100) : null;

  const inquiriesNow = sessions.length;
  const inquiriesPrev = sessionsPrevData.length;

  const qualifiedNow = sessions.filter(s => s.band === "A" || s.band === "B").length;
  const qualifiedPrev = sessionsPrevData.filter(s => s.band === "A" || s.band === "B").length;

  const signedNow = wonMonth.length;
  const signedPrev = wonPrev.length;

  const cpsc = signedNow > 0 && adSpend !== null
    ? Math.round((adSpend + 3500) / signedNow)
    : null;

  // Median response time in seconds
  let avgResponseSecs: number | null = null;
  if (responseLeads.length > 0) {
    const deltas = responseLeads
      .map(l => (new Date(l.first_contact_at as string).getTime() - new Date(l.created_at as string).getTime()) / 1000)
      .filter(d => d >= 0)
      .sort((a, b) => a - b);
    if (deltas.length > 0) {
      const mid = Math.floor(deltas.length / 2);
      avgResponseSecs = deltas.length % 2 === 0
        ? Math.round((deltas[mid - 1] + deltas[mid]) / 2)
        : Math.round(deltas[mid]);
    }
  }

  const pipelineValue = activeLeads.reduce((s, l) => s + ((l.estimated_value as number | null) ?? 0), 0);

  // ── Sparkline bucketing ──────────────────────────────────────────
  function bucket(rows: { created_at?: string; updated_at?: string; band?: string | null }[], field: "created_at" | "updated_at", bandFilter?: string[]) {
    return weekBoundaries.slice(0, 6).map((wStart, i) => {
      const wEnd = weekBoundaries[i + 1];
      return rows.filter(r => {
        const d = new Date(r[field] as string);
        if (d < wStart || d >= wEnd) return false;
        if (bandFilter) return bandFilter.includes(r.band as string);
        return true;
      }).length;
    });
  }

  const monthLabel = now.toLocaleString("en-CA", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">Partner Dashboard</h1>
        <p className="text-sm text-black/40 mt-1">{monthLabel} · Updates every 5 minutes</p>
      </div>

      <KpiTiles
        firmId={firmId}
        tiles={{
          inquiries: {
            value: inquiriesNow,
            delta: delta(inquiriesNow, inquiriesPrev),
            sparkline: bucket(sessionsSparkData, "created_at"),
          },
          qualified: {
            value: qualifiedNow,
            delta: delta(qualifiedNow, qualifiedPrev),
            sparkline: bucket(sessionsSparkData, "created_at", ["A", "B"]),
          },
          signed: {
            value: signedNow,
            delta: delta(signedNow, signedPrev),
            sparkline: bucket(wonSpark, "updated_at"),
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
        }}
      />
    </div>
  );
}
