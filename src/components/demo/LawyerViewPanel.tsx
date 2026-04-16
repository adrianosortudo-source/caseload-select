"use client";

/**
 * LawyerViewPanel — post-finalization demo overlay.
 *
 * Shows the prospect exactly what lands in the lawyer's pipeline after
 * intake completes. Rendered only in demo mode (demoMode=true on IntakeWidget).
 *
 * Five sections:
 *   1. Band + CPI score header
 *   2. Pipeline lead card preview
 *   3. Full case summary (what the lawyer reads first)
 *   4. CPI score breakdown (Fit + Value components)
 *   5. Actions fired (retainer, lead promotion, nurture)
 */

import { useEffect } from "react";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface FullCpi {
  total: number;
  band: "A" | "B" | "C" | "D" | "E" | null;
  fit_score: number;
  value_score: number;
  geo_score: number;
  practice_score: number;
  legitimacy_score: number;
  referral_score: number;
  urgency_score: number;
  complexity_score: number;
  multi_practice_score: number;
  fee_score: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  band: "A" | "B" | "C" | "D" | "E" | null;
  cpi: FullCpi;
  situationSummary: string | null;
  practiceArea: string | null;
  contactName: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const BAND_META: Record<string, { label: string; bg: string; text: string; ring: string }> = {
  A: { label: "Band A", bg: "bg-emerald-500",  text: "text-white",       ring: "ring-emerald-200" },
  B: { label: "Band B", bg: "bg-blue-500",     text: "text-white",       ring: "ring-blue-200" },
  C: { label: "Band C", bg: "bg-amber-500",    text: "text-white",       ring: "ring-amber-200" },
  D: { label: "Band D", bg: "bg-orange-400",   text: "text-white",       ring: "ring-orange-200" },
  E: { label: "Band E", bg: "bg-gray-400",     text: "text-white",       ring: "ring-gray-200" },
};

function ScoreBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-full bg-[#1E2F58] rounded-full transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ScoreRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-gray-500 w-28 shrink-0">{label}</span>
      <ScoreBar value={value} max={max} />
      <span className="text-[11px] font-semibold text-gray-700 w-10 text-right shrink-0">
        {value}<span className="text-gray-400 font-normal">/{max}</span>
      </span>
    </div>
  );
}

const BAND_ACTIONS: Record<string, string[]> = {
  A: [
    "Retainer agreement queued for delivery via DocuSeal.",
    "Lead promoted to pipeline — stage: New Lead.",
  ],
  B: [
    "Retainer agreement queued for delivery via DocuSeal.",
    "Lead promoted to pipeline — stage: New Lead.",
  ],
  C: ["Lead promoted to pipeline — stage: New Lead.", "Nurture track assigned."],
  D: ["Lead added to long-term nurture track. No attorney time allocated."],
  E: ["No lead created. No attorney time used. Inquiry closed."],
};

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function LawyerViewPanel({
  open,
  onClose,
  band,
  cpi,
  situationSummary,
  practiceArea,
  contactName,
}: Props) {
  const b = band ?? "E";
  const meta = BAND_META[b] ?? BAND_META["E"];
  const actions = BAND_ACTIONS[b] ?? BAND_ACTIONS["E"];

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  // Truncate summary to first sentence for the lead card preview
  const cardSummary = situationSummary
    ? situationSummary.split(/(?<=[.!?])\s/)[0] ?? situationSummary.slice(0, 120)
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative z-10 w-full sm:max-w-[540px] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-xs font-semibold text-[#1E2F58] uppercase tracking-widest mb-0.5">
              CaseLoad Select
            </p>
            <h2 className="text-base font-bold text-gray-900">
              Here&apos;s what just landed in your pipeline.
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

          {/* Section 1: Band + score */}
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-sm font-bold ${meta.bg} ${meta.text} ring-4 ${meta.ring}`}>
              {meta.label}
            </span>
            <span className="text-2xl font-extrabold text-gray-900">{cpi.total}</span>
            <span className="text-sm text-gray-400">/ 100</span>
            <span className="ml-auto text-xs text-gray-400 font-medium">
              Fit {cpi.fit_score}/40 · Value {cpi.value_score}/60
            </span>
          </div>

          {/* Section 2: Lead card preview */}
          <div className="bg-[#F4F3EF] rounded-xl px-4 py-3 border border-gray-200">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
              Pipeline lead card
            </p>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{contactName || "Demo Lead"}</p>
                {practiceArea && (
                  <p className="text-xs text-gray-500 mt-0.5">{practiceArea}</p>
                )}
                {cardSummary && (
                  <p className="text-xs text-gray-400 mt-1.5 leading-relaxed line-clamp-2">{cardSummary}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>
                  {meta.label}
                </span>
                <span className="text-[10px] text-gray-400">CPI {cpi.total}</span>
                <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded">caseload_screen</span>
              </div>
            </div>
          </div>

          {/* Section 3: Full case summary */}
          {situationSummary && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">
                What your lawyer reads first
              </p>
              <div className="bg-gray-50 rounded-xl px-4 py-3 border-l-4 border-[#1E2F58]">
                <p className="text-sm text-gray-700 leading-relaxed">{situationSummary}</p>
              </div>
            </div>
          )}

          {/* Section 4: CPI breakdown */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
              CPI breakdown
            </p>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Fit — {cpi.fit_score} / 40
              </p>
              <ScoreRow label="Geographic"    value={cpi.geo_score}        max={10} />
              <ScoreRow label="Practice match" value={cpi.practice_score}   max={10} />
              <ScoreRow label="Legitimacy"    value={cpi.legitimacy_score} max={10} />
              <ScoreRow label="Referral"      value={cpi.referral_score}   max={10} />
            </div>
            <div className="space-y-1 mt-3">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Value — {cpi.value_score} / 60
              </p>
              <ScoreRow label="Urgency"       value={cpi.urgency_score}       max={20} />
              <ScoreRow label="Complexity"    value={cpi.complexity_score}    max={25} />
              <ScoreRow label="Multi-practice" value={cpi.multi_practice_score} max={5} />
              <ScoreRow label="Fee tier"      value={cpi.fee_score}           max={10} />
            </div>
          </div>

          {/* Section 5: Actions fired */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
              Actions fired
            </p>
            <div className="space-y-2">
              {actions.map(action => (
                <div key={action} className="flex items-start gap-2">
                  <div className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-700">{action}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Demo disclaimer */}
          <p className="text-[10px] text-gray-400 text-center pb-1">
            Demo only. No data was saved or sent to any CRM.
          </p>

        </div>

        {/* Close button footer */}
        <div className="px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-[#1E2F58] hover:opacity-90 transition-all active:scale-[0.98]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
