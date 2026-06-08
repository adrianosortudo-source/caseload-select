"use client";

/**
 * Shell — frame around every widget v2 screen.
 *
 * Provides:
 *  - Parchment background
 *  - Top bar: back button + progress dots
 *  - Content area, mobile-first max-width
 *  - Optional footer (used by multi-select cards and rapid-fire)
 *
 * Brand:
 *  - bg:        parchment #F4F3EF
 *  - text:      navy #1E2F58
 *  - accent:    gold #C4B49A
 *  - selected:  navy fill, white text
 *  - border:    1px navy/10
 *
 * Embedded mode (iframe on firm websites):
 *  - Drops `min-h-screen` so document height equals content height
 *  - Drops vertical centering on main so content flows top-down
 *  - Measures the outer div's REAL rendered height (via ref + ResizeObserver,
 *    NOT document.scrollHeight — the app's global `html, body { height: 100% }`
 *    pins those to the iframe viewport and would always return 640 = min-height)
 *  - Posts that height to the parent via postMessage so the host iframe
 *    grows to fit — eliminates the iframe-internal scrollbar
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const RESIZE_MESSAGE_TYPE = "caseload-widget-resize";

interface ShellProps {
  /** Total number of screens in the current round. Drives dot count. */
  totalScreens: number;
  /** 0-indexed current screen position. */
  currentScreen: number;
  /** Round label shown above the dots. e.g. "About your case". */
  roundLabel?: string;
  /** Callback when the back button is pressed. Hidden when undefined. */
  onBack?: () => void;
  /** Callback when the skip-forward button is pressed. Hidden when undefined.
   * Lets the prospect bypass a question they don't have an answer for. */
  onSkip?: () => void;
  /**
   * Localized label for the back button. Defaults to "Back". Provided by
   * the widget when state.language is non-English so the chrome stays
   * coherent end-to-end. Back-compat: callers that omit this continue
   * to render "Back" exactly as before.
   */
  backLabel?: string;
  /** Localized label for the skip button. Defaults to "Skip". */
  skipLabel?: string;
  /** Main content. */
  children: ReactNode;
  /** Sticky footer (e.g. Continue button for multi-select). */
  footer?: ReactNode;
}

