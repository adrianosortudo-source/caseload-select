/**
 * ScoreRationaleBlock  -  shared presentational block for the "why this band"
 * rationale. Pure server-compatible component (no hooks, no client APIs).
 *
 * Consumes a ScoreRationale produced by buildScoreRationale() in
 * src/lib/score-rationale.ts. Same visual output across demo, admin, and
 * portal so lawyers see a consistent interpretive layer wherever they land.
 *
 * Props:
 *   rationale      the structured rationale object
 *   compact        hides the strengths/weaknesses grid (firm-facing portal
 *                  surfaces where raw sub-score values should not leak)
 */

import type { ScoreRationale } from "@/lib/score-rationale";

interface Props {
  rationale: ScoreRationale;
  compact?: boolean;
}

export default function ScoreRationaleBlock({ rationale, compact = false }: Props) {
  const { bandLine, strengths, weaknesses, callQuestions, aiAngle } = rationale;

  const showComponents = !compact && (strengths.length > 0 || weaknesses.length > 0);
  const hasContent =
    bandLine ||
    showComponents ||
    callQuestions.length > 0 ||
    aiAngle;

  if (!hasContent) return null;

  return (
    <div className="rounded-xl border border-black/5 bg-white px-4 py-3.5 space-y-3">
      <div className="text-[11px] font-semibold text-black/40 uppercase tracking-widest">
        Why this band
      </div>
      <p className="text-sm text-black/80 leading-relaxed">{bandLine}</p>

      {showComponents && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-black/5">
          {strengths.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1.5">
                Strongest factors
              </div>
              <ul className="space-y-1">
                {strengths.map((s, i) => (
                  <li key={i} className="text-xs text-black/70 leading-snug flex items-baseline justify-between gap-2">
                    <span>{s.label}</span>
                    <span className="font-mono tabular-nums text-black/50 flex-shrink-0">
                      {s.value}<span className="text-black/30">/{s.max}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {weaknesses.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1.5">
                Weakest factors
              </div>
              <ul className="space-y-1">
                {weaknesses.map((w, i) => (
                  <li key={i} className="text-xs text-black/70 leading-snug flex items-baseline justify-between gap-2">
                    <span>{w.label}</span>
                    <span className="font-mono tabular-nums text-black/50 flex-shrink-0">
                      {w.value}<span className="text-black/30">/{w.max}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {callQuestions.length > 0 && (
        <div className="pt-1 border-t border-black/5">
          <div className="text-[10px] font-bold text-black/50 uppercase tracking-wider mb-1.5">
            Fill the gap on the first call
          </div>
          <ul className="space-y-1">
            {callQuestions.map((q, i) => (
              <li key={i} className="text-xs text-black/70 leading-snug flex items-start gap-2">
                <span className="text-black/30 flex-shrink-0">&rarr;</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {aiAngle && (
        <div className="pt-1 border-t border-black/5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="text-[10px] font-bold text-black/50 uppercase tracking-wider">
              Lawyer's angle
            </div>
            <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-1.5 py-0.5 leading-none">
              AI
            </span>
          </div>
          <p className="text-xs text-black/70 leading-snug italic">{aiAngle}</p>
        </div>
      )}
    </div>
  );
}
