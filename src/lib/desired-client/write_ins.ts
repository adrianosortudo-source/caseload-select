import { WRITE_IN_KEYS } from "./catalog";
import type { DesiredClientAnswers, WriteInKey } from "./types";

const LABELS: Record<WriteInKey, string> = {
  timing: "Timing", contact: "First contact", goals: "Client goal",
  concerns: "Client concern", reasons: "Reason to pursue the work", fee_effort: "Fee compared with effort",
  conditions: "Delivery condition", capacity: "Current capacity", limit: "Important limit",
  aim: "Direction", evidence: "Supporting evidence",
  trigger: "Situation prompting help", decision_needs: "What would help the client decide", fit_signals: "Early fit signals",
};

/** Supplied wording stays visible even when a short brief paraphrases it. */
export function getWriteInAnswers(answers: DesiredClientAnswers): Array<{ key: WriteInKey; label: string; text: string }> {
  return WRITE_IN_KEYS.flatMap((key) => {
    const text = answers.write_ins?.[key]?.trim();
    return text ? [{ key, label: LABELS[key], text }] : [];
  });
}
