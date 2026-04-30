"use client";

/**
 * PipelineBoard  -  Read-only kanban for the client portal.
 *
 * Layout: 3×3 grid — all 9 stages, no hiding, no horizontal scroll.
 *   Row 1: New Inquiry → Contacted → Qualified
 *   Row 2: Consult Booked → Consult Held → Retainer Sent
 *   Row 3: Retained → No Show → Closed-Lost
 *
 * Navigation: 3 dot indicators at the top. Clicking a dot smooth-scrolls
 * to that row. IntersectionObserver keeps the active dot in sync with the
 * viewport as the user scrolls normally.
 *
 * Cards: name + last initial, practice area, band badge, days in stage.
 * Link to the lead intelligence dashboard when href is provided.
 */

import { useState, useEffect, useRef } from "react";
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

const ROWS: Array<{ label: string; stages: string[] }> = [
  { label: "Intake to qualification",  stages: ["new_lead", "contacted", "qualified"] },
  { label: "Consultation",             stages: ["consultation_scheduled", "consultation_held", "proposal_sent"] },
  { label: "Outcomes",                 stages: ["client_won", "no_show", "client_lost"] },
];

// ─── Card ─────────────────────────────────────────────────────────────────────

function LeadCard({ card }: { card: Card }) {
  const band = card.band?.toUpperCase() ?? null;
  const inner = (
    <div className={`bg-white rounded-lg border border-black/6 p-3 shadow-sm space-y-1.5 ${
      card.href ? "hover:border-navy/25 hover:shadow-md transition-all cursor-pointer" : ""
    }`}>
      <div className="flex items-start justify-between gap-2">
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
      <div className="flex items-center justify-between gap-1.5">
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
  const [activeRow, setActiveRow] = useState(0);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([null, null, null]);

  // Map stage key → column for O(1) lookup
  const colsByStage = Object.fromEntries(columns.map(c => [c.stage, c]));

  // IntersectionObserver: whichever row is most in view becomes active
  useEffect(() => {
    const observers = ROWS.map((_, i) => {
      const el = rowRefs.current[i];
      if (!el) return null;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveRow(i); },
        { threshold: 0.25, rootMargin: "0px 0px -40% 0px" }
      );
      obs.observe(el);
      return obs;
    });
    return () => { observers.forEach(o => o?.disconnect()); };
  }, []);

  const scrollToRow = (i: number) => {
    rowRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-8">
      {/* Dot navigation */}
      <div className="flex items-center justify-center gap-3">
        {ROWS.map((row, i) => (
          <button
            key={i}
            onClick={() => scrollToRow(i)}
            aria-label={`Jump to ${row.label}`}
            className="flex items-center gap-2 group"
          >
            <span className={`block rounded-full transition-all duration-200 ${
              i === activeRow
                ? "w-5 h-2 bg-navy"
                : "w-2 h-2 bg-black/20 group-hover:bg-black/40"
            }`} />
            <span className={`text-[10px] font-medium transition-colors ${
              i === activeRow ? "text-navy" : "text-black/30 group-hover:text-black/50"
            }`}>
              {row.label}
            </span>
          </button>
        ))}
      </div>

      {/* 3 row sections */}
      {ROWS.map((row, rowIdx) => (
        <div
          key={row.label}
          ref={el => { rowRefs.current[rowIdx] = el; }}
          className="space-y-3"
        >
          {/* Row label */}
          <div className="flex items-center gap-3">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              rowIdx === 0 ? "bg-navy/40" :
              rowIdx === 1 ? "bg-blue-400" : "bg-black/20"
            }`} />
            <span className="text-xs font-semibold text-black/40 uppercase tracking-widest">
              {row.label}
            </span>
          </div>

          {/* 3-column grid */}
          <div className="grid grid-cols-3 gap-4">
            {row.stages.map(stageKey => {
              const col = colsByStage[stageKey];
              if (!col) return null;
              return (
                <div
                  key={stageKey}
                  className="flex flex-col gap-2 bg-black/[0.025] rounded-xl border border-black/5 p-3"
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-[10px] font-semibold text-black/55 uppercase tracking-wide">
                      {col.label}
                    </span>
                    <span className="text-[10px] text-black/28 tabular-nums">{col.cards.length}</span>
                  </div>

                  {/* Cards */}
                  <div className="space-y-2 min-h-[52px]">
                    {col.cards.length === 0 ? (
                      <div className="text-[11px] text-black/18 py-4 text-center">—</div>
                    ) : (
                      col.cards.map(card => <LeadCard key={card.id} card={card} />)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
