/**
 * Shared widget v2 types.
 *
 * The widget v2 renderer is presentation-agnostic — it consumes a normalized
 * "ScreenItem" shape regardless of whether the underlying source is a Slot
 * (R1/R2) or a Round3Question (R3). This keeps the renderer free of branching
 * logic per question source.
 */

import type { Presentation } from "./presentation";

export interface OptionItem {
  value: string;
  label: string;
}

export interface ScreenItem {
  /** Stable ID — slot.id or round3 question.id. */
  id: string;
  /** Question text shown to the prospect. */
  question: string;
  /** Optional grey subtext shown beneath the question. */
  description?: string;
  /** Layout to render. */
  presentation: Presentation;
  /** Required for card and chip layouts. */
  options?: OptionItem[];
  /** True when the answer is a string[] (multi-select / structured_multi). */
  multiSelect?: boolean;
  /** Slider bucket labels (left to right). Required when presentation = "slider". */
  sliderBuckets?: string[];
  /** Optional placeholder for free-text inputs. */
  placeholder?: string;
  /** When true, render an "Other" option that reveals a text input. */
  allowFreeText?: boolean;
  /**
   * Localized label for the "Something else (I will explain)" affordance
   * that DecisionCard renders when allowFreeText is true. Falls back to
   * the English literal when not provided. Wired through i18n by the
   * widget that constructs the ScreenItem (e.g. ScreenEnginePublicWidget
   * reads `widget_strings.free_text_other_label` from the lead's
   * language bundle).
   */
  freeTextLabel?: string;
}

/** Sentinel value stored in the answers map when the user picks "Other". */
export const OTHER_VALUE = "__other__";

/** A "screen" the widget renders — one or more items grouped together. */
export interface Screen {
  /** "rapid_fire" packs multiple chip items on one screen. All others render solo. */
  kind: "solo" | "rapid_fire";
  items: ScreenItem[];
}

/** Answer map. Single-select stores string, multi stores string[]. */
export type AnswerMap = Record<string, string | string[]>;
