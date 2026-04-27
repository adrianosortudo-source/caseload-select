"use client";

/**
 * Shell — frame around every widget v2 screen.
 *
 * Provides:
 *  - Parchment background
 *  - Top bar: back button + progress dots
 *  - Centered content area, mobile-first max-width
 *  - Optional footer (used by multi-select cards and rapid-fire)
 *
 * Brand:
 *  - bg:        parchment #F4F3EF
 *  - text:      navy #1E2F58
 *  - accent:    gold #C4B49A
 *  - selected:  navy fill, white text
 *  - border:    1px navy/10
 */

import type { ReactNode } from "react";

interface ShellProps {
  /** Total number of screens in the current round. Drives dot count. */
  totalScreens: number;
  /** 0-indexed current screen position. */
  currentScreen: number;
  /** Round label shown above the dots. e.g. "About your case". */
  roundLabel?: string;
  /** Callback when the back button is pressed. Hidden when undefined. */
  onBack?: () => void;
  /** Main content. */
  children: ReactNode;
  /** Sticky footer (e.g. Continue button for multi-select). */
  footer?: ReactNode;
}

export function Shell({ totalScreens, currentScreen, roundLabel, onBack, children, footer }: ShellProps) {
  return (
    <div className="min-h-screen bg-[#F4F3EF] flex flex-col">
      {/* Top chrome */}
      <header className="px-5 pt-5 pb-3 flex items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Go back"
            className="flex items-center gap-1.5 h-10 px-3 -ml-3 rounded-full text-[#1E2F58] hover:bg-[#1E2F58]/8 transition"
            style={{ fontFamily: "DM Sans, sans-serif" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span className="text-[13px] font-medium">Back</span>
          </button>
        ) : (
          <span className="w-10" aria-hidden="true" />
        )}

        <div className="flex flex-col items-center gap-1.5">
          {roundLabel && (
            <span className="text-[11px] uppercase tracking-[0.12em] text-[#1E2F58]/60 font-medium">
              {roundLabel}
            </span>
          )}
          <div className="flex gap-1.5" role="progressbar" aria-valuenow={currentScreen + 1} aria-valuemax={totalScreens}>
            {Array.from({ length: totalScreens }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === currentScreen
                    ? "w-6 bg-[#1E2F58]"
                    : i < currentScreen
                    ? "w-1.5 bg-[#1E2F58]/60"
                    : "w-1.5 bg-[#1E2F58]/15"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="w-10" />
      </header>

      {/* Body */}
      <main className="flex-1 flex flex-col items-center justify-center px-5 py-6">
        <div className="w-full max-w-[720px]">{children}</div>
      </main>

      {/* Footer (optional, sticky on mobile) */}
      {footer && (
        <footer className="sticky bottom-0 px-5 pb-6 pt-3 bg-gradient-to-t from-[#F4F3EF] via-[#F4F3EF] to-transparent">
          <div className="w-full max-w-[720px] mx-auto">{footer}</div>
        </footer>
      )}
    </div>
  );
}
