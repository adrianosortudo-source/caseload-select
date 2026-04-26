/**
 * Event Selector  -  Deterministic Prioritization Layer
 *
 * Receives all events from the extractor and picks the single best target
 * event to ask about next. All ranking and tie-breaking logic lives here.
 * The extractor is pure detection; this module owns all prioritization.
 *
 * Selection algorithm (in order):
 *   1. Drop events below confidence threshold (< 0.5)
 *   2. Prefer unresolved events (time_resolved === false) over resolved ones
 *   3. Score candidates: +2 if unresolved, +1 if type requires a time anchor
 *   4. Pick highest score; tie-break by earliest position in message
 */

import type { ExtractedEvent } from "@/lib/event-extractor";

/**
 * Event types where knowing WHEN the event happened is a legal prerequisite
 * (limitation periods, filing deadlines, etc.). Used to weight unresolved
 * timing gaps more heavily during selection.
 */
const REQUIRES_TIME: Record<string, boolean> = {
  deportation: true,
  marriage_to_citizen: false,
  termination: true,
  unpaid_overtime: false,
  mva: true,
  slip_fall: true,
  debt_owed: true,
  real_estate_defect: false,
};

/**
 * Select the highest-priority event to target with the next intake question.
 *
 * Returns null when the events array is empty or no event clears the
 * confidence threshold.
 */
export function selectEvent(events: ExtractedEvent[]): ExtractedEvent | null {
  if (events.length === 0) return null;

  const confident = events.filter(e => e.confidence >= 0.5);
  if (confident.length === 0) return null;

  const unresolved = confident.filter(e => e.time_resolved === false);
  const resolved = confident.filter(e => e.time_resolved === true);

  const candidates = unresolved.length > 0 ? unresolved : resolved;

  const scored = candidates.map(e => ({
    event: e,
    score: (e.time_resolved === false ? 2 : 0) + (REQUIRES_TIME[e.type] ? 1 : 0),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.event.position - b.event.position;
  });

  return scored[0].event;
}
