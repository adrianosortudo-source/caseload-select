/**
 * /demo/portal/dashboard — Live demo partner dashboard.
 *
 * Renders the full v2 KPI dashboard for the Hartwell Law PC demo firm.
 * No auth required. All data is real (populated by demo intake submissions).
 *
 * Intentionally shows benchmark dots and funnel conversion so prospects
 * see the complete product, not a stripped-down preview.
 */

import { redirect } from "next/navigation";
import { getDemoFirmId } from "@/lib/demo-firm";
import { supabase } from "@/lib/supabase";
import KpiTiles from "@/app/portal/[firmId]/dashboard/KpiTiles";

export const dynamic = "force-dynamic";

type BenchmarkStatus = "green" | "amber" | "red" | null;

function benchmarkStatus(
  value: number | null,
  benchmarkValue: number,
  direction: "higher_better" | "lower_better"
): BenchmarkStatus {
  if (value === null) return null;
  const ratio =
    direction === "lower_better"
      ? benchmarkValue / Math.max(value, 1)
      : value / Math.max(benchmarkValue, 1);
  if (ratio >= 1) return "green";
  if (ratio >= 0.7) return "amber";
  return "red";
}

export default async function DemoPortalDashboard() {
  const firmId = await getDemoFirmId();
  if (!firmId) redirect("/demo");

  // ── Date windows ─────────────────────────────────────────────────────────
  const now = new Date();
  const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd   = monthStart;

  const weekBoundaries: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    d.setHours(0, 0, 0, 0);
    weekBoundaries.push(d);
  }
  const sparklineStart = weekBoundaries[0];

  // ── Parallel queries ──────────────────────────────────────────────────────
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
    benchmarksResult,
  ] = await Promise.all([
    supabase.from("intake_firms")
      .select("monthly_ad_spend, hero_metrics, engagement_start_date")
      .eq("id", firmId).single(),

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

    supabase.from("leads").select("id")
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

    supabase.from("industry_benchmarks")
      .select("metric_key, benchmark_value, direction"),
  ]);

  const sessions        = sessionsMonth.data ?? [];
  const sessionsPrevData = sessionsPrev.data ?? [];
  const sessionsSparkData = sessionsSparkline.data ?? [];
  const wonMonth        = leadsWonMonth.data ?? [];
  const wonPrev         = leadsWonPrev.data ?? [];
  const wonSpark        = leadsWonSpark.data ?? [];
  const responseLeads   = leadsWithResponse.data ?? [];
  const activeLeads     = leadsActiveValue.data ?? [];
  const adSpend         = (firmResult.data?.monthly_ad_spend as number | null) ?? null;
  const heroMetrics     = (firmResult.data?.hero_metrics as string[] | null) ?? ["signed","cpsc","avgResponseSecs"];
  const engagementStart = (firmResult.data?.engagement_start_date as string | null) ?? null;

  const benchmarks: Record<string, { value: number; direction: "higher_better" | "lower_better" }> = {};
  for (const b of benchmarksResult.data ?? []) {
    benchmarks[b.metric_key] = {
      value: Number(b.benchmark_value),
      direction: b.direction as "higher_better" | "lower_better",
    };
  }

  // ── KPI calcs ─────────────────────────────────────────────────────────────
  const delta = (curr: number, prev: number) =>
    prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null;

  const inquiriesNow  = sessions.length;
  const inquiriesPrev = sessionsPrevData.length;
  const qualifiedNow  = sessions.filter(s => s.band === "A" || s.band === "B").length;
  const qualifiedPrev = sessionsPrevData.filter(s => s.band === "A" || s.band === "B").length;
  const signedNow     = wonMonth.length;
  const signedPrev    = wonPrev.length;

  const cpsc = signedNow > 0 && adSpend !== null
    ? Math.round((adSpend + 3500) / signedNow) : null;

  const funnelConversion = qualifiedNow > 0
    ? Math.round((signedNow / qualifiedNow) * 100) : null;

  let avgResponseSecs: number | null = null;
  if (responseLeads.length > 0) {
    const deltas = responseLeads
      .map(l => (new Date(l.first_contact_at as string).getTime() - new Date(l.created_at as string).getTime()) / 1000)
      .filter(d => d >= 0).sort((a, b) => a - b);
    if (deltas.length > 0) {
      const mid = Math.floor(deltas.length / 2);
      avgResponseSecs = deltas.length % 2 === 0
        ? Math.round((deltas[mid - 1] + deltas[mid]) / 2)
        : Math.round(deltas[mid]);
    }
  }

  const pipelineValue = activeLeads.reduce(
    (s, l) => s + ((l.estimated_value as number | null) ?? 0), 0
  );

  // ── Sparkline bucketing ───────────────────────────────────────────────────
  function bucket(
    rows: { created_at?: string; updated_at?: string; band?: string | null }[],
    field: "created_at" | "updated_at",
    bandFilter?: string[]
  ) {
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

  const b = (key: string, value: number | null) =>
    benchmarkStatus(value, benchmarks[key]?.value ?? 0, benchmarks[key]?.direction ?? "higher_better");

  const monthLabel = now.toLocaleString("en-CA", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">Partner Dashboard</h1>
        <p className="text-sm text-black/40 mt-1">{monthLabel} · Live demo data</p>
      </div>

      <KpiTiles
        firmId={firmId}
        heroMetrics={heroMetrics}
        monthlyAdSpend={adSpend}
        engagementStartDate={engagementStart}
        totalEngagementInquiries={inquiriesNow}
        totalEngagementQualified={qualifiedNow}
        totalEngagementSigned={signedNow}
        engagementMonthlyPoints={[]}
        tiles={{
          inquiries: {
            value: inquiriesNow,
            delta: delta(inquiriesNow, inquiriesPrev),
            sparkline: bucket(sessionsSparkData, "created_at"),
            benchmark: b("inquiries", inquiriesNow),
          },
          qualified: {
            value: qualifiedNow,
            delta: delta(qualifiedNow, qualifiedPrev),
            sparkline: bucket(sessionsSparkData, "created_at", ["A", "B"]),
            benchmark: b("qualified", qualifiedNow),
          },
          signed: {
            value: signedNow,
            delta: delta(signedNow, signedPrev),
            sparkline: bucket(wonSpark, "updated_at"),
            benchmark: b("signed", signedNow),
          },
          cpsc: {
            value: cpsc,
            delta: null,
            sparkline: null,
            benchmark: b("cpsc", cpsc),
          },
          avgResponseSecs: {
            value: avgResponseSecs,
            delta: null,
            sparkline: null,
            benchmark: b("avgResponseSecs", avgResponseSecs),
          },
          pipelineValue: {
            value: pipelineValue,
            delta: null,
            sparkline: null,
            benchmark: b("pipelineValue", pipelineValue),
          },
          funnelConversion: {
            value: funnelConversion,
            delta: null,
            sparkline: null,
            benchmark: b("funnelConversion", funnelConversion),
          },
        }}
      />
    </div>
  );
}
