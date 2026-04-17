"use client";

/**
 * FilterCard — FACT Phase F (Filter) card.
 *
 * Shows:
 * - Horizontal stacked bar: band A–E distribution for current month
 * - SLA compliance arc gauge (% leads contacted within 60s)
 * - Band E filter count
 */

const BAND_COLORS: Record<string, string> = {
  A: "#27834A",
  B: "#1E2F58",
  C: "#C4B49A",
  D: "#8090A8",
  E: "#c0564e",
};

function SlaGauge({ pct, hasSamples }: { pct: number; hasSamples: boolean }) {
  // SVG arc gauge — 180 degree sweep
  const r = 40;
  const cx = 60;
  const cy = 55;
  const circumference = Math.PI * r; // half-circle arc length
  const progress = hasSamples ? Math.min(pct, 100) / 100 : 0;
  const strokeDash = progress * circumference;
  const strokeGap = circumference - strokeDash;

  const color = pct >= 80 ? "#27834A" : pct >= 50 ? "#C4A45A" : "#c0564e";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={120} height={65} viewBox="0 0 120 65" aria-label={`SLA compliance: ${pct}%`}>
        {/* Track */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* Progress */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${strokeDash} ${strokeGap}`}
        />
        {/* Label */}
        {hasSamples ? (
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize="15" fontWeight="700" fill={color}>
            {pct}%
          </text>
        ) : (
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize="11" fill="#9ca3af">
            No data
          </text>
        )}
      </svg>
      <span className="text-xs text-black/50 text-center">
        Leads contacted within 60s
      </span>
    </div>
  );
}

interface Props {
  bandDist: Record<string, number>;
  total: number;
  bandECount: number;
  slaCompliance: number;
  slaHasSamples: boolean;
}

export default function FilterCard({ bandDist, total, bandECount, slaCompliance, slaHasSamples }: Props) {
  const bands = ["A", "B", "C", "D", "E"] as const;
  const totalNonZero = Math.max(1, total);

  return (
    <div className="bg-white rounded-xl border border-black/5 shadow-sm p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-black/40">Phase F</div>
          <div className="text-base font-bold text-navy mt-0.5">Filter</div>
        </div>
        <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-medium">
          Active
        </span>
      </div>

      {/* Band distribution stacked bar */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-black/60">Band Distribution: This Month</div>
        {total === 0 ? (
          <div className="text-sm text-black/30 py-2">No inquiries yet this month.</div>
        ) : (
          <>
            <div className="flex h-5 rounded-full overflow-hidden gap-px">
              {bands.map((b) => {
                const count = bandDist[b] ?? 0;
                const pct = (count / totalNonZero) * 100;
                if (pct === 0) return null;
                return (
                  <div
                    key={b}
                    style={{ width: `${pct}%`, backgroundColor: BAND_COLORS[b] }}
                    title={`Band ${b}: ${count} (${Math.round(pct)}%)`}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-3">
              {bands.map((b) => {
                const count = bandDist[b] ?? 0;
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={b} className="flex items-center gap-1.5 text-xs">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: BAND_COLORS[b] }}
                    />
                    <span className="text-black/60">
                      <span className="font-semibold text-black/80">{b}</span> {count} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* SLA gauge */}
      <SlaGauge pct={slaCompliance} hasSamples={slaHasSamples} />

      {/* Band E stat */}
      <div className="flex items-center justify-between border-t border-black/5 pt-3">
        <span className="text-xs text-black/50">Filtered out (Band E)</span>
        <span className="text-sm font-semibold text-red-600">{bandECount}</span>
      </div>
    </div>
  );
}
