import { expect, test, type Page } from '@playwright/test';
import { completeAnswers, validBlueprint } from '../../src/lib/desired-client/__tests__/blueprint-helpers';
import { establishedToReview, layout } from './helpers';

const ROUTE = '/tools/desired-client-matter';
const API = '**/api/tools/desired-client-matter/analyze';
const KEY = 'cls-desired-client-v2';
const WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;
const fixture = { answers: completeAnswers(), result: validBlueprint() };

async function seedReview(page: Page) {
  await page.addInitScript(({ key, answers }) => {
    const now = Date.now();
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 2, answers, currentStage: 7,
      lastEditedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 86400000).toISOString() }));
  }, { key: KEY, answers: fixture.answers });
  await page.goto(ROUTE);
  await page.getByRole('button', { name: 'Continue my saved draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your direction' })).toBeVisible();
}

test('one welcome action opens the guided discovery journey', async ({ page }) => {
  let calls = 0;
  await page.route(API, route => { calls++; return route.abort(); });
  await page.goto(ROUTE);
  await expect(page.getByRole('button', { name: 'Define my desired client', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Begin with|basic blueprint|without AI/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Define my desired client', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What legal work do you want more of?' })).toBeVisible();
  await establishedToReview(page);
  expect(calls).toBe(0);
});

test('Review consent creates an AI Desired Client Blueprint', async ({ page }) => {
  let calls = 0;
  await page.route(API, async route => {
    calls++;
    const request = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, requestId: request.requestId, answerRevision: request.answerRevision,
      reviewRunId: request.reviewRunId, result: fixture.result,
    }) });
  });
  await seedReview(page);
  await page.getByRole('button', { name: 'Create my profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Desired Client Blueprint', exact: true })).toBeVisible();
  await expect(page.getByText(fixture.result.brief.definition_sentence, { exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

test('AI failure keeps answers on Review, allows bounded retry, and downloads answers without implying a profile', async ({ page }) => {
  let calls = 0;
  await page.route(API, route => {
    calls++;
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'AI_UNAVAILABLE' } }) });
  });
  await seedReview(page);
  await page.getByRole('button', { name: 'Create my profile', exact: true }).click();
  await expect(page.getByText(/We couldn't create your profile just now/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review your direction' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Client and situation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my answers', exact: true }).click();
  const download = await downloadPromise;
  const savedPath = await download.path();
  const markdown = await import('node:fs/promises').then(fs => fs.readFile(savedPath!, 'utf8'));
  expect(download.suggestedFilename()).toMatch(/discovery-answers.*\.md$/);
  expect(markdown).toContain('Answer record only. A Desired Client Blueprint has not been generated.');
  expect(calls).toBe(3);
});

for (const width of WIDTHS) {
  test(`single-path welcome and guided review render at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(ROUTE);
    await layout(page);
    await page.getByRole('button', { name: 'Define my desired client', exact: true }).click();
    await layout(page);
  });
}
