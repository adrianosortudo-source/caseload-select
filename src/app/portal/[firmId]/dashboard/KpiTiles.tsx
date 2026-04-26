"use client";

/**
 * KpiTiles  -  v2 Tier 1 Partner Dashboard.
 *
 * Hero row: 3 configurable tiles (firm's hero_metrics setting).
 * Standard grid: 7 tiles  -  Inquiries, Qualified, Signed, CPSC,
 *   Avg Response, Pipeline Value, Funnel Conversion.
 *
 * Each tile shows: value, MoM delta, 6-week sparkline (with optional
 * YoY dashed comparison), and a benchmark status dot (●).
 *
 * Auto-refreshes every 5 minutes from the dashboard API route.
 */

import { useEffect, useState, useCallback } from "react";
import Sparkline from "@/components/portal/Sparkline";
import EngagementPanel from "./EngagementPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

type BenchmarkStatus = "green" | "amber" | "red" | null;

interface TileData {
  value: number | null;
  delta: number | null;
  sparkline: number[] | null;
  yoySparkline?: number[] | null;
  benchmark?: BenchmarkStatus;
}

interface TilesMap {
  inquiries:        TileData;
  qualified:        TileData;
  signed:           TileData;
  cpsc:             TileData;
  avgResponseSecs:  TileData;
  pipelineValue:    TileData;
  funnelConversion: TileData;
}

interface MonthPoint {
  label: string;
  signed: number;
  adSpend: number | null;
}

interface Props {
  firmId: string;
  tiles: TilesMap;
  heroMetrics: string[];        // e.g. ["signed","cpsc","avgResponseSecs"]
  monthlyAdSpend: number | null;
  engagementStartDate: string | null;
  totalEngagementInquiries: number;
  totalEngagementQualified: number;
  totalEngagementSigned: number;
  engagementMonthlyPoints: MonthPoint[];
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString("en-CA")}`;
}

function formatResponseTime(secs: number | null): string {
  if (secs === null) return "n/a";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${Math.round(secs / 3600)}h`;
}

function responseTimeColor(secs: number | null): string {
  if (secs === null) return "text-black/40";
  if (secs < 60) return "text-emerald-600";
  if (secs <= 300) return "text-amber-600";
  return "text-red-600";
}

function funnelColor(pct: number | null): string {
  if (pct === null) return "text-black/40";
  if (pct >= 15) return "text-emerald-600";
  if (pct >= 8) return "text-amber-600";
  return "text-red-600";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-black/30"> - </span>;
  if (pct === 0) return <span className="text-xs text-black/40">→ flat</span>;
  const up = pct > 0;
  return (
    <span className={`text-xs font-medium flex items-center gap-0.5 ${up ? "text-emerald-600" : "text-red-500"}`}>
      <span>{up ? "↑" : "↓"}</span>
      <span>{Math.abs(pct)}%</span>
    </span>
  );
}

const BENCHMARK_DOT: Record<NonNullable<BenchmarkStatus>, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-400",
  red:   "bg-red-500",
};

const BENCHMARK_TITLE: Record<NonNullable<BenchmarkStatus>, string> = {
  green: "At or above industry benchmark",
  amber: "Within 30% of industry benchmark",
  red:   "Below industry benchmark",
};

function BenchmarkDot({ status }: { status: BenchmarkStatus }) {
  if (!status) return null;
  return (
    <span
      title={BENCHMARK_TITLE[status]}
      className={`w-2 h-2 rounded-full shrink-0 ${BENCHMARK_DOT[status]}`}
    />
  );
}

