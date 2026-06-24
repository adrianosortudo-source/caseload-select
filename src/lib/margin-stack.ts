/**
 * Pure stacking math for Google-Docs-style margin comments.
 *
 * Each comment card wants to sit at the vertical height of the passage it
 * anchors to. When two anchors are close, the cards would overlap, so we push
 * each colliding card down just enough to clear the one above it. Order is by
 * anchor height; the result is a map of comment id -> resolved top (px).
 */

export interface StackItem {
  id: string;
  anchor: number; // desired top (px), aligned to the passage
  height: number; // measured card height (px)
}

export function stackCards(items: StackItem[], gap = 10): Map<string, number> {
  const sorted = [...items].sort((a, b) => a.anchor - b.anchor);
  const tops = new Map<string, number>();
  let cursor = -Infinity;
  for (const it of sorted) {
    const top = Math.max(it.anchor, cursor);
    tops.set(it.id, top);
    cursor = top + Math.max(0, it.height) + gap;
  }
  return tops;
}

/**
 * The y where flow content after the stacked cards can begin (used to place
 * unanchored general notes below the last aligned card).
 */
export function stackBottom(
  tops: Map<string, number>,
  heights: Map<string, number>,
  gap = 10,
): number {
  let bottom = 0;
  for (const [id, top] of tops) {
    bottom = Math.max(bottom, top + (heights.get(id) ?? 0) + gap);
  }
  return bottom;
}
