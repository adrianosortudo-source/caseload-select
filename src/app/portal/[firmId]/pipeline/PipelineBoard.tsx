"use client";

/**
 * PipelineBoard — Read-only kanban for the client portal.
 *
 * No drag-drop, no stage mutations, no CPI scores.
 * Shows: first name + last initial, practice area, band badge, days in stage.
 */

const BAND_STYLE: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800 border-emerald-200",
  B: "bg-blue-100   text-blue-800   border-blue-200",
  C: "bg-amber-100  text-amber-800  border-amber-200",
  D: "bg-orange-100 text-orange-800 border-orange-200",
  E: "bg-red-100    text-red-800    border-red-200",
};

const BAND_DOT: Record<string, string> = {
  A: "bg-emerald-500",
  B: "bg-blue-500",
  C: "bg-amber-500",
  D: "bg-orange-500",
  E: "bg-red-500",
};

interface Card {
  id: string;
  name: string;
  practice_area: string | null;
  band: string | null;
  days_in_stage: number;
}

interface Column {
  stage: string;
  label: string;
  cards: Card[];
}

function LeadCard({ card }: { card: Card }) {
  const band = card.band?.toUpperCase() ?? null;
  return (
    <div className="bg-white rounded-lg border border-black/6 p-3 shadow-sm space-y-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-black/80 leading-snug">{card.name}</span>
        {band && (
          <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${BAND_STYLE[band] ?? "bg-black/5 text-black/40 border-black/10"}`}>
            {band}
          </span>
        )}
      </div>
      {card.practice_area && (
        <span className="inline-block text-[10px] bg-navy/8 text-navy rounded px-1.5 py-0.5 font-medium capitalize">
          {card.practice_area}
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-black/35">
          {card.days_in_stage === 0 ? "Today" : `${card.days_in_stage}d in stage`}
        </span>
      </div>
    </div>
  );
}

export default function PipelineBoard({ columns }: { columns: Column[] }) {
  return (
    <div className="overflow-x-auto -mx-6 px-6">
      <div className="flex gap-3" style={{ minWidth: `${columns.length * 220}px` }}>
        {columns.map((col) => (
          <div
            key={col.stage}
            className="flex flex-col gap-2 bg-black/[0.02] rounded-xl border border-black/5 p-3"
            style={{ width: 210, minWidth: 210 }}
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-1 py-0.5">
              <span className="text-xs font-semibold text-black/60 uppercase tracking-wide truncate">
                {col.label}
              </span>
              <span className="text-xs text-black/35 ml-2 shrink-0">{col.cards.length}</span>
            </div>

            {/* Cards */}
            <div className="space-y-2 min-h-[60px]">
              {col.cards.length === 0 ? (
                <div className="text-[11px] text-black/20 px-1 py-3 text-center">Empty</div>
              ) : (
                col.cards.map(card => (
                  <LeadCard key={card.id} card={card} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
