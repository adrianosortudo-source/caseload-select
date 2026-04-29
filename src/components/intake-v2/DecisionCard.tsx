"use client";

/**
 * DecisionCard — high-cognitive-load question, 1 per screen.
 *
 * Layout:
 *  - Large question heading (Manrope 800, navy)
 *  - Optional grey subtext beneath
 *  - 2-column grid of option cards (1-column under 480px)
 *  - Selected: navy fill, white text
 *  - Single-select: auto-advances on tap (200ms feedback delay)
 *  - Multi-select: cards stay tappable, sticky "Continue" in footer
 *
 * Auto-advance is parent-controlled — DecisionCard fires onChange and the
 * parent (widget controller) decides whether to advance or wait for "Continue".
 */

import { useEffect, useState } from "react";
import type { ScreenItem } from "./types";
import { OTHER_VALUE } from "./types";

interface Props {
  item: ScreenItem;
  /** Current value. string for single-select, string[] for multi. */
  value?: string | string[];
  /** Fired on every selection change. Parent decides when to advance. */
  onChange: (next: string | string[]) => void;
}

export function DecisionCard({ item, value, onChange }: Props) {
  const multi = !!item.multiSelect;
  const selected = multi
    ? Array.isArray(value) ? value : []
    : typeof value === "string" ? value : null;

  const [pressedValue, setPressedValue] = useState<string | null>(null);
  const [otherMode, setOtherMode] = useState(false);
  const [otherText, setOtherText] = useState(typeof selected === "string" && selected.startsWith("other:") ? selected.slice(6) : "");

  // Reset Other-mode and Other-text whenever the question changes. Without
  // this, the textarea state from the PREVIOUS question persists onto the
  // next question's screen, forcing the prospect to tap Cancel to dismiss
  // a stale "In your own words:" panel that has nothing to do with the
  // current question.
  useEffect(() => {
    setOtherMode(false);
    setOtherText(typeof value === "string" && value.startsWith("other:") ? value.slice(6) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  function handleTap(optionValue: string) {
    setPressedValue(optionValue);
    setTimeout(() => setPressedValue(null), 180);

    if (optionValue === OTHER_VALUE) {
      // Single-select "Other" → reveal textarea, defer onChange until user submits text
      setOtherMode(true);
      return;
    }

    if (multi) {
      const current = Array.isArray(selected) ? selected : [];
      const next = current.includes(optionValue)
        ? current.filter(v => v !== optionValue)
        : [...current, optionValue];
      onChange(next);
    } else {
      onChange(optionValue);
    }
  }

  function submitOther() {
    if (otherText.trim().length === 0) return;
    onChange(`other:${otherText.trim()}`);
  }

  function isSelected(optionValue: string): boolean {
    if (multi) return Array.isArray(selected) && selected.includes(optionValue);
    return selected === optionValue;
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2.5">
        <h2 className="text-[26px] sm:text-[30px] leading-tight font-extrabold text-[#1E2F58]" style={{ fontFamily: "Manrope, sans-serif" }}>
          {item.question}
        </h2>
        {item.description && (
          <p className="text-[15px] text-[#1E2F58]/65 leading-relaxed" style={{ fontFamily: "DM Sans, sans-serif" }}>
            {item.description}
          </p>
        )}
      </div>

      {(!item.options || item.options.length === 0) && (
        <div className="rounded-xl border border-[#1E2F58]/15 bg-white p-5 text-[14px] text-[#1E2F58]/65" style={{ fontFamily: "DM Sans, sans-serif" }}>
          This question came back without answer options. Tap continue to skip it.
          <button
            type="button"
            onClick={() => onChange("__skipped__")}
            className="mt-3 inline-block px-5 py-2.5 rounded-full bg-[#1E2F58] text-white text-[14px] font-semibold"
            style={{ fontFamily: "DM Sans, sans-serif" }}
          >
            Continue
          </button>
        </div>
      )}

      {otherMode && (
        <div className="flex flex-col gap-3 rounded-xl border border-[#1E2F58]/15 bg-white p-5">
          <p className="text-[14px] font-semibold text-[#1E2F58]" style={{ fontFamily: "DM Sans, sans-serif" }}>
            In your own words:
          </p>
          <textarea
            rows={4}
            autoFocus
            value={otherText}
            placeholder="Describe what happened in your situation..."
            onChange={e => setOtherText(e.target.value)}
            className="w-full px-4 py-3 rounded-lg text-[15px] leading-relaxed resize-none bg-white border border-[#1E2F58]/20 focus:border-[#1E2F58] focus:outline-none text-[#1E2F58] placeholder:text-[#1E2F58]/35"
            style={{ fontFamily: "DM Sans, sans-serif" }}
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setOtherMode(false); setOtherText(""); }}
              className="px-5 py-2.5 rounded-full text-[#1E2F58] text-[14px] font-medium hover:bg-[#1E2F58]/5"
              style={{ fontFamily: "DM Sans, sans-serif" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitOther}
              disabled={otherText.trim().length === 0}
              className={[
                "px-6 py-2.5 rounded-full text-[14px] font-semibold transition",
                otherText.trim().length > 0
                  ? "bg-[#1E2F58] text-white"
                  : "bg-[#1E2F58]/15 text-[#1E2F58]/40 cursor-not-allowed",
              ].join(" ")}
              style={{ fontFamily: "DM Sans, sans-serif" }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {!otherMode && (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {item.options?.map(opt => {
          const isOn = isSelected(opt.value);
          const isPressed = pressedValue === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleTap(opt.value)}
              className={[
                "group relative flex items-center min-h-[64px] px-5 py-4 rounded-xl text-left",
                "transition-all duration-150",
                "border",
                isOn
                  ? "bg-[#1E2F58] text-white border-[#1E2F58] shadow-[0_4px_14px_rgba(30,47,88,0.18)]"
                  : "bg-white text-[#1E2F58] border-[#1E2F58]/12 hover:border-[#C4B49A] hover:shadow-[0_2px_8px_rgba(30,47,88,0.06)]",
                isPressed ? "scale-[0.98]" : "scale-100",
              ].join(" ")}
              style={{ fontFamily: "DM Sans, sans-serif" }}
            >
              <span className="flex-1 text-[16px] font-medium leading-snug">{opt.label}</span>
              {multi && (
                <span
                  className={[
                    "ml-3 w-5 h-5 rounded-md border flex items-center justify-center transition",
                    isOn ? "border-white bg-white" : "border-[#1E2F58]/25 bg-transparent",
                  ].join(" ")}
                >
                  {isOn && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1E2F58" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
              )}
            </button>
          );
        })}

        {item.allowFreeText && !multi && item.options && item.options.length > 0 && (
          <button
            type="button"
            onClick={() => handleTap(OTHER_VALUE)}
            className={[
              "group relative flex items-center min-h-[64px] px-5 py-4 rounded-xl text-left",
              "transition-all duration-150 border border-dashed",
              "bg-transparent text-[#1E2F58] border-[#1E2F58]/30 hover:border-[#C4B49A] hover:bg-white",
            ].join(" ")}
            style={{ fontFamily: "DM Sans, sans-serif" }}
          >
            <span className="flex-1 text-[16px] font-medium leading-snug">Something else (I will explain)</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2 opacity-60">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        )}
      </div>
      )}
    </div>
  );
}
