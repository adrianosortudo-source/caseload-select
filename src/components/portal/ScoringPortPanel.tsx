import type { ScoringPortReadResult } from "@/lib/scoring-port-read";

interface ScoringPortPanelProps {
  data: ScoringPortReadResult | null;
}

/**
 * Renders persisted scoring-port columns from the C3 read flag path.
 * Only visible when intake_firms.read_scoring_port = true AND getScoringPortForRead
 * returns non-null. Renders nothing for all firms at the default flag-off state.
 * Pre-backfill rows (flag on but all columns null) show a "pending" notice.
 */
export default function ScoringPortPanel({ data }: ScoringPortPanelProps) {
  if (!data) return null;

  const {
    score_confidence,
    score_completeness,
    score_explanation,
    score_missing_fields,
    score_version,
  } = data;

  // Pre-backfill: flag is on but columns are all null (intake predates C3)
  if (score_confidence === null && score_completeness === null) {
    return (
      <div className="bg-parchment-2 border border-black/10 px-4 py-3 text-xs text-black/50">
        Scoring data not available for this intake (submitted before the scoring engine upgrade).
      </div>
    );
  }

  const confidenceClasses =
    score_confidence === "high"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : score_confidence === "medium"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : score_confidence === "low"
          ? "bg-red-50 text-red-800 border-red-200"
          : "bg-parchment-2 text-black/50 border-black/10";

  const completePct =
    score_completeness !== null
      ? Math.round(Number(score_completeness) * 100)
      : null;

  interface MissingField { slot_id: string; label: string; }
  const missingFields = Array.isArray(score_missing_fields)
    ? (score_missing_fields as MissingField[])
    : [];

  return (
    <div className="bg-white border border-black/10 px-4 py-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs uppercase tracking-wider font-semibold text-black/40">
          Scoring analysis
        </span>
        {score_confidence && (
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold border px-2 py-0.5 ${confidenceClasses}`}
          >
            <span className="uppercase tracking-wider">{score_confidence}</span>
            <span className="normal-case font-normal opacity-70">confidence</span>
          </span>
        )}
        {completePct !== null && (
          <span className="text-xs text-black/60">{completePct}% complete</span>
        )}
        {score_version !== null && (
          <span className="text-xs text-black/30 ml-auto">v{score_version}</span>
        )}
      </div>
      {completePct !== null && (
        <div className="w-full h-1.5 bg-black/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-navy rounded-full transition-all"
            style={{ width: `${completePct}%` }}
          />
        </div>
      )}
      {score_explanation && (
        <p className="text-sm text-black/70 leading-relaxed">{score_explanation}</p>
      )}
      {missingFields.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-black/40 mb-1.5">
            Missing fields
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missingFields.map((field) => (
              <span
                key={field.slot_id}
                className="text-xs text-black/60 bg-black/5 border border-black/10 px-2 py-0.5"
              >
                {field.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
