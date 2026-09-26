import { expect, type Page, type Frame } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const EVIDENCE = path.resolve('docs/desired-client-v2/review');

export async function choose(page: Page, label: string) {
  await page.getByLabel(label, { exact: true }).check();
}
export async function next(page: Page) {
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}
export async function settled(page: Page | Frame) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
}
export async function capture(page: Page, name: string) {
  await settled(page);
  await fs.mkdir(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, name + '.png'), fullPage: true });
}
export async function layoutFailures(page: Page | Frame) {
  await settled(page);
  const failures = await page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('Page overflows horizontally');
    const isVisible = (el: Element) => {
      if (el.closest('.dc-visually-hidden')) return false;
      const closedDetails = el.closest('details:not([open])');
      if (closedDetails && !closedDetails.querySelector(':scope > summary')?.contains(el)) return false;
      return el.getClientRects().length > 0 && el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true });
    };
    for (const el of document.querySelectorAll<HTMLElement>('[data-ui-copy]')) {
      if (!isVisible(el) || el.dataset.uiCopyException) continue;
      const text = el.textContent?.trim() ?? '';
      if (text.includes('\u2014')) out.push('Em dash: ' + text);
      const box = el.parentElement?.closest<HTMLElement>('[data-ui-component-content]');
      const rect = el.getBoundingClientRect();
      const controlLabel = el.matches('.dc-option__label, .dc-reviewed > span');
      const intrinsicControl = el.matches('button, .dc-badge');
      if (controlLabel) {
        // Native choice controls reserve only the input and its gap. Their text
        // must fill the remaining label content track; wrapping is still checked.
        const label = el.parentElement!, input = label.querySelector('input')!;
        const lr = label.getBoundingClientRect(), ir = input.getBoundingClientRect(), cs = getComputedStyle(label);
        const right = lr.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        const left = ir.right + parseFloat(cs.columnGap || cs.gap || '0');
        if (Math.abs(rect.left - left) > 1.5 || Math.abs(rect.right - right) > 1.5)
          out.push('Narrow control label: ' + text);
      } else if (box && !intrinsicControl) {
        const br = box.getBoundingClientRect(), cs = getComputedStyle(box);
        const left = br.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
        const right = br.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        if (Math.abs(rect.left - left) > 1.5 || Math.abs(rect.right - right) > 1.5)
          out.push('Narrow copy: ' + text);
      }
      const textStyle = getComputedStyle(el);
      const contentRight = rect.right - parseFloat(textStyle.paddingRight) - parseFloat(textStyle.borderRightWidth);
      const contentWidth = rect.width - parseFloat(textStyle.paddingLeft) - parseFloat(textStyle.paddingRight) - parseFloat(textStyle.borderLeftWidth) - parseFloat(textStyle.borderRightWidth);
      const lines: { y: number; words: { left: number; right: number; width: number }[] }[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const s = node.textContent ?? '';
        for (const match of s.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index!);
          range.setEnd(node, match.index! + match[0].length);
          const r = range.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          let line = lines.find(l => Math.abs(l.y - r.top) < 2);
          if (!line) { line = { y: r.top, words: [] }; lines.push(line); }
          line.words.push({ left: r.left, right: r.right, width: r.width });
        }
      }
      lines.sort((a, b) => a.y - b.y);
      if (lines.length > 1 && lines.at(-1)!.words.length === 1) out.push('Single-word last line: ' + text);
      for (let i = 0; i < lines.length - 1; i++) {
        const current = lines[i].words, following = lines[i + 1].words[0];
        const used = Math.max(...current.map(w => w.right)) - Math.min(...current.map(w => w.left));
        const remaining = contentRight - Math.max(...current.map(w => w.right));
        if (used / contentWidth < .75 && following && following.width + 6 < remaining)
          out.push('Avoidably short nonfinal line: ' + text);
      }
    }
    return out;
  });
  return failures;
}
export async function layout(page: Page | Frame) {
  expect.soft(await layoutFailures(page)).toEqual([]);
}
export async function establishedToReview(page: Page, screenshotPrefix?: string) {
  await choose(page, 'Business & commercial');
  await choose(page, 'Commercial agreement drafting and review');
  await choose(page, 'We already do it and want more');
  await next(page);
  await choose(page, 'Before a planned decision or change');
  await choose(page, 'Business or organization');
  await next(page);
  await choose(page, 'Complete a planned transaction or process');
  await choose(page, "I'm worried about the cost");
  await choose(page, "I don't know what happens next");
  await next(page);
  await expect(page.getByText('Your starting point', { exact: true })).toBeVisible();
  await choose(page, 'It lets us make a useful difference for the client');
  await choose(page, 'The fee usually supports the effort');
  await choose(page, 'It uses work we do well');
  await choose(page, 'Usually worthwhile');
  if (screenshotPrefix) { await layout(page); await capture(page, screenshotPrefix + '-value'); }
  await next(page);
  await choose(page, 'A clearly agreed scope');
  await choose(page, 'Access to the information we need');
  await choose(page, 'Yes, with the current team');
  await next(page);
  await choose(page, 'More of the work we already handle well');
  await choose(page, 'Several matters we have handled');
  await choose(page, 'Fee and time records');
  await next(page);
  await expect(page.getByRole('heading', { name: 'Does this describe the work you want more of?' })).toBeVisible();
}
