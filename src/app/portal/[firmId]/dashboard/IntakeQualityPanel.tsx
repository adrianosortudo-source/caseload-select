"use client";

/**
 * IntakeQualityPanel  -  Aggregate intake quality for the partner dashboard.
 *
 * Shows the average completeness score and tier distribution for sessions
 * that completed Round 3 this month. Data comes from scoring._quality stored
 * during memo generation.
 *
 * Designed to be rendered below the KPI tiles  -  always visible, no sparklines.
 */

import type { IntakeQualityReport } from "@/lib/memo";

interface Props {
  avgScore: number | null;
  tierCounts: Record<IntakeQualityReport["qualityTier"], number>;
  topGaps: string[];
  sessionCount: number;
}

const TIER_COLOR: Record<IntakeQualityReport["qualityTier"], string> = {
  complete: "bg-emerald-500",
  adequate: "bg-blue-400",
  partial:  "bg-amber-400",
  sparse:   "bg-red-400",
};

const TIER_LABEL: Record<IntakeQualityReport["qualityTier"], string> = {
  complete: "Complete",
  adequate: "Adequate",
  partial:  "Partial",
  sparse:   "Sparse",
};

export default function IntakeQualityPanel({ avgScore, tierCounts, topGaps, sessionCount }: Props) {
  if (sessionCount === 0) return null;

  const tiers: IntakeQualityReport["qualityTier"][] = ["complete", "adequate", "partial", "sparse"];
  const total = tiers.reduce((s, t) => s + (tierCounts[t] ?? 0), 0);

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Intake Quality</h2>
          <p className="text-xs text-gray-400 mt-0.5">{sessionCount} session{sessionCount !== 1 ? "s" : ""} with quality data this month</p>
        </div>
        {avgScore !== null && (
          <div className="text-right">
            <span className="text-2xl font-bold text-gray-900">{avgScore}</span>
            <span className="text-sm text-gray-400">/100</span>
            <p className="text-xs text-gray-400">avg completeness</p>
          </div>
        )}
      </div>

      {/* Tier distribution bar */}
      {total > 0 && (
        <div className="space-y-2">
          <div className="flex rounded-full overflow-hidden h-2 gap-px">
            {tiers.map(t => {
              const count = tierCounts[t] ?? 0;
              if (count === 0) return null;
              const pct = (count / total) * 100;
              return (
                <div
                  key={t}
                  className={`${TIER_COLOR[t]} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${TIER_LABEL[t]}: ${count}`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {tiers.map(t => {
              const count = tierCounts[t] ?? 0;
              if (count === 0) return null;
              return (
                <div key={t} className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${TIER_COLOR[t]}`} />
                  <span className="text-xs text-gray-600">{TIER_LABEL[t]} <span className="text-gray-400">{count}</span></span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top gaps */}
      {topGaps.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5">Most common gaps to probe</p>
          <div className="flex flex-wrap gap-1.5">
            {topGaps.map(g => (
              <span
                key={g}
                className="inline-block px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-xs text-amber-800 font-mono"
              >
                {g}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
