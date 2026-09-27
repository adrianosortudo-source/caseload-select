import { expect, test, type Page } from '@playwright/test';
import { completeAnswers, validBlueprint } from '../../src/lib/desired-client/__tests__/blueprint-helpers';

const ROUTE = '/tools/desired-client-matter';
const API = '**/api/tools/desired-client-matter/analyze';
const KEY = 'cls-desired-client-v2';
const fixture = { answers: completeAnswers(), result: validBlueprint() };

async function openReview(page: Page) {
  await page.addInitScript(({ key, answers }) => {
    const now = Date.now();
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 2, answers, currentStage: 7,
      lastEditedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 86400000).toISOString() }));
  }, { key: KEY, answers: fixture.answers });
  await page.goto(ROUTE);
  await page.getByRole('button', { name: 'Continue my saved draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your direction' })).toBeVisible();
}

test('successful third attempt creates one AI profile and enforces the retry limit', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route(API, async route => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(request);
    if (requests.length < 3) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, requestId: request.requestId, error: { code: 'AI_UNAVAILABLE' } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, requestId: request.requestId, answerRevision: request.answerRevision, reviewRunId: request.reviewRunId,
      result: fixture.result,
    }) });
  });
  await openReview(page);
  await page.getByRole('button', { name: 'Create my profile', exact: true }).click();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Desired Client Blueprint', exact: true })).toBeVisible();
  await expect(page.getByText(fixture.result.brief.portrait.text, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  expect(requests.map(request => request.analysisIndex)).toEqual([0, 1, 2]);
  expect(new Set(requests.map(request => request.reviewRunId)).size).toBe(1);
});

test('network failure stays on Review with the saved answers and answer download', async ({ page }) => {
  await page.route(API, route => route.abort('internetdisconnected'));
  await openReview(page);
  await page.getByRole('button', { name: 'Create my profile', exact: true }).click();
  await expect(page.getByText(/We couldn't create your profile just now/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review your direction' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Client and situation', exact: true })).toBeVisible();
  const state = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(state.answers.situation.role).toBe('business_owner');
  expect(state.savedBrief).toBeUndefined();
  await expect(page.getByRole('button', { name: 'Download my answers', exact: true })).toBeEnabled();
});

test('actual local analyze route fails closed when AI is disabled', async ({ request }) => {
  const answers = fixture.answers as { revision: number };
  const payload = {
    schemaVersion: 2, requestId: '11111111-1111-4111-8111-111111111111', answerRevision: answers.revision,
    reviewRunId: '22222222-2222-4222-8222-222222222222', analysisIndex: 0, aiConsent: true,
    answers: fixture.answers, clarifications: [],
  };
  const response = await request.post('/api/tools/desired-client-matter/analyze', {
    headers: { origin: 'http://localhost:3301', 'sec-fetch-site': 'same-origin' }, data: payload,
  });
  expect(response.status()).toBe(503);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({ ok: false, requestId: payload.requestId, error: { code: 'AI_DISABLED' } });
});
