"use client";

/**
 * PipelineLayoutPicker  -  5 layout prototypes for the pipeline kanban.
 *
 * Variant 1 — Arrow nav:     hidden scrollbar, left/right arrow buttons
 * Variant 2 — Hide empty:    only render columns that have at least one lead
 * Variant 3 — Stage tabs:    tab per stage, vertical card list below
 * Variant 4 — Two-row grid:  active pipeline (row 1) + resolved (row 2)
 * Variant 5 — Snap scroll:   narrower columns, CSS scroll-snap, dot indicators
 *
 * A tab strip at the top lets you switch between them. Wire into the demo
 * pipeline page by swapping <PipelineBoard> for <PipelineLayoutPicker>.
 */

import { useState, useRef, useCallback } from "react";
import Link from "next/link";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface Card {
  id: string;
  name: string;
  practice_area: string | null;
  band: string | null;
  days_in_stage: number;
  href?: string;
}

export interface Column {
  stage: string;
  label: string;
  cards: Card[];
}

// ─── Shared constants ─────────────────────────────────────────────────────────

const BAND_STYLE: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800 border-emerald-200",
  B: "bg-blue-100   text-blue-800   border-blue-200",
  C: "bg-amber-100  text-amber-800  border-amber-200",
  D: "bg-orange-100 text-orange-800 border-orange-200",
  E: "bg-red-100    text-red-800    border-red-200",
  X: "bg-amber-100  text-amber-900  border-amber-300",
};

// ─── Shared card component ────────────────────────────────────────────────────

