"use client";

/**
 * FunnelBar  -  Stage-to-stage funnel conversion above the pipeline kanban.
 *
 * Navy background bar. Each stage shows its count and the drop-off %
 * from the previous stage. Drop-offs > 40% pulse red.
 *
 * Only renders stages from new_lead → client_won (excludes no_show/client_lost
 * which are exits, not funnel steps).
 */

const FUNNEL_STAGES = [
  { key: "new_lead",               label: "Inquiries"   },
  { key: "contacted",              label: "Contacted"   },
  { key: "qualified",              label: "Qualified"   },
  { key: "consultation_scheduled", label: "Booked"      },
  { key: "consultation_held",      label: "Held"        },
  { key: "proposal_sent",          label: "Retainer"    },
  { key: "client_won",             label: "Retained"    },
] as const;

type StageKey = typeof FUNNEL_STAGES[number]["key"];

export interface FunnelCounts {
  [key: string]: number;
}

interface Props {
  counts: FunnelCounts;
}

function pctColor(drop: number | null) {
  if (drop === null) return "text-[#C4B49A]";
  if (drop > 40) return "text-red-400";
  if (drop > 20) return "text-amber-300";
  return "text-[#C4B49A]";
}

function pulseDot(drop: number | null) {
  if (drop !== null && drop > 40) {
    return (
      <span className="relative flex h-1.5 w-1.5 ml-1">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
      </span>
    );
  }
  return null;
}

export default function FunnelBar({ counts }: Props) {
  const stages = FUNNEL_STAGES.map((s, i) => {
    const count = counts[s.key] ?? 0;
    const prevCount = i > 0 ? (counts[FUNNEL_STAGES[i - 1].key] ?? 0) : null;
    const dropPct =
      prevCount !== null && prevCount > 0
        ? Math.round((1 - count / prevCount) * 100)
        : null;
    return { ...s, count, dropPct };
  });

  const hasAnyData = stages.some(s => s.count > 0);
  if (!hasAnyData) return null;

  return (
    <div className="bg-[#1E2F58] rounded-xl px-4 py-3 overflow-x-auto">
      <div className="flex items-stretch gap-0 min-w-max">
        {stages.map((s, i) => (
          <div key={s.key} className="flex items-center">
            {/* Stage block */}
            <div className="flex flex-col items-center px-3 py-1 min-w-[72px]">
              <div className="text-[10px] text-white/50 uppercase tracking-wide mb-0.5">{s.label}</div>
              <div className="text-lg font-bold text-white leading-tight">{s.count}</div>
              {s.dropPct !== null && (
                <div className={`flex items-center text-[10px] font-medium mt-0.5 ${pctColor(s.dropPct)}`}>
                  <span>↓{s.dropPct}%</span>
                  {pulseDot(s.dropPct)}
                </div>
              )}
            </div>

            {/* Arrow between stages */}
            {i < stages.length - 1 && (
              <div className="text-white/20 text-sm px-0.5 self-center">›</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
