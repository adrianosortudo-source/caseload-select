"use client";

/**
 * RapidFire — multiple low-cognitive questions on a single screen.
 *
 * Layout:
 *  - Screen-level heading ("A few quick details")
 *  - Vertically stacked rows: question label + inline chip pills
 *  - Each chip auto-selects on tap; once all questions answered, parent advances
 *
 * Used for yes/no, 2-3 option questions, and binary follow-ups.
 */

import { useEffect, useState } from "react";
import type { ScreenItem } from "./types";
import { OTHER_VALUE } from "./types";

interface Props {
  items: ScreenItem[];
  values: Record<string, string | string[]>;
  onChange: (id: string, next: string | string[]) => void;
}

export function RapidFire({ items, values, onChange }: Props) {
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [otherOpenFor, setOtherOpenFor] = useState<string | null>(null);
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});

  // When the screen's question batch changes (different round / different
  // chip group), reset the Other-mode state so a stale textarea from the
  // previous round doesn't persist onto a new screen of questions.
  const itemSignature = items.map(i => i.id).join("|");
  useEffect(() => {
    setOtherOpenFor(null);
    setOtherTexts({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSignature]);

  function handleTap(itemId: string, optionValue: string, multi: boolean) {
    if (optionValue === OTHER_VALUE) {
      setOtherOpenFor(itemId);
      return;
    }
    const key = `${itemId}__${optionValue}`;
    setPressedKey(key);
    setTimeout(() => setPressedKey(null), 180);

    if (multi) {
      const current = Array.isArray(values[itemId]) ? (values[itemId] as string[]) : [];
      const next = current.includes(optionValue)
        ? current.filter(v => v !== optionValue)
        : [...current, optionValue];
      onChange(itemId, next);
    } else {
      onChange(itemId, optionValue);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2.5">
        <h2 className="text-[26px] sm:text-[30px] leading-tight font-extrabold text-[#1E2F58]" style={{ fontFamily: "Manrope, sans-serif" }}>
          A few quick details
        </h2>
        <p className="text-[15px] text-[#1E2F58]/65 leading-relaxed" style={{ fontFamily: "DM Sans, sans-serif" }}>
          Tap an answer for each. Less than 30 seconds.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {items.map(item => {
          const multi = !!item.multiSelect;
          const value = values[item.id];
          return (
            <div key={item.id} className="flex flex-col gap-2.5">
              <p className="text-[15px] sm:text-[16px] font-semibold text-[#1E2F58] leading-snug" style={{ fontFamily: "DM Sans, sans-serif" }}>
                {item.question}
              </p>
              {item.description && (
                <p className="text-[13px] text-[#1E2F58]/55 leading-relaxed -mt-1" style={{ fontFamily: "DM Sans, sans-serif" }}>
                  {item.description}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {item.options?.map(opt => {
                  const isOn = multi
                    ? Array.isArray(value) && value.includes(opt.value)
                    : value === opt.value;
                  const key = `${item.id}__${opt.value}`;
                  const isPressed = pressedKey === key;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleTap(item.id, opt.value, multi)}
                      className={[
                        "min-h-[44px] px-4 py-2 rounded-full text-[14px] font-medium",
                        "transition-all duration-150 border",
                        isOn
                          ? "bg-[#1E2F58] text-white border-[#1E2F58]"
                          : "bg-white text-[#1E2F58] border-[#1E2F58]/15 hover:border-[#C4B49A]",
                        isPressed ? "scale-[0.96]" : "scale-100",
                      ].join(" ")}
                      style={{ fontFamily: "DM Sans, sans-serif" }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
                {item.allowFreeText && (
                  <button
                    type="button"
                    onClick={() => handleTap(item.id, OTHER_VALUE, multi)}
                    className={[
                      "min-h-[44px] px-4 py-2 rounded-full text-[14px] font-medium",
                      "transition-all duration-150 border border-dashed",
                      typeof value === "string" && value.startsWith("other:")
                        ? "bg-[#1E2F58] text-white border-[#1E2F58]"
                        : "bg-transparent text-[#1E2F58] border-[#1E2F58]/30 hover:border-[#C4B49A]",
                    ].join(" ")}
                    style={{ fontFamily: "DM Sans, sans-serif" }}
                  >
                    Other...
                  </button>
                )}
              </div>

              {otherOpenFor === item.id && (
                <div className="mt-1 flex flex-col gap-2 rounded-lg border border-[#1E2F58]/15 bg-white p-3">
                  <textarea
                    rows={3}
                    autoFocus
                    value={otherTexts[item.id] ?? ""}
                    placeholder="Tell us in your own words..."
                    onChange={e => setOtherTexts(t => ({ ...t, [item.id]: e.target.value }))}
                    className="w-full px-3 py-2 rounded-md text-[14px] resize-none bg-white border border-[#1E2F58]/15 focus:border-[#1E2F58] focus:outline-none text-[#1E2F58]"
                    style={{ fontFamily: "DM Sans, sans-serif" }}
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => { setOtherOpenFor(null); setOtherTexts(t => { const c = { ...t }; delete c[item.id]; return c; }); }}
                      className="px-4 py-1.5 rounded-full text-[#1E2F58] text-[13px] font-medium hover:bg-[#1E2F58]/5"
                      style={{ fontFamily: "DM Sans, sans-serif" }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const txt = (otherTexts[item.id] ?? "").trim();
                        if (txt.length === 0) return;
                        onChange(item.id, `other:${txt}`);
                        setOtherOpenFor(null);
                      }}
                      disabled={(otherTexts[item.id] ?? "").trim().length === 0}
                      className={[
                        "px-5 py-1.5 rounded-full text-[13px] font-semibold transition",
                        (otherTexts[item.id] ?? "").trim().length > 0
                          ? "bg-[#1E2F58] text-white"
                          : "bg-[#1E2F58]/15 text-[#1E2F58]/40 cursor-not-allowed",
                      ].join(" ")}
                      style={{ fontFamily: "DM Sans, sans-serif" }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