function LeadCard({ card, compact = false }: { card: Card; compact?: boolean }) {
  const band = card.band?.toUpperCase() ?? null;
  const inner = (
    <div className={`bg-white rounded-lg border border-black/6 shadow-sm space-y-1.5 ${
      compact ? "p-2.5" : "p-3"
    } ${card.href ? "hover:border-navy/25 hover:shadow-md transition-all cursor-pointer" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`font-medium text-black/80 leading-snug ${compact ? "text-xs" : "text-sm"}`}>
          {card.name}
        </span>
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
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[10px] text-black/35">
          {card.days_in_stage === 0 ? "Today" : `${card.days_in_stage}d in stage`}
        </span>
        {card.href && <span className="text-[10px] text-navy/45 font-medium">View →</span>}
      </div>
    </div>
  );
  return card.href ? <Link href={card.href}>{inner}</Link> : inner;
}

function ColHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between px-1 py-0.5 mb-1">
      <span className="text-[10px] font-semibold text-black/55 uppercase tracking-wide truncate">{label}</span>
      <span className="text-[10px] text-black/30 ml-2 shrink-0">{count}</span>
    </div>
  );
}

function ColWrapper({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`flex flex-col gap-2 bg-black/[0.025] rounded-xl border border-black/5 p-3 ${className}`} style={style}>
      {children}
    </div>
  );
}

// ─── Variant 1: Arrow navigation ─────────────────────────────────────────────
// Hidden native scrollbar. Left/right arrow buttons scroll the track.

const COL_W = 210;
const COL_GAP = 12;

function ArrowNavLayout({ columns }: { columns: Column[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft]   = useState(false);
  const [canRight, setCanRight] = useState(true);

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  const scroll = (dir: -1 | 1) => {
    ref.current?.scrollBy({ left: dir * (COL_W + COL_GAP) * 2, behavior: "smooth" });
  };

  return (
    <div className="relative">
      {/* Left arrow */}
      <button
        onClick={() => scroll(-1)}
        disabled={!canLeft}
        aria-label="Scroll left"
        className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white border border-black/10 shadow flex items-center justify-center transition ${
          canLeft ? "opacity-100 hover:shadow-md cursor-pointer" : "opacity-0 pointer-events-none"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
      </button>

      {/* Scrollable track — no scrollbar */}
      <div
        ref={ref}
        onScroll={sync}
        className="overflow-x-scroll px-1"
        style={{ scrollbarWidth: "none" } as React.CSSProperties}
      >
        <div className="flex gap-3" style={{ minWidth: `${columns.length * (COL_W + COL_GAP)}px` }}>
          {columns.map(col => (
            <ColWrapper key={col.stage} style={{ width: COL_W, minWidth: COL_W } as React.CSSProperties}>
              <ColHeader label={col.label} count={col.cards.length} />
              <div className="space-y-2 min-h-[60px]">
                {col.cards.length === 0
                  ? <div className="text-[11px] text-black/20 py-3 text-center">Empty</div>
                  : col.cards.map(c => <LeadCard key={c.id} card={c} />)
                }
              </div>
            </ColWrapper>
          ))}
        </div>
      </div>

      {/* Right arrow */}
      <button
        onClick={() => scroll(1)}
        disabled={!canRight}
        aria-label="Scroll right"
        className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white border border-black/10 shadow flex items-center justify-center transition ${
          canRight ? "opacity-100 hover:shadow-md cursor-pointer" : "opacity-0 pointer-events-none"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
      </button>

      {/* Column count hint */}
      <p className="text-center text-[10px] text-black/30 mt-3">
        {columns.length} stages — use arrows or swipe to navigate
      </p>
    </div>
  );
}

// ─── Variant 2: Hide empty columns ────────────────────────────────────────────
// Only renders columns that have at least one lead. Empty stages shown as a
// compact pill strip below so nothing is lost from view.

function HideEmptyLayout({ columns }: { columns: Column[] }) {
  const visible = columns.filter(c => c.cards.length > 0);
  const hidden  = columns.filter(c => c.cards.length === 0);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto -mx-6 px-6">
        <div className="flex gap-3" style={{ minWidth: `${visible.length * (COL_W + COL_GAP)}px` }}>
          {visible.map(col => (
            <ColWrapper key={col.stage} style={{ width: COL_W, minWidth: COL_W } as React.CSSProperties}>
              <ColHeader label={col.label} count={col.cards.length} />
              <div className="space-y-2">
                {col.cards.map(c => <LeadCard key={c.id} card={c} />)}
              </div>
            </ColWrapper>
          ))}
        </div>
      </div>

      {hidden.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          <span className="text-[10px] text-black/30 mt-1 mr-1">Empty stages:</span>
          {hidden.map(col => (
            <span key={col.stage} className="text-[10px] px-2 py-1 rounded-full bg-black/5 text-black/35 border border-black/8">
              {col.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Variant 3: Stage filter tabs ────────────────────────────────────────────
// One tab per stage. Selecting a tab shows that stage's cards as a vertical list.
// Tabs show lead count. Empty stages are dimmed but still selectable.

function TabsLayout({ columns }: { columns: Column[] }) {
  const [activeStage, setActiveStage] = useState(
    columns.find(c => c.cards.length > 0)?.stage ?? columns[0]?.stage ?? ""
  );
  const active = columns.find(c => c.stage === activeStage);

  return (
    <div className="space-y-4">
      {/* Tab strip */}
      <div className="flex gap-1.5 flex-wrap border-b border-black/8 pb-3">
        {columns.map(col => {
          const isActive = col.stage === activeStage;
          const isEmpty = col.cards.length === 0;
          return (
            <button
              key={col.stage}
              onClick={() => setActiveStage(col.stage)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                isActive
                  ? "bg-navy text-white"
                  : isEmpty
                  ? "bg-transparent text-black/25 hover:text-black/45"
                  : "bg-black/5 text-black/60 hover:bg-black/8"
              }`}
            >
              {col.label}
              <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${
                isActive ? "bg-white/20 text-white" : isEmpty ? "text-black/20" : "bg-black/10 text-black/50"
              }`}>
                {col.cards.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Card grid for active stage */}
      {active && (
        active.cards.length === 0 ? (
          <div className="bg-black/[0.02] rounded-xl border border-black/5 p-10 text-center text-black/30 text-sm">
            No leads in {active.label}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {active.cards.map(c => <LeadCard key={c.id} card={c} />)}
          </div>
        )
      )}
    </div>
  );
}

// ─── Variant 4: Two-row grid ──────────────────────────────────────────────────
// Row 1 — active pipeline (New → Consult Held): the live deals
// Row 2 — outcomes (Retainer Sent, Won, No Show, Lost): resolved states
// Columns stretch to fill width. No overflow scroll.

const ROW1_KEYS = ["new_lead", "contacted", "qualified", "consultation_scheduled", "consultation_held"];
const ROW2_KEYS = ["proposal_sent", "client_won", "no_show", "client_lost"];

const ROW1_LABEL = "Active pipeline";
const ROW2_LABEL = "Outcomes";

function TwoRowLayout({ columns }: { columns: Column[] }) {
  const row1 = columns.filter(c => ROW1_KEYS.includes(c.stage));
  const row2 = columns.filter(c => ROW2_KEYS.includes(c.stage));

  const Row = ({ cols, label }: { cols: Column[]; label: string }) => (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest px-1">{label}</div>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
        {cols.map(col => (
          <ColWrapper key={col.stage}>
            <ColHeader label={col.label} count={col.cards.length} />
            <div className="space-y-2 min-h-[48px]">
              {col.cards.length === 0
                ? <div className="text-[11px] text-black/18 py-2 text-center">—</div>
                : col.cards.map(c => <LeadCard key={c.id} card={c} compact />)
              }
            </div>
          </ColWrapper>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <Row cols={row1} label={ROW1_LABEL} />
      <Row cols={row2} label={ROW2_LABEL} />
    </div>
  );
}

// ─── Variant 5: Snap scroll + dot indicators ──────────────────────────────────
// Narrower columns (168px). CSS scroll-snap-type: x mandatory. Dot strip below
// tracks scroll position and acts as clickable navigation.

const SNAP_COL_W = 168;
const SNAP_COL_GAP = 10;

function SnapScrollLayout({ columns }: { columns: Column[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / (SNAP_COL_W + SNAP_COL_GAP));
    setActiveIdx(Math.max(0, Math.min(idx, columns.length - 1)));
  }, [columns.length]);

  const scrollTo = (idx: number) => {
    ref.current?.scrollTo({
      left: idx * (SNAP_COL_W + SNAP_COL_GAP),
      behavior: "smooth",
    });
  };

  // How many columns fit in the viewport (approximate)
  const visibleCount = Math.floor((typeof window !== "undefined" ? window.innerWidth - 48 : 600) / (SNAP_COL_W + SNAP_COL_GAP));
  const dotCount = Math.max(1, columns.length - visibleCount + 1);

  return (
    <div className="space-y-3">
      {/* Scrollable track with snap */}
      <div
        ref={ref}
        onScroll={handleScroll}
        className="overflow-x-scroll"
        style={{
          scrollSnapType: "x mandatory",
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
        } as React.CSSProperties}
      >
        <div
          className="flex"
          style={{ gap: SNAP_COL_GAP, minWidth: `${columns.length * (SNAP_COL_W + SNAP_COL_GAP)}px` }}
        >
          {columns.map((col, i) => (
            <ColWrapper
              key={col.stage}
              style={{
                width: SNAP_COL_W,
                minWidth: SNAP_COL_W,
                scrollSnapAlign: "start",
              } as React.CSSProperties}
            >
              <ColHeader label={col.label} count={col.cards.length} />
              <div className="space-y-1.5 min-h-[48px]">
                {col.cards.length === 0
                  ? <div className="text-[11px] text-black/20 py-3 text-center">Empty</div>
                  : col.cards.map(c => <LeadCard key={c.id} card={c} compact />)
                }
              </div>
            </ColWrapper>
          ))}
        </div>
      </div>

      {/* Dot nav */}
      <div className="flex items-center justify-center gap-1.5">
        {Array.from({ length: dotCount }).map((_, i) => (
          <button
            key={i}
            onClick={() => scrollTo(i)}
            aria-label={`Scroll to position ${i + 1}`}
            className={`rounded-full transition-all ${
              i === activeIdx
                ? "w-4 h-1.5 bg-navy"
                : "w-1.5 h-1.5 bg-black/20 hover:bg-black/40"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Variant switcher (main export) ──────────────────────────────────────────

const VARIANTS = [
  { key: "arrows",     label: "1 — Arrow nav"     },
  { key: "hide-empty", label: "2 — Hide empty"    },
  { key: "tabs",       label: "3 — Stage tabs"    },
  { key: "two-rows",   label: "4 — Two rows"      },
  { key: "snap",       label: "5 — Snap + dots"   },
] as const;

type VariantKey = typeof VARIANTS[number]["key"];

const DESCRIPTIONS: Record<VariantKey, string> = {
  "arrows":     "Hidden scrollbar — left/right arrows scroll two columns at a time.",
  "hide-empty": "Only columns with at least one lead are shown. Empty stages appear as pills below.",
  "tabs":       "One tab per stage. Click a tab to see that stage's leads in a responsive grid.",
  "two-rows":   "Active pipeline (New → Held) on top. Outcomes (Retainer, Won, No Show, Lost) on bottom.",
  "snap":       "Narrower columns with CSS scroll-snap. Dot indicators show position and act as nav.",
};

export default function PipelineLayoutPicker({ columns }: { columns: Column[] }) {
  const [variant, setVariant] = useState<VariantKey>("arrows");

  return (
    <div className="space-y-4">
      {/* Switcher strip */}
      <div className="bg-black/[0.025] rounded-xl border border-black/5 p-3 space-y-2">
        <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest px-1">Layout prototype</div>
        <div className="flex gap-2 flex-wrap">
          {VARIANTS.map(v => (
            <button
              key={v.key}
              onClick={() => setVariant(v.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                variant === v.key
                  ? "bg-navy text-white"
                  : "bg-white border border-black/10 text-black/55 hover:border-black/20"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-black/40 px-1">{DESCRIPTIONS[variant]}</p>
      </div>

      {/* Active layout */}
      {variant === "arrows"     && <ArrowNavLayout   columns={columns} />}
      {variant === "hide-empty" && <HideEmptyLayout  columns={columns} />}
      {variant === "tabs"       && <TabsLayout        columns={columns} />}
      {variant === "two-rows"   && <TwoRowLayout      columns={columns} />}
      {variant === "snap"       && <SnapScrollLayout  columns={columns} />}
    </div>
  );
}
