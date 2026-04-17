"use client";

/**
 * DemoScenarioPicker
 *
 * Modal interstitial for selecting a guided demo scenario.
 * Appears BEFORE the demo overlay activates — entirely separate
 * from the Hartwell Law website UI.
 *
 * Visual language: CaseLoad Select brand (#1E2F58), not Hartwell gold.
 * The user should immediately know this is a demo tool, not site content.
 */

import { useEffect } from "react";
import { DEMO_SCENARIOS } from "./demo-scenarios";
import type { ScenarioId } from "./demo-scenarios";

interface Props {
  open: boolean;
  onSelect: (id: ScenarioId) => void;
  onClose: () => void;
}

export default function DemoScenarioPicker({ open, onSelect, onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background: "rgba(13, 21, 32, 0.75)",
          backdropFilter: "blur(3px)",
        }}
      />

      {/* Card */}
      <div
        className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-[440px]"
        style={{
          animation: "picker-enter 220ms cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 pt-5 pb-4 rounded-t-2xl"
          style={{ background: "#1E2F58" }}
        >
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-white/50 mb-0.5">
              Interactive Demo
            </p>
            <h2 className="text-sm font-bold text-white leading-tight">
              Choose a scenario to watch
            </h2>
          </div>

          {/* CaseLoad Select wordmark */}
          <div className="flex items-center gap-2 ml-4">
            <div
              className="w-6 h-6 rounded flex items-center justify-center"
              style={{ background: "#C4B49A" }}
            >
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              aria-label="Close"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-xs text-gray-500 leading-relaxed mb-4">
            Watch the intake engine qualify a real case — from the client&apos;s perspective.
            The lawyer&apos;s view appears at the end.
          </p>

          <div className="space-y-2.5">
            {DEMO_SCENARIOS.map(s => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className="w-full text-left rounded-xl border border-gray-100 hover:border-[#1E2F58]/30 bg-gray-50 hover:bg-[#1E2F58]/[0.03] p-4 transition-all group"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5 ${s.bandStyle}`}
                  >
                    {s.band}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-gray-900">{s.label}</span>
                      <span className="text-[11px] text-gray-400">· {s.pa}</span>
                    </div>
                    <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">{s.message}</p>
                    <p className="text-[10px] font-semibold text-gray-400 mt-1.5 tracking-wide uppercase">
                      → {s.outcome}
                    </p>
                  </div>
                  <svg
                    className="w-4 h-4 text-gray-300 group-hover:text-[#1E2F58] flex-shrink-0 mt-1 transition-colors"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>

          <p className="text-[10px] text-gray-400 text-center mt-4">
            No data is stored. Press Esc to close.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes picker-enter {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
