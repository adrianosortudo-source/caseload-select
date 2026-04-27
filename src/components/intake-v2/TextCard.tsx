"use client";

/**
 * TextCard — free-text question, 1 per screen.
 *
 * Used for the situation kickoff prompt and any Round 3 free_text questions.
 * Multiline textarea with brand styling and a primary submit button.
 */

import { useState } from "react";
import type { ScreenItem } from "./types";

interface Props {
  item: ScreenItem;
  value?: string;
  onChange: (next: string) => void;
  /** Submit handler. Called when the user taps Continue. */
  onSubmit?: () => void;
  /** Override the submit button label. */
  submitLabel?: string;
  /** Minimum char count to enable submit. Default: 1. */
  minChars?: number;
}

export function TextCard({ item, value, onChange, onSubmit, submitLabel = "Continue", minChars = 1 }: Props) {
  const [focused, setFocused] = useState(false);
  const text = typeof value === "string" ? value : "";
  const canSubmit = text.trim().length >= minChars;

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

      <textarea
        rows={6}
        value={text}
        placeholder={item.placeholder ?? "Type your answer..."}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={e => onChange(e.target.value)}
        className={[
          "w-full px-5 py-4 rounded-xl text-[16px] leading-relaxed resize-none",
          "bg-white border transition-all",
          focused ? "border-[#1E2F58] shadow-[0_2px_12px_rgba(30,47,88,0.10)]" : "border-[#1E2F58]/15",
          "text-[#1E2F58] placeholder:text-[#1E2F58]/35",
          "focus:outline-none",
        ].join(" ")}
        style={{ fontFamily: "DM Sans, sans-serif" }}
      />

      {onSubmit && (
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className={[
            "w-full sm:w-auto sm:self-end min-h-[52px] px-8 rounded-full text-[15px] font-semibold",
            "transition-all duration-150",
            canSubmit
              ? "bg-[#1E2F58] text-white hover:shadow-[0_4px_14px_rgba(30,47,88,0.25)]"
              : "bg-[#1E2F58]/15 text-[#1E2F58]/40 cursor-not-allowed",
          ].join(" ")}
          style={{ fontFamily: "DM Sans, sans-serif" }}
        >
          {submitLabel}
        </button>
      )}
    </div>
  );
}
