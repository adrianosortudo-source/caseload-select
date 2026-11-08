/** Executed in the browser after real fonts settle. */
export function auditRenderedCopy() {
 const failures: { text: string; issue: string }[] = [];
 for (const el of document.querySelectorAll<HTMLElement>("[data-ui-copy]")) {
  const rect = el.getBoundingClientRect(); if (!rect.width || el.closest("[hidden]") || el.closest("details:not([open])")) continue;
  const component = el.closest<HTMLElement>("[data-ui-component-content]");
  if (component && el.parentElement === component) { const b = component.getBoundingClientRect(), s = getComputedStyle(component); const expected = b.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth); if (Math.abs(rect.width - expected) > 2) failures.push({ text: el.textContent || "", issue: "usable-width" }); }
  const lines: { top: number; left: number; right: number; widths: number[] }[] = []; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node;
  while ((node = walker.nextNode())) for (const m of (node.textContent || "").matchAll(/\S+/g)) { const r = document.createRange(); r.setStart(node, m.index!); r.setEnd(node, m.index! + m[0].length); const box = r.getBoundingClientRect(); if (!box.width || !box.height) continue; let line = lines.find(l => Math.abs(l.top - box.top) < 2); if (!line) { line = { top: box.top, left: box.left, right: box.right, widths: [] }; lines.push(line); } line.right = box.right; line.widths.push(box.width); }
  if (lines.length > 1 && lines.at(-1)!.widths.length === 1) failures.push({ text: el.textContent || "", issue: "single-word-ending" });
  for (let i = 0; i < lines.length - 1; i++) { const used = lines[i].right - lines[i].left; if (used < rect.width * .75 && rect.width - used > lines[i + 1].widths[0] + 5) { failures.push({ text: el.textContent || "", issue: "avoidable-short-line" }); break; } }
 }
 return { overflow: document.documentElement.scrollWidth > innerWidth, failures };
}
