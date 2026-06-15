"use client";

/**
 * TextCard — free-text question, 1 per screen.
 *
 * Used for the situation kickoff prompt and any Round 3 free_text questions.
 * Multiline textarea with brand styling and a primary submit button.
 */

import { useState } from "react";
import type { ScreenItem } from "./types";
import { VoiceInput } from "./VoiceInput";

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
  /** When true, show the voice-record button beside the textarea. Used for kickoff. */
  enableVoice?: boolean;
  /** Optional short starter phrases shown below the textarea. Visually
   *  quiet, secondary. Used on the kickoff prompt to help visitors
   *  start without legal vocabulary. */
  examplePrompts?: string[];
  /** Label that introduces the example prompts. Defaults to "You can start with:". */
  examplePromptsLabel?: string;
  /** Caption beside the voice-record button. Describes what the button does
   *  relative to the textarea. The previous copy ("or speak instead of
   *  typing") read as a second option separate from the button (#177). */
  voiceHint?: string;
}

export function TextCard({
  item,
  value,
  onChange,
  onSubmit,
  submitLabel = "Continue",
  minChars = 1,
  enableVoice = false,
  examplePrompts,
  examplePromptsLabel = "You can start with:",
  voiceHint = "speak your answer instead of typing it",
}: Props) {
  const [focused, setFocused] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const text = typeof value === "string" ? value : "";
  const canSubmit = text.trim().length >= minChars;

  function handleTextInput(next: string) {
    onChange(next);
  }

  function handleTranscript(transcript: string) {
    setVoiceError(null);
    // Append to existing text (with a leading space if there's already content)
    const prefix = text.trim().length > 0 ? text.trim() + " " : "";
    onChange(prefix + transcript);
  }

  // Per-firm theme tokens — see lib/widget-theme.ts. Fallbacks match the
  // legacy CaseLoad Select chrome.
  const fontDisplay = "var(--cls-font-display, Manrope, sans-serif)";
  const fontBody = "var(--cls-font-body, DM Sans, sans-serif)";

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2.5">
        <h2
          className="text-[24px] sm:text-[26px] leading-tight font-extrabold text-balance text-[var(--cls-text,#1E2F58)]"
          style={{ fontFamily: fontDisplay }}
        >
          {item.question}
        </h2>
        {item.description && (
          <p
            className="text-[15px] text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_65%,transparent)] leading-relaxed"
            style={{ fontFamily: fontBody }}
          >
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
        onChange={e => handleTextInput(e.currentTarget.value)}
        onInput={e => handleTextInput(e.currentTarget.value)}
        className={[
          "w-full px-5 py-4 rounded-xl text-[16px] leading-relaxed resize-none",
          "bg-[var(--cls-surface,#FFFFFF)] border transition-all",
          focused
            ? "border-[var(--cls-accent,#1E2F58)] shadow-[0_2px_12px_rgba(30,47,88,0.10)]"
            : "border-[color-mix(in_srgb,var(--cls-accent,#1E2F58)_15%,transparent)]",
          "text-[var(--cls-text,#1E2F58)] placeholder:text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_35%,transparent)]",
          "focus:outline-none",
        ].join(" ")}
        style={{ fontFamily: fontBody }}
      />

      {enableVoice && (
        <div className="flex flex-col gap-2 -mt-2">
          <div className="flex items-center gap-3">
            <VoiceInput
              onTranscript={handleTranscript}
              onError={setVoiceError}
            />
            <span
              className="text-[12px] text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_55%,transparent)]"
              style={{ fontFamily: fontBody }}
            >
              {voiceHint}
            </span>
          </div>
          {voiceError && (
            <p className="text-[12px] text-red-600" style={{ fontFamily: fontBody }}>
              {voiceError}
            </p>
          )}
        </div>
      )}

      {examplePrompts && examplePrompts.length > 0 && (
        // Visually quiet starter prompts. Brand discipline: secondary
        // typography, no card chrome, no icons, no "examples" framing
        // that reads as a tutorial. The textarea remains the visual
        // anchor; this block sits below as a quieter helper.
        <div
          className="flex flex-col gap-1 -mt-1"
          aria-label="Starter phrases"
        >
          <p
            className="text-[12px] uppercase tracking-[0.14em] font-medium text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_55%,transparent)]"
            style={{ fontFamily: fontBody }}
          >
            {examplePromptsLabel}
          </p>
          <ul
            className="flex flex-col gap-1 list-none p-0 m-0 text-[13.5px] leading-relaxed text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_60%,transparent)]"
            style={{ fontFamily: fontBody }}
          >
            {examplePrompts.map((prompt, i) => (
              <li key={i}>&ldquo;{prompt}&rdquo;</li>
            ))}
          </ul>
        </div>
      )}

      {onSubmit && (
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className={[
            "w-full sm:w-auto sm:self-end min-h-[52px] px-8 rounded-full text-[15px] font-semibold",
            "transition-all duration-150",
            canSubmit
              ? "bg-[var(--cls-accent,#1E2F58)] text-[var(--cls-accent-text,#FFFFFF)] hover:shadow-[0_4px_14px_rgba(30,47,88,0.25)]"
              : "bg-[color-mix(in_srgb,var(--cls-accent,#1E2F58)_15%,transparent)] text-[color-mix(in_srgb,var(--cls-text,#1E2F58)_40%,transparent)] cursor-not-allowed",
          ].join(" ")}
          style={{ fontFamily: fontBody }}
        >
          {submitLabel}
        </button>
      )}
    </div>
  );
}
