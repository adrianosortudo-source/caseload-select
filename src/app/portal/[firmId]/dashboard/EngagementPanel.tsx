"use client";

/**
 * EngagementPanel — Collapsible "Since Engagement Start" summary.
 *
 * Shows cumulative totals from the firm's engagement_start_date:
 * total inquiries, qualified leads, signed cases, CPSC trajectory.
 *
 * Lazy reveal via toggle — doesn't add to initial paint cost.
 */

import { useState } from "react";

interface MonthPoint {
  label: string;   // e.g. "Jan 2026"
  signed: number;
  adSpend: number | null;
}

interface Props {
  engagementStartDate: string | null;  // ISO date string
  totalInquiries: number;
  totalQualified: number;
  totalSigned: number;
  monthlyPoints: MonthPoint[];         // chronological, up to 24 months
  monthlyAdSpend: number | null;       // current monthly retainer for CPSC
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString("en-CA")}`;
}

function CpscBar({ points, monthlyFee }: { points: MonthPoint[]; monthlyFee: number | null }) {
  if (points.length === 0 || monthlyFee === null) {
    return (
      <div className="text-xs text-black/30 py-2 text-center">
        No CPSC data — configure monthly ad spend to enable.
      </div>
    );
  }

  const cpscPoints = points
    .filter(p => p.signed > 0)
    .map(p => ({
      label: p.label,
      cpsc: Math.round((monthlyFee + (p.adSpend ?? 0)) / p.signed),
    }));

  if (cpscPoints.length === 0) {
    return <div className="text-xs text-black/30 py-2 text-center">No signed cases yet in this period.</div>;
  }

  const maxCpsc = Math.max(...cpscPoints.map(p => p.cpsc));

  return (
    <div className="space-y-1.5">
      {cpscPoints.map((p) => (
        <div key={p.label} className="flex items-center gap-2">
          <div className="w-16 text-right text-[10px] text-black/40 shrink-0">{p.label}</div>
          <div className="flex-1 bg-black/5 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-navy/40"
              style={{ width: `${Math.min(100, (p.cpsc / maxCpsc) * 100)}%` }}
            />
          </div>
          <div className="w-14 text-[10px] text-black/60 font-medium shrink-0">
            {formatCurrency(p.cpsc)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EngagementPanel({
  engagementStartDate,
  totalInquiries,
  totalQualified,
  totalSigned,
  monthlyPoints,
  monthlyAdSpend,
}: Props) {
  const [open, setOpen] = useState(false);

  const startLabel = engagementStartDate
    ? new Date(engagementStartDate).toLocaleDateString("en-CA", { month: "long", year: "numeric" })
    : null;

  const qualRate = totalInquiries > 0
    ? Math.round((totalQualified / totalInquiries) * 100)
    : null;

  return (
    <div className="bg-white rounded-xl border border-black/5 shadow-sm overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-black/[0.01] transition"
        aria-expanded={open}
      >
        <div>
          <div className="text-sm font-semibold text-navy">Since Engagement Start</div>
          {startLabel && (
            <div className="text-xs text-black/40 mt-0.5">From {startLabel}</div>
          )}
        </div>
        <span className={`text-black/30 text-lg leading-none transition-transform ${open ? "rotate-180" : ""}`}>
          ↓
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 border-t border-black/5">
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3 pt-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-navy">{totalInquiries}</div>
              <div className="text-[10px] text-black/40 uppercase tracking-wide mt-0.5">Inquiries</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-navy">{totalQualified}</div>
              <div className="text-[10px] text-black/40 uppercase tracking-wide mt-0.5">
                Qualified
                {qualRate !== null && (
                  <span className="ml-1 text-black/30">({qualRate}%)</span>
                )}
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-navy">{totalSigned}</div>
              <div className="text-[10px] text-black/40 uppercase tracking-wide mt-0.5">Signed</div>
            </div>
          </div>

          {/* CPSC trajectory */}
          <div>
            <div className="text-xs font-medium text-black/50 uppercase tracking-wide mb-2">
              Cost per Signed Case — Monthly
            </div>
            <CpscBar points={monthlyPoints} monthlyFee={monthlyAdSpend ? monthlyAdSpend + 3500 : null} />
          </div>
        </div>
      )}
    </div>
  );
}
