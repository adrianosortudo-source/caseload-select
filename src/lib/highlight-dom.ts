/**
 * Client-side passage highlighter for the deliverable review body.
 *
 * Text comments store a character range (start/end) into the body's plain text
 * plus the exact quote. After the body renders, we wrap each stored range in a
 * <mark class="drg-hl"> so the commented passage stays visibly highlighted, the
 * same way Google Docs keeps a comment's anchor highlighted.
 *
 * The range is resolved against the live text with the stored quote as a
 * fallback: if offsets drifted (a later version changed the prose), we relocate
 * by searching for the quote; if the quote is gone, that one highlight is
 * skipped rather than mis-marked. Wrapping preserves the body's text content
 * exactly, so selection offsets for NEW comments stay consistent.
 */

export interface HighlightItem {
  id: string;
  start: number;
  end: number;
  num: number;
  quote: string;
}

export interface SuggestionHighlightItem {
  id: string;
  start: number;
  end: number;
  quote: string;
  replacementText: string | null;
  operation: "replace" | "delete";
}

/** Reset the body to its original HTML, then wrap each stored range in a mark. */
export function applyHighlights(
  container: HTMLElement,
  originalHtml: string,
  items: HighlightItem[],
): void {
  container.innerHTML = originalHtml;
  if (!items.length) return;

  const fullText = container.textContent ?? "";
  const resolved: HighlightItem[] = [];
  for (const it of items) {
    let { start, end } = it;
    const slice = fullText.slice(start, end);
    if (it.quote && slice !== it.quote) {
      const idx = fullText.indexOf(it.quote);
      if (idx < 0) continue; // quote no longer present; skip this highlight
      start = idx;
      end = idx + it.quote.length;
    }
    if (start >= end) continue;
    resolved.push({ ...it, start, end });
  }

  // Order does not affect correctness: wrapping keeps total text length, so each
  // pass re-walks the live DOM and recomputes valid offsets.
  for (const it of resolved) wrapRange(container, it);
}

/** Add redline marks after comment marks have been applied. The original text
 * is retained and the proposed text is rendered as an adjacent insertion so
 * the reviewer can switch back to the clean version without losing context. */
export function applySuggestionHighlights(
  container: HTMLElement,
  items: SuggestionHighlightItem[],
): void {
  const fullText = container.textContent ?? "";
  // Insert proposed text from the end of the document backwards so an
  // insertion cannot shift the stored offsets of a suggestion that follows.
  const ordered = [...items].sort((a, b) => b.start - a.start);
  for (const it of ordered) {
    let start = it.start;
    if (fullText.slice(start, it.end) !== it.quote) {
      const found = fullText.indexOf(it.quote);
      if (found < 0) continue;
      start = found;
    }
    const end = start + it.quote.length;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let off = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      const nodeStart = off;
      const nodeEnd = off + text.data.length;
      off = nodeEnd;
      if (start < nodeStart || end > nodeEnd) continue;
      const range = document.createRange();
      range.setStart(text, start - nodeStart);
      range.setEnd(text, end - nodeStart);
      const mark = document.createElement("mark");
      mark.className = "drg-suggestion-original";
      mark.dataset.suggestionId = it.id;
      try {
        range.surroundContents(mark);
        if (it.operation === "replace" && it.replacementText) {
          const ins = document.createElement("ins");
          ins.className = "drg-suggestion-inserted";
          ins.dataset.suggestionId = it.id;
          ins.textContent = it.replacementText;
          mark.after(ins);
        }
      } catch {
        // Cross-node selections remain comment-only in phase one.
      }
      break;
    }
  }
}

function wrapRange(container: HTMLElement, it: HighlightItem): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const segs: { node: Text; s: number; e: number }[] = [];
  let off = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    const len = t.data.length;
    const ns = off;
    const ne = off + len;
    const s = Math.max(it.start, ns);
    const e = Math.min(it.end, ne);
    if (s < e) segs.push({ node: t, s: s - ns, e: e - ns });
    off = ne;
    if (off >= it.end) break;
  }
  for (const seg of segs) {
    const r = document.createRange();
    r.setStart(seg.node, seg.s);
    r.setEnd(seg.node, seg.e);
    const mark = document.createElement("mark");
    mark.className = "drg-hl";
    mark.dataset.hlId = it.id;
    mark.dataset.num = String(it.num);
    try {
      r.surroundContents(mark);
    } catch {
      /* range crossed a node boundary; skip this segment */
    }
  }
}

function escapeId(id: string): string {
  if (typeof window !== "undefined" && window.CSS && typeof CSS.escape === "function") {
    return CSS.escape(id);
  }
  return id.replace(/["\\]/g, "\\$&");
}

/**
 * Measure each highlight's top relative to `refTop` (a viewport y, usually the
 * comment row's top). Uses the first mark per id (a highlight may span several
 * marks when it crosses block boundaries). Result is scroll-invariant as long
 * as refTop is sampled at the same instant.
 */
export function measureAnchors(
  container: HTMLElement,
  refTop: number,
  ids: string[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const id of ids) {
    const el = container.querySelector(
      `mark.drg-hl[data-hl-id="${escapeId(id)}"], mark.drg-suggestion-original[data-suggestion-id="${escapeId(id)}"]`,
    );
    if (el) map.set(id, (el as HTMLElement).getBoundingClientRect().top - refTop);
  }
  return map;
}

/** Toggle the active emphasis class on every mark for the given id. */
export function setActiveHighlight(container: HTMLElement, activeId: string | null): void {
  container.querySelectorAll("mark.drg-hl.is-active").forEach((el) => {
    el.classList.remove("is-active");
  });
  if (!activeId) return;
  container
    .querySelectorAll(`mark.drg-hl[data-hl-id="${escapeId(activeId)}"]`)
    .forEach((el) => el.classList.add("is-active"));
}
