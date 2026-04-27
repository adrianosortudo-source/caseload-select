"use client";

/**
 * SliderCard — bucketed ordinal slider, 1 question per screen.
 *
 * Behaviour:
 *  - 3-7 buckets along a horizontal track
 *  - Drag thumb or tap a bucket label to select
 *  - Selected bucket label shown above the thumb in navy
 *  - Auto-advance is parent-controlled (parent watches value change)
 *
 * Note: the value committed is the bucket label string (matches the existing
 * SlotOption.value contract). The slider is just a faster input shape.
 */

import { useState } from "react";
import type { ScreenItem } from "./types";

interface Props {
  item: ScreenItem;
  value?: string;
  onChange: (next: string) => void;
}

export function SliderCard({ item, value, onChange }: Props) {
  const buckets = item.sliderBuckets ?? item.options?.map(o => o.label) ?? [];
  const values = item.options?.map(o => o.value) ?? buckets;

  const initialIndex = (() => {
    if (!value) return -1;
    const i = values.indexOf(value);
    return i === -1 ? -1 : i;
  })();

  const [activeIndex, setActiveIndex] = useState<number>(initialIndex);

  function commit(idx: number) {
    setActiveIndex(idx);
    onChange(values[idx]);
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

      {/* Selected label */}
      <div className="text-center min-h-[36px]">
        <span
          className={[
            "inline-block px-5 py-2 rounded-full text-[15px] font-semibold transition-all",
            activeIndex >= 0
              ? "bg-[#1E2F58] text-white"
              : "bg-transparent text-[#1E2F58]/50 border border-dashed border-[#1E2F58]/30",
          ].join(" ")}
          style={{ fontFamily: "DM Sans, sans-serif" }}
        >
          {activeIndex >= 0 ? buckets[activeIndex] : "Tap a range"}
        </span>
      </div>

      {/* Bucket pills laid out left-to-right */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 sm:flex-wrap sm:overflow-x-visible">
          {buckets.map((label, i) => {
            const isOn = activeIndex === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => commit(i)}
                className={[
                  "flex-1 min-w-[100px] min-h-[56px] px-3 py-3 rounded-lg text-[14px] font-medium",
                  "transition-all duration-150 border",
                  isOn
                    ? "bg-[#1E2F58] text-white border-[#1E2F58]"
                    : "bg-white text-[#1E2F58] border-[#1E2F58]/12 hover:border-[#C4B49A]",
                ].join(" ")}
                style={{ fontFamily: "DM Sans, sans-serif" }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Track decoration */}
        <div className="relative h-1 rounded-full bg-[#1E2F58]/10 mx-2">
          <div
            className="absolute top-0 left-0 h-1 rounded-full bg-[#C4B49A] transition-all duration-200"
            style={{ width: activeIndex >= 0 ? `${((activeIndex + 1) / buckets.length) * 100}%` : "0%" }}
          />
        </div>
      </div>
    </div>
  );
}
