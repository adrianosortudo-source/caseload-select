"use client";

/**
 * LiveScoringPanel — operator's view of the engine state, updated live.
 *
 * Used in /widget-v2/demo/[firmId] split-screen demo. Right-hand panel that
 * shows the AI's scoring decisions in real time as the lead taps through the
 * intake. Designed for sales demos: visually impressive, makes the AI's value
 * obvious, distinguishes operator view from prospect view.
 *
 * Visual treatment:
 *  - Dark navy bg (operator/admin tone, distinct from prospect's parchment)
 *  - Big animated CPI score
 *  - Band badge with brand colour coding (A=emerald, B=blue, C=lighter, D=gray, E=gray)
 *  - Practice area + sub-type pills
 *  - Score factor bars (whatever the engine returns)
 *  - Live answer log at the bottom
 */

import { useEffect, useState } from "react";
import type { ScoreSnapshot, AnswerLogEntry } from "./IntakeControllerV2";

interface Props {
  snapshot: ScoreSnapshot | null;
  log: AnswerLogEntry[];
  /** Controller step. When "done", panel renders a final-result treatment. */
  step?: string;
}

const BAND_STYLE: Record<string, { bg: string; text: string; ring: string; label: string }> = {
  A: { bg: "bg-emerald-500", text: "text-emerald-50",  ring: "ring-emerald-300/50", label: "Strong fit" },
  B: { bg: "bg-blue-500",    text: "text-blue-50",     ring: "ring-blue-300/50",    label: "Good fit" },
  C: { bg: "bg-sky-400",     text: "text-sky-50",      ring: "ring-sky-300/50",     label: "Possible fit" },
  D: { bg: "bg-slate-400",   text: "text-slate-50",    ring: "ring-slate-300/40",   label: "Weak fit" },
  E: { bg: "bg-slate-500",   text: "text-slate-100",   ring: "ring-slate-400/40",   label: "Outside criteria" },
};

