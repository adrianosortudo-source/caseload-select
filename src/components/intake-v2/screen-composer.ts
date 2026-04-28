/**
 * screen-composer.ts — converts a batch of API-returned Questions into
 * widget-v2 Screen[] for the renderer to walk through one at a time.
 *
 * Rules:
 *  - Question with >= 4 options OR type "date"/"file" → solo DecisionCard
 *  - Question with 2-3 options → buffered into a RapidFire group (max 4 per group)
 *  - Question with 0 options + allow_free_text → solo TextCard
 *  - type "info" → skipped (rendered as preamble on next screen, future)
 *
 * The composer never reorders questions. Chip-eligible questions are grouped
 * only when consecutive — a card-question splits the chip group.
 */

import type { Screen, ScreenItem, OptionItem } from "./types";

// Mirror of the Question shape returned by /api/screen
export interface ApiQuestion {
  id: string;
  text: string;
  options: Array<{ label: string; value: string; followUp?: unknown }>;
  allow_free_text: boolean;
  description?: string;
  type?: "structured" | "info" | "date" | "file";
}

const CHIP_MAX_OPTIONS = 3;
const CHIPS_PER_RAPID_FIRE = 4;

function toOption(opt: { label: string; value: string }): OptionItem {
  return { value: opt.value, label: opt.label };
}

function toScreenItem(q: ApiQuestion, presentation: "card" | "chip" | "slider" | "text"): ScreenItem {
  return {
    id: q.id,
    question: q.text,
    description: q.description,
    presentation,
    options: q.options.map(toOption),
    multiSelect: false, // /api/screen returns single-select questions; multi is handled in slot bank
    allowFreeText: q.allow_free_text === true,
  };
}

export function composeScreens(questions: ApiQuestion[]): Screen[] {
  const screens: Screen[] = [];
  let chipBuffer: ScreenItem[] = [];

  function flushChips() {
    if (chipBuffer.length === 0) return;
    screens.push({ kind: "rapid_fire", items: chipBuffer });
    chipBuffer = [];
  }

  for (const q of questions) {
    if (q.type === "info") continue; // Skip info blocks for v2 (TODO: render as preamble)

    const optCount = q.options?.length ?? 0;

    // No options at all → synthesize a generic Yes / No / Not sure / Other
    // option set so the prospect always has tappable choices. The AI is
    // instructed to never return empty-options questions in widget mode, but
    // when one slips through this fallback ensures the experience stays
    // tap-driven. allow_free_text stays true so "Other" reveals a text input.
    if (optCount === 0) {
      flushChips();
      const synthesized: typeof q = {
        ...q,
        options: [
          { label: "Yes",      value: "yes" },
          { label: "No",       value: "no" },
          { label: "Not sure", value: "unsure" },
        ],
        allow_free_text: true,
      };
      screens.push({ kind: "solo", items: [toScreenItem(synthesized, "card")] });
      continue;
    }

    // Date or file → solo (rendered as DecisionCard for now; specialised types later)
    if (q.type === "date" || q.type === "file") {
      flushChips();
      screens.push({ kind: "solo", items: [toScreenItem(q, "card")] });
      continue;
    }

    // 4+ options → solo DecisionCard
    if (optCount >= 4) {
      flushChips();
      screens.push({ kind: "solo", items: [toScreenItem(q, "card")] });
      continue;
    }

    // 2-3 options → chip, buffer it
    if (optCount > 0 && optCount <= CHIP_MAX_OPTIONS) {
      chipBuffer.push(toScreenItem(q, "chip"));
      if (chipBuffer.length >= CHIPS_PER_RAPID_FIRE) flushChips();
      continue;
    }

    // Fallback — shouldn't normally hit
    flushChips();
    screens.push({ kind: "solo", items: [toScreenItem(q, "card")] });
  }

  flushChips();
  return screens;
}
