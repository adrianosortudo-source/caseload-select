/**
 * presentation.ts — auto-resolves a Slot or Round3Question to a layout type.
 *
 * Layout types and the questions that map to each:
 *   card   — high-cognitive-load decision. 1 question per screen, 2-col option grid.
 *            Rule: single_select with >=4 options, multi_select, or any structured_multi.
 *   chip   — low-cognitive binary or short choice. Multiple questions per screen.
 *            Rule: yes_no, single_select with <=3 options, structured_single with <=3 options.
 *   slider — bucketed ordinal/numeric. 1 question per screen, draggable thumb.
 *            Rule: answerType === "numeric", or explicit override.
 *   text   — free text. 1 question per screen, multiline textarea.
 *            Rule: free_text type, or text answerType. Round3 only.
 *
 * Override the resolved layout by setting `presentation` on the slot/question.
 */

import type { Slot } from "@/lib/slot-registry";
import type { Round3Question } from "@/lib/round3";

export type Presentation = "card" | "chip" | "slider" | "text";

export function resolveSlotPresentation(slot: Slot): Presentation {
  if (slot.presentation) return slot.presentation;

  switch (slot.answerType) {
    case "yes_no":
      return "chip";
    case "numeric":
      return "slider";
    case "text":
    case "date":
    case "file":
      return "text";
    case "multi_select":
      return "card";
    case "single_select":
      return (slot.options?.length ?? 0) <= 3 ? "chip" : "card";
    default:
      return "card";
  }
}

export function resolveRound3Presentation(q: Round3Question): Presentation {
  if (q.presentation) return q.presentation;

  switch (q.type) {
    case "free_text":
      return "text";
    case "file":
      return "text";
    case "structured_single":
      return (q.options?.length ?? 0) <= 3 ? "chip" : "card";
    case "structured_multi":
      return "card";
    default:
      return "card";
  }
}