export function Shell({ totalScreens, currentScreen, roundLabel, onBack, onSkip, backLabel = "Back", skipLabel = "Skip", children, footer }: ShellProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);

  // Default false on first render to match SSR. Promote to true after mount
  // and start the postMessage handshake.
  const [isEmbedded, setIsEmbedded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const embedded = window.parent !== window;
    setIsEmbedded(embedded);
    if (!embedded) return;

    const outer = outerRef.current;
    if (!outer) return;

    let lastSent = 0;
    function reportHeight() {
      if (!outer) return;
      // The outer div is the entire Shell content (header + main + footer).
      // Its actual rendered height is exactly what the host iframe needs.
      // Read scrollHeight to also catch any internal overflow (sticky footer
      // edge cases, content larger than the flex layout expected).
      const measured = Math.max(outer.scrollHeight, outer.offsetHeight, outer.getBoundingClientRect().height);
      const height = Math.ceil(measured);
      if (height === lastSent || height < 100) return;
      lastSent = height;
      window.parent.postMessage({ type: RESIZE_MESSAGE_TYPE, height }, "*");
    }

    // First measurement may capture the pre-re-render layout with
    // min-h-screen still applied. ResizeObserver will catch the re-render.
    reportHeight();

    // Observe the outer div directly. When isEmbedded flips to true and
    // min-h-screen is removed, the outer div shrinks/grows to its real
    // content height. ResizeObserver fires for any size change.
    const observer = new ResizeObserver(reportHeight);
    observer.observe(outer);

    // Catch shifts ResizeObserver may miss (font load, dynamic image load).
    const fallback = window.setInterval(reportHeight, 300);

    // Font load is the most common under-measurement window: the engine
    // posts a height with system-fallback fonts (compact), then the brand
    // face arrives and reflows the content taller by 8–16% — but
    // ResizeObserver sometimes coalesces this into a single notification
    // that fires AFTER our last report. document.fonts.ready resolves
    // exactly when the brand face is available; force one report then.
    if (typeof document !== "undefined" && "fonts" in document) {
      void document.fonts.ready.then(() => {
        // Two passes — one immediately, one after the next paint frame —
        // so we catch both the synchronous metric change and any reflow
        // that the browser schedules in response.
        reportHeight();
        window.requestAnimationFrame(reportHeight);
      });
    }

    // Belt-and-suspenders: a final re-measurement 1.5s in. Late-loading
    // resources (theme tokens that arrived via cascade, an image that
    // unfolded, the iframe parent finishing its own layout pass) can
    // shift content one more time after the initial settle. This catch
    // is cheap and only runs once.
    const lateSettle = window.setTimeout(reportHeight, 1500);

    return () => {
      observer.disconnect();
      window.clearInterval(fallback);
      window.clearTimeout(lateSettle);
    };
  }, []);

  // Outer chrome: min-h-screen ONLY in standalone, never when embedded.
  // When embedded the iframe is being sized to match this div, so we want
  // the div's height to equal exactly its content (no viewport floor).
  //
  // Background colour is driven by --cls-bg (set by the widget page from
  // the firm's resolved theme); fallback is the default CaseLoad parchment.
  const outerClass = [
    isEmbedded ? "" : "min-h-screen",
    "bg-[var(--cls-bg,#F4F3EF)] flex flex-col",
  ]
    .filter(Boolean)
    .join(" ");

  // Main body: vertical centering ONLY in standalone. When embedded the
  // iframe is resized to match content exactly, so centering would only
  // add empty padding the host doesn't want.
  const mainClass = [
    "flex-1 flex flex-col px-5",
    isEmbedded ? "py-5" : "py-6 items-center justify-center",
  ].join(" ");

  return (
    <div ref={outerRef} className={outerClass}>
      {/* Top chrome */}
      <header className="px-5 pt-5 pb-3 flex items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Go back"
            className="flex items-center gap-1.5 h-10 px-3 -ml-3 rounded-full text-[var(--cls-text,#1E2F58)] hover:bg-[color-mix(in_srgb,var(--cls-text,#1E2F58)_8%,transparent)] transition"
            style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span className="text-[13px] font-medium">{backLabel}</span>
          </button>
        ) : (
          <span className="w-10" aria-hidden="true" />
        )}

        <div className="flex flex-col items-center gap-1.5">
          {roundLabel && (
            <span
              className="text-[11px] uppercase tracking-[0.12em] font-medium"
              style={{
                color: "color-mix(in srgb, var(--cls-text, #1E2F58) 60%, transparent)",
                fontFamily: "var(--cls-font-body, DM Sans, sans-serif)",
              }}
            >
              {roundLabel}
            </span>
          )}
          <div className="flex gap-1.5" role="progressbar" aria-valuenow={currentScreen + 1} aria-valuemax={totalScreens}>
            {Array.from({ length: totalScreens }).map((_, i) => {
              const dotStyle: React.CSSProperties =
                i === currentScreen
                  ? { backgroundColor: "var(--cls-accent, #1E2F58)" }
                  : i < currentScreen
                  ? { backgroundColor: "color-mix(in srgb, var(--cls-accent, #1E2F58) 60%, transparent)" }
                  : { backgroundColor: "color-mix(in srgb, var(--cls-accent, #1E2F58) 15%, transparent)" };
              return (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === currentScreen ? "w-6" : "w-1.5"
                  }`}
                  style={dotStyle}
                />
              );
            })}
          </div>
        </div>

        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            aria-label="Skip this question"
            className="flex items-center gap-1.5 h-10 px-3 -mr-3 rounded-full transition text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_65%,transparent)] hover:bg-[color-mix(in_srgb,var(--cls-text,#1E2F58)_8%,transparent)] hover:text-[var(--cls-text,#1E2F58)]"
            style={{ fontFamily: "var(--cls-font-body, DM Sans, sans-serif)" }}
          >
            <span className="text-[13px] font-medium">{skipLabel}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <span className="w-10" aria-hidden="true" />
        )}
      </header>

      {/* Body */}
      <main className={mainClass}>
        <div className="w-full max-w-[720px]">{children}</div>
      </main>

      {/* Footer (optional). In standalone it sticks to viewport bottom; when
          embedded we drop sticky positioning because the host iframe sized to
          content has nothing to stick against. */}
      {footer && (
        <footer
          className={[
            "px-5 pb-6 pt-3",
            isEmbedded ? "" : "sticky bottom-0",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            backgroundImage:
              "linear-gradient(to top, var(--cls-bg, #F4F3EF), var(--cls-bg, #F4F3EF), transparent)",
          }}
        >
          <div className="w-full max-w-[720px] mx-auto">{footer}</div>
        </footer>
      )}
    </div>
  );
}