// ─── Tile ─────────────────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  delta,
  sparkline,
  yoySparkline,
  benchmark,
  valueClass = "text-navy",
  sub,
  hero = false,
}: {
  label: string;
  value: string | number;
  delta?: number | null;
  sparkline?: number[] | null;
  yoySparkline?: number[] | null;
  benchmark?: BenchmarkStatus;
  valueClass?: string;
  sub?: string;
  hero?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl border border-black/5 shadow-sm p-5 flex flex-col gap-3 ${hero ? "border-navy/10 shadow-md" : ""}`}>
      <div className="flex items-center justify-between gap-1">
        <div className={`uppercase tracking-wide font-medium ${hero ? "text-xs text-navy/60" : "text-xs text-black/50"}`}>
          {label}
        </div>
        <BenchmarkDot status={benchmark ?? null} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className={`font-bold ${valueClass} ${hero ? "text-4xl" : "text-3xl"}`}>{value}</div>
          {sub && <div className="text-xs text-black/40 mt-0.5">{sub}</div>}
          {delta !== undefined && (
            <div className="mt-1">
              <Delta pct={delta ?? null} />
            </div>
          )}
        </div>
        {sparkline && sparkline.some(v => v > 0) && (
          <Sparkline
            data={sparkline}
            yoyData={yoySparkline}
            color="#1E2F58"
            width={hero ? 96 : 80}
            height={hero ? 34 : 28}
          />
        )}
      </div>
    </div>
  );
}

// ─── Tile config ──────────────────────────────────────────────────────────────

type TileKey = keyof TilesMap;

interface TileConfig {
  key: TileKey;
  label: string;
  getValue: (tiles: TilesMap, adSpend: number | null) => string | number;
  getValueClass: (tiles: TilesMap) => string;
  getSub: (tiles: TilesMap, adSpend: number | null) => string | undefined;
}

const TILE_CONFIG: Record<TileKey, TileConfig> = {
  inquiries: {
    key: "inquiries",
    label: "Inquiries This Month",
    getValue: (t) => t.inquiries.value ?? 0,
    getValueClass: () => "text-navy",
    getSub: () => undefined,
  },
  qualified: {
    key: "qualified",
    label: "Qualified Leads",
    getValue: (t) => t.qualified.value ?? 0,
    getValueClass: () => "text-navy",
    getSub: () => "Band A + B",
  },
  signed: {
    key: "signed",
    label: "Signed Cases",
    getValue: (t) => t.signed.value ?? 0,
    getValueClass: () => "text-navy",
    getSub: () => undefined,
  },
  cpsc: {
    key: "cpsc",
    label: "Cost per Signed Case",
    getValue: (t) => t.cpsc.value !== null ? formatCurrency(t.cpsc.value) : "n/a",
    getValueClass: (t) => t.cpsc.value !== null ? "text-navy" : "text-black/30",
    getSub: (t) => t.cpsc.value === null ? "No signed cases or ad spend" : undefined,
  },
  avgResponseSecs: {
    key: "avgResponseSecs",
    label: "Median Response Time",
    getValue: (t) => formatResponseTime(t.avgResponseSecs.value),
    getValueClass: (t) => responseTimeColor(t.avgResponseSecs.value),
    getSub: (t) => {
      const s = t.avgResponseSecs.value;
      if (s === null) return "No response data yet";
      if (s < 60) return "Under 60s target";
      if (s <= 300) return "60–300s range";
      return "Over 300s: review";
    },
  },
  pipelineValue: {
    key: "pipelineValue",
    label: "Pipeline Value",
    getValue: (t) => formatCurrency(t.pipelineValue.value ?? 0),
    getValueClass: () => "text-navy",
    getSub: () => "Active leads only",
  },
  funnelConversion: {
    key: "funnelConversion",
    label: "Funnel Conversion",
    getValue: (t) => t.funnelConversion.value !== null ? `${t.funnelConversion.value}%` : "n/a",
    getValueClass: (t) => funnelColor(t.funnelConversion.value),
    getSub: (t) => {
      const v = t.funnelConversion.value;
      if (v === null) return "Qualified → Signed";
      if (v >= 15) return "Strong conversion rate";
      if (v >= 8) return "Moderate: room to improve";
      return "Low: review qualification";
    },
  },
};

const STANDARD_ORDER: TileKey[] = [
  "inquiries", "qualified", "signed",
  "cpsc", "avgResponseSecs", "pipelineValue", "funnelConversion",
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function KpiTiles({
  firmId,
  tiles: initial,
  heroMetrics,
  monthlyAdSpend,
  engagementStartDate,
  totalEngagementInquiries,
  totalEngagementQualified,
  totalEngagementSigned,
  engagementMonthlyPoints,
}: Props) {
  const [tiles, setTiles] = useState<TilesMap>(initial);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${firmId}/dashboard`);
      if (!res.ok) return;
      const json = await res.json() as { tiles: TilesMap };
      setTiles(json.tiles);
    } catch {
      // Silent  -  stale data is fine
    }
  }, [firmId]);

  useEffect(() => {
    const interval = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Resolve hero keys  -  fall back gracefully if key is invalid
  const heroKeys = heroMetrics
    .filter((k): k is TileKey => k in TILE_CONFIG)
    .slice(0, 3);

  const heroSet = new Set(heroKeys);

  return (
    <div className="space-y-4">
      {/* Hero row */}
      {heroKeys.length > 0 && (
        <div className={`grid gap-4 grid-cols-${heroKeys.length} md:grid-cols-${heroKeys.length}`}
          style={{ gridTemplateColumns: `repeat(${heroKeys.length}, minmax(0, 1fr))` }}
        >
          {heroKeys.map((key) => {
            const cfg = TILE_CONFIG[key];
            const td = tiles[key];
            return (
              <KpiTile
                key={key}
                hero
                label={cfg.label}
                value={cfg.getValue(tiles, monthlyAdSpend)}
                valueClass={cfg.getValueClass(tiles)}
                sub={cfg.getSub(tiles, monthlyAdSpend)}
                delta={td.delta}
                sparkline={td.sparkline}
                yoySparkline={td.yoySparkline}
                benchmark={td.benchmark}
              />
            );
          })}
        </div>
      )}

      {/* Standard 7-tile grid  -  non-hero tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {STANDARD_ORDER.filter(k => !heroSet.has(k)).map((key) => {
          const cfg = TILE_CONFIG[key];
          const td = tiles[key];
          return (
            <KpiTile
              key={key}
              label={cfg.label}
              value={cfg.getValue(tiles, monthlyAdSpend)}
              valueClass={cfg.getValueClass(tiles)}
              sub={cfg.getSub(tiles, monthlyAdSpend)}
              delta={td.delta}
              sparkline={td.sparkline}
              yoySparkline={td.yoySparkline}
              benchmark={td.benchmark}
            />
          );
        })}
      </div>

      {/* Engagement panel */}
      <EngagementPanel
        engagementStartDate={engagementStartDate}
        totalInquiries={totalEngagementInquiries}
        totalQualified={totalEngagementQualified}
        totalSigned={totalEngagementSigned}
        monthlyPoints={engagementMonthlyPoints}
        monthlyAdSpend={monthlyAdSpend}
      />
    </div>
  );
}
