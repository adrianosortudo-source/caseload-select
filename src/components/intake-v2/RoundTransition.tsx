"use client";

/**
 * RoundTransition — animated state shown between rounds.
 *
 * Purpose:
 *  - Mask the GPT round-trip latency (1-4s) with perceived value.
 *  - Reframe the gap as "the AI is reading what you said" — celebrates rather
 *    than apologises for the wait.
 *  - Sets up the next round's framing, e.g. "Found 4 things worth asking about".
 *
 * The component animates in two phases:
 *   Phase 1 (loading): three-pulse dots + the loadingText
 *   Phase 2 (reveal):  swap to a brief result line + auto-advance after ~1s
 *
 * The parent decides when to swap (when the API call resolves). This component
 * accepts a `phase` prop so the parent can drive it.
 */

import { useEffect, useState } from "react";

interface Props {
  /** "loading" while the API call is in flight, "reveal" once it has resolved. */
  phase: "loading" | "reveal";
  /** Text shown during the loading phase. */
  loadingText: string;
  /** Text shown during the reveal phase. Falls back to loadingText if omitted. */
  revealText?: string;
  /** Called once the reveal animation completes. Parent uses to advance to next screen. */
  onComplete?: () => void;
  /** Reveal hold duration in ms before onComplete fires. Default 900ms. */
  revealHoldMs?: number;
}

export function RoundTransition({ phase, loadingText, revealText, onComplete, revealHoldMs = 900 }: Props) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setShown(true);
  }, []);

  useEffect(() => {
    if (phase !== "reveal" || !onComplete) return;
    const t = setTimeout(onComplete, revealHoldMs);
    return () => clearTimeout(t);
  }, [phase, onComplete, revealHoldMs]);

  return (
    <div className="min-h-screen bg-[#F4F3EF] flex flex-col items-center justify-center px-5">
      <div className={`flex flex-col items-center gap-7 max-w-[480px] text-center transition-opacity duration-500 ${shown ? "opacity-100" : "opacity-0"}`}>
        {/* Animated indicator */}
        <div className="relative w-16 h-16 flex items-center justify-center">
          {phase === "loading" ? (
            <div className="flex gap-2">
              <span className="w-3 h-3 rounded-full bg-[#1E2F58] animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-3 h-3 rounded-full bg-[#1E2F58] animate-bounce" style={{ animationDelay: "120ms" }} />
              <span className="w-3 h-3 rounded-full bg-[#1E2F58] animate-bounce" style={{ animationDelay: "240ms" }} />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-full bg-[#1E2F58] flex items-center justify-center animate-[scaleIn_300ms_ease-out]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          )}
        </div>

        <p
          className="text-[20px] sm:text-[22px] font-semibold text-[#1E2F58] leading-snug transition-all duration-300"
          style={{ fontFamily: "Manrope, sans-serif" }}
        >
          {phase === "reveal" ? (revealText ?? loadingText) : loadingText}
        </p>
      </div>

      <style jsx>{`
        @keyframes scaleIn {
          from { transform: scale(0.7); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
      `}</style>
    </div>
  );
}
