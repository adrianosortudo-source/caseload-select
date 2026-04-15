"use client";

/**
 * KpiTiles — Client component for Tier 1 Partner Dashboard.
 *
 * Renders 6 KPI tiles in a 2x3 grid. Handles:
 * - Big number display
 * - Delta vs prior month (arrow + percentage)
 * - 6-week SVG sparkline
 * - Auto-refresh every 5 minutes from API route
 */

import { useEffect, useState, useCallback } from "react";
import Sparkline from "@/components/portal/Sparkline";

interface TileData {
  value: number | null;
  delta: number | null;
  sparkline: number[] | null;
}

interface TilesMap {
  inquiries: TileData;
  qualified: TileData;
  signed: TileData;
  cpsc: TileData;
  avgResponseSecs: TileData;
  pipelineValue: TileData;
}

interface Props {
  firmId: string;
  tiles: TilesMap;
}

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

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-black/30">—</span>;
  if (pct === 0) return <span className="text-xs text-black/40">→ flat</span>;
  const up = pct > 0;
  return (
    <span className={`text-xs font-medium flex items-center gap-0.5 ${up ? "text-emerald-600" : "text-red-500"}`}>
      <span>{up ? "↑" : "↓"}</span>
      <span>{Math.abs(pct)}%</span>
    </span>
  );
}

function KpiTile({
  label,
  value,
  delta,
  sparkline,
  valueClass = "text-navy",
  sub,
}: {
  label: string;
  value: string | number;
  delta?: number | null;
  sparkline?: number[] | null;
  valueClass?: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-black/5 shadow-sm p-5 flex flex-col gap-3">
      <div className="text-xs text-black/50 uppercase tracking-wide font-medium">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className={`text-3xl font-bold ${valueClass}`}>{value}</div>
          {sub && <div className="text-xs text-black/40 mt-0.5">{sub}</div>}
          {delta !== undefined && <div className="mt-1"><Delta pct={delta ?? null} /></div>}
        </div>
        {sparkline && sparkline.some(v => v > 0) && (
          <Sparkline data={sparkline} color="#1E2F58" width={80} height={28} />
        )}
      </div>
    </div>
  );
}

export default function KpiTiles({ firmId, tiles: initial }: Props) {
  const [tiles, setTiles] = useState<TilesMap>(initial);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${firmId}/dashboard`);
      if (!res.ok) return;
      const json = await res.json() as { tiles: TilesMap };
      setTiles(json.tiles);
    } catch {
      // Silent — stale data is fine
    }
  }, [firmId]);

  useEffect(() => {
    const interval = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  const {
    inquiries, qualified, signed, cpsc, avgResponseSecs, pipelineValue,
  } = tiles;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      <KpiTile
        label="Inquiries This Month"
        value={inquiries.value ?? 0}
        delta={inquiries.delta}
        sparkline={inquiries.sparkline}
      />
      <KpiTile
        label="Qualified Leads"
        value={qualified.value ?? 0}
        delta={qualified.delta}
        sparkline={qualified.sparkline}
        sub="Band A + B"
      />
      <KpiTile
        label="Signed Cases"
        value={signed.value ?? 0}
        delta={signed.delta}
        sparkline={signed.sparkline}
      />
      <KpiTile
        label="Cost per Signed Case"
        value={cpsc.value !== null ? formatCurrency(cpsc.value) : "n/a"}
        sub={cpsc.value === null ? "No signed cases or ad spend" : undefined}
        valueClass={cpsc.value !== null ? "text-navy" : "text-black/30"}
      />
      <KpiTile
        label="Avg Response Time"
        value={formatResponseTime(avgResponseSecs.value)}
        valueClass={responseTimeColor(avgResponseSecs.value)}
        sub={
          avgResponseSecs.value === null
            ? "No response data yet"
            : avgResponseSecs.value < 60
              ? "Under 60s target"
              : avgResponseSecs.value <= 300
                ? "60-300s range"
                : "Over 300s — review"
        }
      />
      <KpiTile
        label="Pipeline Value"
        value={formatCurrency(pipelineValue.value ?? 0)}
        sub="Active leads only"
        valueClass="text-navy"
      />
    </div>
  );
}
