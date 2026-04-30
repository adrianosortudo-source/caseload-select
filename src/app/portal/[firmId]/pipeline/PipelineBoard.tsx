"use client";

/**
 * PipelineBoard  -  Read-only swimlane pipeline.
 *
 * Layout: 9 rows, one per stage. Stage label + count on the left (fixed
 * width). Lead cards flow horizontally to the right, wrapping if needed.
 * Full vertical scroll — no tabs, no dots, no horizontal scroll.
 */

import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Card {
  id: string;
  name: string;
  practice_area: string | null;
  band: string | null;
  days_in_stage: number;
  href?: string;
}

interface Column {
  stage: string;
  label: string;
  cards: Card[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BAND_STYLE: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800 border-emerald-200",
  B: "bg-blue-100   text-blue-800   border-blue-200",
  C: "bg-amber-100  text-amber-800  border-amber-200",
  D: "bg-orange-100 text-orange-800 border-orange-200",
  E: "bg-red-100    text-red-800    border-red-200",
  X: "bg-amber-100  text-amber-900  border-amber-300",
};

// Visual accent per stage
const STAGE_ACCENT: Record<string, string> = {
  new_lead:               "bg-navy/40",
  contacted:              "bg-navy/30",
  qualified:              "bg-navy/20",
  consultation_scheduled: "bg-blue-400",
  consultation_held:      "bg-blue-300",
  proposal_sent:          "bg-blue-200",
  client_won:             "bg-emerald-400",
  no_show:                "bg-black/20",
  client_lost:            "bg-black/15",
};

// ─── Card ─────────────────────────────────────────────────────────────────────

function LeadCard({ card }: { card: Card }) {
  const band = card.band?.toUpperCase() ?? null;
  const inner = (
    <div className={`w-44 flex-shrink-0 bg-white rounded-lg border border-black/6 p-3 shadow-sm space-y-1.5 ${
      card.href ? "hover:border-navy/25 hover:shadow-md transition-all cursor-pointer" : ""
    }`}>
      <div className="flex items-start justify-between gap-1.5">
        <span className="text-sm font-medium text-black/80 leading-snug">{card.name}</span>
        {band && (
          <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${
            BAND_STYLE[band] ?? "bg-black/5 text-black/40 border-black/10"
          }`}>
            {band}
          </span>
        )}
      </div>
      {card.practice_area && (
        <span className="inline-block text-[10px] bg-navy/8 text-navy rounded px-1.5 py-0.5 font-medium capitalize">
          {card.practice_area}
        </span>
      )}
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] text-black/35">
          {card.days_in_stage === 0 ? "Today" : `${card.days_in_stage}d in stage`}
        </span>
        {card.href && (
          <span className="text-[10px] text-navy/45 font-medium">View →</span>
        )}
      </div>
    </div>
  );

  return card.href ? <Link href={card.href}>{inner}</Link> : inner;
}

// ─── Board ────────────────────────────────────────────────────────────────────

export default function PipelineBoard({ columns }: { columns: Column[] }) {
  return (
    <div className="divide-y divide-black/[0.05]">
      {columns.map((col) => {
        const accent = STAGE_ACCENT[col.stage] ?? "bg-black/15";
        return (
          <div key={col.stage} className="flex items-start gap-5 py-4">

            {/* Stage label — fixed width */}
            <div className="w-36 flex-shrink-0 flex items-center gap-2 pt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${accent}`} />
              <div className="min-w-0">
                <span className="block text-[11px] font-semibold text-black/55 uppercase tracking-wide leading-tight">
                  {col.label}
                </span>
                <span className="block text-[10px] text-black/28 tabular-nums mt-0.5">
                  {col.cards.length} lead{col.cards.length !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            {/* Cards — horizontal flex, wrap */}
            <div className="flex flex-wrap gap-3 flex-1 min-h-[60px]">
              {col.cards.length === 0 ? (
                <span className="text-[11px] text-black/18 self-center">—</span>
              ) : (
                col.cards.map(card => <LeadCard key={card.id} card={card} />)
              )}
            </div>

          </div>
        );
      })}
    </div>
  );
}
