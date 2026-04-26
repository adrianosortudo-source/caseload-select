/**
 * /portal/[firmId]/dashboard  -  v2 Tier 1 Partner Dashboard
 *
 * Fetches server-side:
 * - 7 KPI tiles (Inquiries, Qualified, Signed, CPSC, Response Time,
 *   Pipeline Value, Funnel Conversion)
 * - Benchmark status per tile (vs industry_benchmarks table)
 * - YoY sparkline comparison (same 6-week window, prior year)
 * - Hero metrics config from firm row
 * - "Since Engagement Start" cumulative totals + monthly CPSC trajectory
 *
 * Auth verified by parent layout.
 */

import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-auth";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import KpiTiles from "./KpiTiles";
import IntakeQualityPanel from "./IntakeQualityPanel";
import type { IntakeQualityReport } from "@/lib/memo";

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

  // ── Date windows ─────────────────────────────────────────────────────────
  const now = new Date();
  const monthStart    = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd  = monthStart;

  // 6-week sparkline window (current + prior year)
  const weekBoundaries: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    d.setHours(0, 0, 0, 0);
    weekBoundaries.push(d);
  }
  const sparklineStart = weekBoundaries[0];

  // Same 6-week window exactly 52 weeks earlier (YoY)
  const yoyOffset = 52 * 7 * 24 * 60 * 60 * 1000;
  const yoySparklineStart = new Date(sparklineStart.getTime() - yoyOffset);
  const yoySparklineEnd   = new Date(now.getTime() - yoyOffset);

  // ── Parallel queries ──────────────────────────────────────────────────────
  const [
    firmResult,
    sessionsMonth,
    sessionsPrev,
    sessionsSparkline,
    sessionsYoy,
    leadsWonMonth,
    leadsWonPrev,
    leadsWonSpark,
    leadsWonYoy,
    leadsWithResponse,
    leadsActiveValue,
    benchmarksResult,
    qualitySessions,
  ] = await Promise.all([
    // Firm config  -  hero_metrics, ad spend, engagement start
    supabase
      .from("intake_firms")
      .select("monthly_ad_spend, hero_metrics, engagement_start_date")
      .eq("id", firmId)
      .single(),

    // This month's sessions
    supabase.from("intake_sessions").select("id, band, created_at")
      .eq("firm_id", firmId).gte("created_at", monthStart.toISOString()),

    // Prior month sessions (for delta)
    supabase.from("intake_sessions").select("id, band")
      .eq("firm_id", firmId)
      .gte("created_at", prevMonthStart.toISOString())
      .lt("created_at", prevMonthEnd.toISOString()),

    // Current 6-week sparkline sessions
    supabase.from("intake_sessions").select("band, created_at")
      .eq("firm_id", firmId).gte("created_at", sparklineStart.toISOString()),

    // YoY 6-week sessions
    supabase.from("intake_sessions").select("band, created_at")
      .eq("firm_id", firmId)
      .gte("created_at", yoySparklineStart.toISOString())
      .lt("created_at", yoySparklineEnd.toISOString()),

    // This month signed cases
    supabase.from("leads").select("id, stage, updated_at")
      .eq("law_firm_id", firmId).eq("stage", "client_won")
      .gte("updated_at", monthStart.toISOString()),

    // Prior month signed
    supabase.from("leads").select("id")
      .eq("law_firm_id", firmId).eq("stage", "client_won")
      .gte("updated_at", prevMonthStart.toISOString())
      .lt("updated_at", prevMonthEnd.toISOString()),

    // Current sparkline signed
    supabase.from("leads").select("stage, updated_at")
      .eq("law_firm_id", firmId).eq("stage", "client_won")
      .gte("updated_at", sparklineStart.toISOString()),

    // YoY sparkline signed
    supabase.from("leads").select("stage, updated_at")
      .eq("law_firm_id", firmId).eq("stage", "client_won")
      .gte("updated_at", yoySparklineStart.toISOString())
      .lt("updated_at", yoySparklineEnd.toISOString()),

    // Response time SLA data (this month)
    supabase.from("leads").select("first_contact_at, created_at")
      .eq("law_firm_id", firmId)
      .gte("created_at", monthStart.toISOString())
      .not("first_contact_at", "is", null),

    // Active pipeline value
    supabase.from("leads").select("estimated_value")
      .eq("law_firm_id", firmId)
      .not("stage", "in", "(client_won,client_lost)"),

    // Industry benchmarks
    supabase.from("industry_benchmarks").select("metric_key, benchmark_value, direction"),

    // Sessions with quality data this month (scoring._quality written by memo generator)
    supabase.from("intake_sessions")
      .select("scoring")
      .eq("firm_id", firmId)
      .gte("created_at", monthStart.toISOString())
      .not("scoring->_quality", "is", null),
  ]);

  // ── Unpack ────────────────────────────────────────────────────────────────
  const firmData       = firmResult.data;
  const sessions       = sessionsMonth.data ?? [];
  const sessionsPrevData = sessionsPrev.data ?? [];
  const sessionsSparkData = sessionsSparkline.data ?? [];
  const sessionsYoyData   = sessionsYoy.data ?? [];
  const wonMonth       = leadsWonMonth.data ?? [];
  const wonPrev        = leadsWonPrev.data ?? [];
  const wonSpark       = leadsWonSpark.data ?? [];
  const wonYoy         = leadsWonYoy.data ?? [];
  const responseLeads  = leadsWithResponse.data ?? [];
  const activeLeads    = leadsActiveValue.data ?? [];
  const adSpend        = (firmData?.monthly_ad_spend as number | null) ?? null;
  const heroMetrics    = (firmData?.hero_metrics as string[] | null) ?? ["signed","cpsc","avgResponseSecs"];
  const engagementStart = (firmData?.engagement_start_date as string | null) ?? null;

  // Build benchmark lookup
  const benchmarks: Record<string, { value: number; direction: "higher_better" | "lower_better" }> = {};
  for (const b of benchmarksResult.data ?? []) {
    benchmarks[b.metric_key] = {
      value: Number(b.benchmark_value),
      direction: b.direction as "higher_better" | "lower_better",
    };
  }

  // ── Intake quality aggregation ────────────────────────────────────────────
  const qualityRows = (qualitySessions.data ?? [])
    .map(r => (r.scoring as Record<string, unknown>)?._quality as IntakeQualityReport | undefined)
    .filter((q): q is IntakeQualityReport => !!q);

  const qualityTierCounts: Record<IntakeQualityReport["qualityTier"], number> = {
    complete: 0, adequate: 0, partial: 0, sparse: 0,
  };
  let qualityScoreSum = 0;
  const gapFreq: Record<string, number> = {};

  for (const q of qualityRows) {
    qualityTierCounts[q.qualityTier] = (qualityTierCounts[q.qualityTier] ?? 0) + 1;
    qualityScoreSum += q.completenessScore;
    for (const gap of q.gaps ?? []) {
      gapFreq[gap] = (gapFreq[gap] ?? 0) + 1;
    }
  }

  const qualityAvgScore = qualityRows.length > 0
    ? Math.round(qualityScoreSum / qualityRows.length)
    : null;

  const topGaps = Object.entries(gapFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  // ── KPI calculations ──────────────────────────────────────────────────────
  const delta = (curr: number, prev: number) =>
    prev > 0 ? Math.round(((curr - prev) / prev) * 100) : null;

  const inquiriesNow  = sessions.length;
  const inquiriesPrev = sessionsPrevData.length;

  const qualifiedNow  = sessions.filter(s => s.band === "A" || s.band === "B").length;
  const qualifiedPrev = sessionsPrevData.filter(s => s.band === "A" || s.band === "B").length;

  const signedNow  = wonMonth.length;
  const signedPrev = wonPrev.length;

  const cpsc = signedNow > 0 && adSpend !== null
    ? Math.round((adSpend + 3500) / signedNow)
    : null;

  // Funnel conversion: qualified → signed (% of Band A+B that reached client_won)
  const funnelConversion = qualifiedNow > 0
    ? Math.round((signedNow / qualifiedNow) * 100)
    : null;

  // Median response time
  let avgResponseSecs: number | null = null;
  if (responseLeads.length > 0) {
    const deltas = responseLeads
      .map(l =>
        (new Date(l.first_contact_at as string).getTime() -
          new Date(l.created_at as string).getTime()) / 1000
      )
      .filter(d => d >= 0)
      .sort((a, b) => a - b);
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
    bandFilter?: string[],
    boundaries = weekBoundaries
  ) {
    return boundaries.slice(0, 6).map((wStart, i) => {
      const wEnd = boundaries[i + 1];
      return rows.filter(r => {
        const d = new Date(r[field] as string);
        if (d < wStart || d >= wEnd) return false;
        if (bandFilter) return bandFilter.includes(r.band as string);
        return true;
      }).length;
    });
  }

  // YoY boundaries: same 6-week shape, shifted 52 weeks back
  const yoyBoundaries = weekBoundaries.map(d => new Date(d.getTime() - yoyOffset));

  const inquiriesSparkline   = bucket(sessionsSparkData, "created_at");
  const inquiriesYoy         = bucket(sessionsYoyData, "created_at", undefined, yoyBoundaries);
  const qualifiedSparkline   = bucket(sessionsSparkData, "created_at", ["A", "B"]);
  const qualifiedYoy         = bucket(sessionsYoyData, "created_at", ["A", "B"], yoyBoundaries);
  const signedSparkline      = bucket(wonSpark, "updated_at");
  const signedYoy            = bucket(wonYoy, "updated_at", undefined, yoyBoundaries);

  // Only include YoY data when there's actually prior-year data
  const hasYoyData = (arr: number[]) => arr.some(v => v > 0);

  // ── Engagement panel  -  cumulative since engagement_start_date ────────────
  interface EngagementMonth {
    label: string;
    signed: number;
    adSpend: number | null;
  }

  let totalEngInquiries = 0;
  let totalEngQualified = 0;
  let totalEngSigned    = 0;
  const engagementMonthlyPoints: EngagementMonth[] = [];

  if (engagementStart) {
    const startDate = new Date(engagementStart);

    const [engSessions, engSigned] = await Promise.all([
      supabase.from("intake_sessions").select("band, created_at")
        .eq("firm_id", firmId)
        .gte("created_at", startDate.toISOString()),
      supabase.from("leads").select("updated_at")
        .eq("law_firm_id", firmId).eq("stage", "client_won")
        .gte("updated_at", startDate.toISOString()),
    ]);

    const engSessionData = engSessions.data ?? [];
    const engSignedData  = engSigned.data ?? [];

    totalEngInquiries = engSessionData.length;
    totalEngQualified = engSessionData.filter(s => s.band === "A" || s.band === "B").length;
    totalEngSigned    = engSignedData.length;

    // Build monthly buckets
    const monthMap: Record<string, { signed: number }> = {};
    for (const l of engSignedData) {
      const d = new Date(l.updated_at as string);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!monthMap[key]) monthMap[key] = { signed: 0 };
      monthMap[key].signed++;
    }

    // Enumerate months from start to now
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const end    = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    while (cursor < end) {
      const key   = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      const label = cursor.toLocaleString("en-CA", { month: "short", year: "2-digit" });
      engagementMonthlyPoints.push({
        label,
        signed:  monthMap[key]?.signed ?? 0,
        adSpend: adSpend,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  // ── Benchmark dots ────────────────────────────────────────────────────────
  const b = (key: string, value: number | null) =>
    benchmarkStatus(value, benchmarks[key]?.value ?? 0, benchmarks[key]?.direction ?? "higher_better");

  const monthLabel = now.toLocaleString("en-CA", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">Partner Dashboard</h1>
        <p className="text-sm text-black/40 mt-1">{monthLabel} · Updates every 5 minutes</p>
      </div>

      <KpiTiles
        firmId={firmId}
        heroMetrics={heroMetrics}
        monthlyAdSpend={adSpend}
        engagementStartDate={engagementStart}
        totalEngagementInquiries={totalEngInquiries}
        totalEngagementQualified={totalEngQualified}
        totalEngagementSigned={totalEngSigned}
        engagementMonthlyPoints={engagementMonthlyPoints}
        tiles={{
          inquiries: {
            value: inquiriesNow,
            delta: delta(inquiriesNow, inquiriesPrev),
            sparkline: inquiriesSparkline,
            yoySparkline: hasYoyData(inquiriesYoy) ? inquiriesYoy : null,
            benchmark: b("inquiries", inquiriesNow),
          },
          qualified: {
            value: qualifiedNow,
            delta: delta(qualifiedNow, qualifiedPrev),
            sparkline: qualifiedSparkline,
            yoySparkline: hasYoyData(qualifiedYoy) ? qualifiedYoy : null,
            benchmark: b("qualified", qualifiedNow),
          },
          signed: {
            value: signedNow,
            delta: delta(signedNow, signedPrev),
            sparkline: signedSparkline,
            yoySparkline: hasYoyData(signedYoy) ? signedYoy : null,
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

      <IntakeQualityPanel
        avgScore={qualityAvgScore}
        tierCounts={qualityTierCounts}
        topGaps={topGaps}
        sessionCount={qualityRows.length}
      />
    </div>
  );
}
