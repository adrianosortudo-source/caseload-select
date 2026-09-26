import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { capture, layout } from './helpers';
import type { DesiredClientAnswers } from '@/lib/desired-client/types';

const ROUTE = '/tools/desired-client-matter';
const API = '**/api/tools/desired-client-matter/analyze';
const KEY = 'cls-desired-client-v2';
const WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;
const fixtures = JSON.parse(readFileSync(path.resolve('docs/desired-client-v2/review/structured-fixtures.json'), 'utf8')) as Array<{ id: string; answers: DesiredClientAnswers }>;
const p09 = fixtures.find((fixture) => fixture.id === 'P09')!;

async function resumeRichReview(page: Page) {
  const answers = structuredClone(p09.answers);
  answers.situation.contact = 'manager';
  answers.client.goals = ['complete', 'protect'];
  answers.delivery.limit = 'scope';
  answers.direction.less = 'within';
  answers.direction.less_note = 'Routine contract enquiries';
  await page.addInitScript(({ key, answers: seeded }) => {
    const now = Date.now();
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 2, answers: seeded, currentStage: 7,
      lastEditedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 86400000).toISOString() }));
  }, { key: KEY, answers });
  await page.route(API, (route) => route.abort());
  await page.goto(ROUTE);
  await page.getByRole('button', { name: 'Resume without AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Does this describe the work you want more of?' })).toBeVisible();
}

for (const width of WIDTHS) {
  test(`rich review and brief content at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await resumeRichReview(page);
    await expect(page.getByText('First contact', { exact: true })).toBeVisible();
    for (const value of [
      'Manager or executive',
      'Complete a planned transaction or process',
      'Protect something important',
      "I'm worried about the cost",
      "I don't know what happens next",
      'The fee usually supports the effort',
      'C$15,000 to under C$50,000',
      'More than 40, up to 100 hours',
      'Depends on the matter',
      'Scope expands without agreement',
      'Routine contract enquiries',
    ]) await expect(page.getByText(value, { exact: false }).first()).toBeVisible();
    const goals = page.locator('dl.dc-fact-row').filter({ has: page.getByText('Goals', { exact: true }) });
    await expect(goals.locator('dd')).toHaveText(['Complete a planned transaction or process', 'Protect something important']);
    await layout(page);
    await capture(page, `audit-rich-${width}-review`);

    await page.getByRole('button', { name: 'Create my brief', exact: true }).click();
    await expect(page.getByText('First contact: Manager or executive. This may be someone other than the client.', { exact: true })).toBeVisible();
    await expect(page.getByText('Complete a planned transaction or process', { exact: true })).toBeVisible();
    await expect(page.getByText('Protect something important', { exact: true })).toBeVisible();
    await layout(page);
    await capture(page, `audit-rich-${width}-brief`);
  });
}
