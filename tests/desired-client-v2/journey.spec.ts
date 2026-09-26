import { expect, test } from '@playwright/test';
import { choose, next, capture, layout, establishedToReview } from './helpers';
import fs from 'node:fs/promises';


const ROUTE = '/tools/desired-client-matter';
const API = '**/api/tools/desired-client-matter/analyze';
const WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;


test('complete, download and resume without any AI request', async ({ page }) => {
  let calls = 0;
  await page.route(API, route => { calls++; return route.abort(); });
  await page.goto(ROUTE);
  await page.getByRole('button', { name: 'Begin without AI', exact: true }).click();
  await establishedToReview(page);
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Create my brief', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Desired Client Brief', exact: true })).toBeVisible();
  for (const name of ['Work to pursue', 'What the client wants to achieve', 'Why this work appeals to your firm', 'Conditions for delivering it well', 'What supports this definition', 'Still to check', 'Use it in your marketing'])
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByLabel('I have reviewed this wording', { exact: true })).not.toBeChecked();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Markdown', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const saved = await download.path();
  const markdown = await fs.readFile(saved!, 'utf8');
  expect(markdown).toContain('Working draft, not yet reviewed');
  expect(markdown).toContain('Commercial agreement drafting and review');
  expect(markdown).toContain('Structured summary of your answers.');
  const beforeResume = await page.evaluate(() => JSON.parse(localStorage.getItem('cls-desired-client-v2')!));
  await page.reload();
  await page.getByRole('button', { name: 'Resume without AI', exact: true }).click();
  const afterResume = await page.evaluate(() => JSON.parse(localStorage.getItem('cls-desired-client-v2')!));
  expect(afterResume.expiresAt).toBe(beforeResume.expiresAt);
  expect(afterResume.lastEditedAt).toBe(beforeResume.lastEditedAt);
  expect(calls).toBe(0);
});

test('unknown route can finish without typing', async ({ page }) => {
  await page.goto(ROUTE);
  await page.getByRole('button', { name: 'Begin without AI', exact: true }).click();
  await choose(page, 'Another practice area');
  await choose(page, 'Another type of work');
  await choose(page, 'We are deciding whether to pursue it');
  await next(page);
  const unknowns = page.getByLabel('Not sure yet', { exact: true });
  await unknowns.nth(0).check();
  await unknowns.nth(1).check();
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
  await page.getByRole('button', { name: 'Create my brief', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Desired Client Brief', exact: true })).toBeVisible();
  await expect(page.getByText("The client's main goal is still to be established.", { exact: false }).first()).toBeVisible();
});

test('AI outage leaves a complete exportable structured brief', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Prepare my brief with AI', exact: true }).click();
  await expect(page.getByText('AI assistance is unavailable. Your structured brief is ready.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download Markdown', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Use it in your marketing', exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

for (const width of WIDTHS) {
  test('rendered guided flow at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(ROUTE);
    await layout(page);
    await capture(page, width + '-welcome');
    await page.getByRole('button', { name: 'Begin without AI', exact: true }).click();
    await layout(page);
    await capture(page, width + '-focus');
    await establishedToReview(page, String(width));
    await layout(page);
    await capture(page, width + '-review');
    await page.getByRole('button', { name: 'Create my brief', exact: true }).click();
    await layout(page);
    await capture(page, width + '-result');
  });
}