export function LiveScoringPanel({ snapshot, log, step }: Props) {
  const cpi    = snapshot?.cpi ?? {};
  const band   = snapshot?.band ?? null;
  // The CaseLoad Screen engine returns the numeric score on `cpi.total` (CpiBreakdown).
  // Form-scored leads (scoring.ts) use `priority_index`. Accept either, fall back to legacy.
  // Final fallback: sum all known sub-scores so the panel shows SOMETHING even if the
  // engine forgot to send the aggregate field on a given response.
  const factors = collectFactors(cpi);
  const summedFromFactors = factors.reduce((acc, f) => acc + f.value, 0);
  const score  = numberFrom(cpi.total ?? cpi.priority_index ?? cpi.cpi_score ?? cpi.score)
    ?? (summedFromFactors > 0 ? summedFromFactors : null);
  const bandStyle = band ? BAND_STYLE[band] : null;
  const isFinal = step === "done";

  return (
    <div className="h-full bg-[#0d1520] text-white flex flex-col" style={{ fontFamily: "DM Sans, sans-serif" }}>
      {/* Header strip */}
      <div className="px-6 py-4 border-b border-white/8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isFinal ? "bg-emerald-300" : "bg-emerald-400 animate-pulse"}`} />
          <span className="text-[12px] uppercase tracking-[0.16em] text-white/55 font-medium">
            {isFinal ? "Final case file" : "Live operator view"}
          </span>
        </div>
        <span className="text-[11px] text-white/40">CaseLoad Screen Engine</span>
      </div>

      {/* Score hero */}
      <div className={`px-6 pt-7 pb-5 ${isFinal && bandStyle ? "border-b border-white/8" : ""}`}>
        {isFinal && (
          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-300/80 font-semibold mb-2">
            Lead qualification complete
          </p>
        )}
        <div className="flex items-end gap-3">
          <AnimatedScore value={score} />
          <span className="text-[16px] text-white/40 mb-2">/ 100</span>
        </div>

        {bandStyle ? (
          <div className={`mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${bandStyle.bg} ${bandStyle.text} ring-2 ${bandStyle.ring}`}>
            <span className="text-[15px] font-bold">Band {band}</span>
            <span className="text-[12px] opacity-90">— {bandStyle.label}</span>
          </div>
        ) : (
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/8 text-white/55 text-[12px]">
            <span>{isFinal ? "Awaiting engine final score..." : "Awaiting first answer..."}</span>
          </div>
        )}

        {isFinal && bandStyle && (
          <div className="mt-4 px-4 py-3 rounded-lg bg-white/5 border border-white/10">
            <p className="text-[11px] uppercase tracking-[0.14em] text-white/45 font-medium mb-1.5">
              Recommended next action
            </p>
            <p className="text-[14px] text-white/95 leading-snug">
              {recommendationFor(band)}
            </p>
          </div>
        )}
      </div>

      {/* Practice area + sub-type */}
      <div className="px-6 pb-4 flex flex-wrap gap-2">
        {snapshot?.practiceArea && (
          <Chip label={`Practice: ${formatLabel(snapshot.practiceArea)}`} confidence={snapshot.practiceConfidence} />
        )}
        {(cpi.practice_sub_type ? String(cpi.practice_sub_type) : null) && (
          <Chip label={`Sub-type: ${formatLabel(String(cpi.practice_sub_type))}`} />
        )}
        {snapshot?.valueTier && (
          <Chip label={`Value: ${snapshot.valueTier}`} />
        )}
      </div>

      {/* Factor bars */}
      <div className="px-6 pb-5 flex flex-col gap-2.5">
        <p className="text-[11px] uppercase tracking-[0.14em] text-white/40 font-medium mb-1">
          Score factors
        </p>
        {factors.length === 0 ? (
          <p className="text-[12px] text-white/30 italic">No factor breakdown yet.</p>
        ) : (
          factors.map(f => (
            <FactorBar key={f.label} label={f.label} value={f.value} max={f.max} />
          ))
        )}
      </div>

      {/* Flags */}
      {snapshot?.flags && snapshot.flags.length > 0 && (
        <div className="px-6 pb-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-white/40 font-medium mb-1.5">
            Flags
          </p>
          <div className="flex flex-wrap gap-1.5">
            {snapshot.flags.map((flag, i) => (
              <span key={i} className="px-2 py-1 rounded-md bg-amber-500/15 text-amber-200 text-[11px] font-medium border border-amber-500/30">
                {formatLabel(flag)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Live answer log */}
      <div className="flex-1 px-6 pb-6 overflow-hidden flex flex-col">
        <p className="text-[11px] uppercase tracking-[0.14em] text-white/40 font-medium mb-2">
          Live answer log
        </p>
        <div className="flex-1 overflow-auto flex flex-col gap-2 pr-1">
          {log.length === 0 ? (
            <p className="text-[12px] text-white/30 italic">No answers captured yet.</p>
          ) : (
            log.slice().reverse().map((entry, i) => (
              <div key={`${entry.id}-${entry.ts}-${i}`} className="border-l-2 border-emerald-400/60 pl-3 py-1.5 flex flex-col gap-0.5">
                <p className="text-[12px] text-white/50 leading-snug">{entry.question}</p>
                <p className="text-[13px] text-white/95 font-medium leading-snug">
                  {Array.isArray(entry.answer) ? entry.answer.join(", ") : String(entry.answer)}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer status */}
      <div className="px-6 py-3 border-t border-white/8 flex items-center justify-between text-[11px] text-white/35">
        <span>{snapshot?.situationSummary ? "Situation summarized ✓" : isFinal ? "Situation captured" : "Awaiting situation"}</span>
        <span>
          {isFinal ? "✓ Case file ready" :
           snapshot?.collectIdentity ? "Ready for identity" :
           snapshot?.finalize ? "Complete" : "In progress"}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function AnimatedScore({ value }: { value: number | null }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (value === null) return;
    const start = display;
    const end   = Math.max(0, Math.min(100, Math.round(value)));
    const duration = 600;
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(Math.round(start + (end - start) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className="text-[64px] sm:text-[72px] font-bold leading-none tracking-tight tabular-nums" style={{ fontFamily: "Manrope, sans-serif" }}>
      {value === null ? "--" : display}
    </span>
  );
}

function Chip({ label, confidence }: { label: string; confidence?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/8 text-white/85 text-[12px] font-medium border border-white/10">
      {label}
      {confidence && (
        <span className="text-[10px] uppercase tracking-wider text-white/45">{confidence}</span>
      )}
    </span>
  );
}

function FactorBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-white/65">{label}</span>
        <span className="text-white/85 tabular-nums font-medium">{value.toFixed(0)} / {max}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[#C4B49A] to-emerald-300 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function numberFrom(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatLabel(s: string): string {
  if (!s) return s;
  // Strip "other:" prefix for display
  const cleaned = s.startsWith("other:") ? s.slice(6) : s;
  // Replace underscores, capitalize first letter of each word
  return cleaned
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

interface FactorRow { label: string; value: number; max: number }

function collectFactors(cpi: Record<string, unknown>): FactorRow[] {
  // Best-effort extraction of any numeric factor fields the engine returns.
  // Supports both the GPT path (gpt_cpi_v1, src/lib/cpi-calculator.ts CpiBreakdown)
  // and the form path (v2.1, src/lib/scoring.ts ComputedScore). Maps each known
  // field to a friendly label and its valid max. Unknown fields are ignored.
  const map: Record<string, { label: string; max: number }> = {
    // GPT path (CpiBreakdown) — Fit-side
    geo_score:           { label: "Geography",      max: 10 },
    practice_score:      { label: "Practice fit",   max: 15 },
    legitimacy_score:    { label: "Legitimacy",     max: 10 },
    referral_score:      { label: "Referral",       max: 5  },
    // GPT path — Value-side
    urgency_score:       { label: "Urgency",        max: 20 },
    complexity_score:    { label: "Complexity",     max: 25 },
    multi_practice_score:{ label: "Multi-practice", max: 5  },
    fee_score:           { label: "Fee potential",  max: 10 },
    // Form path (scoring.ts) — only relevant for non-GPT lead path
    contactability_score:{ label: "Contactability", max: 10 },
    strategic_score:     { label: "Strategic",      max: 15 },
    // Aggregates (shown if engine returns them, capped to total)
    fit_score:           { label: "Fit total",      max: 40 },
    value_score:         { label: "Value total",    max: 60 },
  };

  const rows: FactorRow[] = [];
  for (const [key, meta] of Object.entries(map)) {
    const raw = cpi[key];
    const n = typeof raw === "number" ? raw : null;
    if (n !== null && n !== 0) {
      rows.push({ label: meta.label, value: n, max: meta.max });
    }
  }
  return rows;
}

function recommendationFor(band: string | null): string {
  switch (band) {
    case "A": return "Priority retainer  -  call within 1 hour. Auto-trigger retainer agreement on band confirmation.";
    case "B": return "Strong candidate  -  call within 4 hours. Consultation slot recommended this week.";
    case "C": return "Possible fit  -  outreach within 24 hours. Verify missing intake fields before consultation.";
    case "D": return "Weak fit  -  send a polite decline-with-referral or low-touch nurture sequence.";
    case "E": return "Outside criteria  -  decline with referral. Do not consume retainer staff time.";
    default:  return "Awaiting band confirmation from the engine.";
  }
}
