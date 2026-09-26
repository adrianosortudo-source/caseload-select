import { expect, test } from '@playwright/test';
import { choose, next, capture, layout, establishedToReview } from './helpers';
import fs from 'node:fs/promises';

const ROUTE = '/tools/desired-client-matter';
const API = '**/api/tools/desired-client-matter/analyze';
const WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;

test('complete, export and resume a basic blueprint without an AI request', async ({ page }) => {
  let calls = 0;
  await page.route(API, route => { calls++; return route.abort(); });
  await page.goto(ROUTE);
  await page.getByRole('button', { name: 'Begin with a basic blueprint', exact: true }).click();
  await establishedToReview(page);
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Create my basic blueprint', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Desired Client Blueprint', exact: true })).toBeVisible();
  for (const name of ['Desired client portrait', 'Client need', 'Firm value', 'Marketing direction', 'Proposed Screen questions', 'Still to confirm', 'Answers and sources'])
    await expect(page.getByRole('heading', { name, exact: true }).or(page.getByText(name, { exact: true }))).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Desired client portrait', exact: true }).locator('..')).toContainText('business purchase');
  await expect(page.locator('.dc-screen-table__row')).toHaveCount(4);
  await expect(page.getByText('not activate scoring', { exact: false })).toBeVisible();
  await expect(page.getByLabel('I have reviewed this wording and the proposed inquiry checks.', { exact: true })).not.toBeChecked();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download supporting detail', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const savedPath = await download.path();
  const markdown = await fs.readFile(savedPath!, 'utf8');
  expect(markdown).toContain('Working draft, not yet reviewed');
  expect(markdown).toContain('Commercial agreement drafting and review');
  expect(markdown).toContain('Matter fit');
  expect(markdown).toContain('not activated');
  const beforeResume = await page.evaluate(() => JSON.parse(localStorage.getItem('cls-desired-client-v2')!));
  await page.reload();
  await page.getByRole('button', { name: 'Resume without AI', exact: true }).click();
  const afterResume = await page.evaluate(() => JSON.parse(localStorage.getItem('cls-desired-client-v2')!));
  expect(afterResume.expiresAt).toBe(beforeResume.expiresAt);
  expect(afterResume.lastEditedAt).toBe(beforeResume.lastEditedAt);
  expect(calls).toBe(0);
});

test('unknown route can finish and labels unknowns for follow-up', async ({ page }) => {
  await page.goto(ROUTE);
  await page.getByRole('button', { name: 'Begin with a basic blueprint', exact: true }).click();
  await choose(page, 'Another practice area');
  await choose(page, 'Another type of work');
  await choose(page, 'We are deciding whether to pursue it');
  await page.getByRole('textbox', { name: 'Other type of legal work' }).fill('A distinct service');
  await next(page);
  await choose(page, 'Not sure yet');
  await choose(page, 'Before a planned decision or change');
  await choose(page, 'Business or organization');
  await next(page);
  await choose(page, 'Not sure yet');
  await next(page);
  await choose(page, "We're still deciding");
  await choose(page, "We haven't established this yet");
  await next(page);
  await choose(page, 'We need to establish that');
  await next(page);
  await choose(page, "We're still choosing a direction");
  await choose(page, 'Mainly our preference at this stage');
  await next(page);
  await page.getByRole('button', { name: 'Create my basic blueprint', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Desired Client Blueprint', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Still to confirm' })).toBeVisible();
});

test('AI outage leaves a usable basic blueprint', async ({ page }) => {
  let calls = 0;
  await page.route(API, route => {
    calls++;
    return route.fulfill({ status: 503, contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { code: 'AI_UNAVAILABLE', message: 'AI assistance is unavailable.' } }) });
  });
  await page.goto(ROUTE);
  await page.getByRole('button', { name: 'Begin with AI assistance', exact: true }).click();
  await establishedToReview(page);
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Build my Desired Client Blueprint', exact: true }).click();
  await expect(page.getByText('AI assistance is unavailable. Your basic blueprint is ready.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download one-page PDF', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Marketing direction', exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

for (const width of WIDTHS) {
  test('rendered guided flow at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(ROUTE);
    await layout(page);
    await capture(page, width + '-welcome');
    await page.getByRole('button', { name: 'Begin with a basic blueprint', exact: true }).click();
    await layout(page);
    await capture(page, width + '-focus');
    await establishedToReview(page, String(width));
    await layout(page);
    await capture(page, width + '-review');
    await page.getByRole('button', { name: 'Create my basic blueprint', exact: true }).click();
    await layout(page);
    await capture(page, width + '-result');
  });
}
