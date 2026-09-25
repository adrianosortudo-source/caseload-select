import { expect, test, type Page } from '@playwright/test';

const ROUTE = '/tools/desired-client-matter';
const API = '**/api/tools/desired-client-matter/analyze';
const KEY = 'cls-desired-client-v2';
const baseline = {
  schema_version: 'dcm-v2.1', revision: 1,
  focus: { area: 'business', work: 'business_agreements', work_other: '', service_area: 'Ontario', certainty: 'chosen', route: 'established', comparison: null },
  situation: { timing: 'planning', role: 'business_organization', role_other: '', contact: null },
  client: { goals: ['complete'], concerns: ['cost', 'next'] },
  value: { reasons: ['client_benefit', 'fees', 'skills'], fee_effort: 'worthwhile', collected_fee: null, team_hours: null, payment: null },
  delivery: { conditions: ['scope', 'information'], capacity: 'room', limit: null },
  direction: { aim: 'more_current', evidence: ['repeated', 'records'], less: null, less_note: '' },
  clarifications: { FOCUS_UNCLEAR: null, CURRENT_CAPACITY_CONFLICT: null, FEE_EFFORT_CONFLICT: null, EXPERIENCE_DIRECTION_CONFLICT: null, CLIENT_GOAL_UNCLEAR: null },
};
const statement = (text: string, kind: string, ...source_answer_ids: string[]) => ({ text, kind, source_answer_ids });
const brief = {
  definition: statement('The firm wants more commercial agreement work for organizations planning a transaction.', 'preference', 'focus.work', 'situation.role', 'situation.timing'),
  client_goals: [statement('Clients want to complete a planned process and understand the cost and next steps.', 'experience', 'client.goals', 'client.concerns')],
  firm_reasons: [statement('The work uses the firm’s skills and offers useful client benefit.', 'experience', 'value.reasons')],
  delivery_conditions: [statement('Clear scope and access to information support delivery.', 'experience', 'delivery.conditions')],
  evidence: [statement('The firm identified several matters and fee and time records.', 'experience', 'direction.evidence')],
  open_questions: [],
  marketing: {
    topic: statement('Explain what organizations can prepare before asking for agreement advice.', 'suggestion', 'focus.work', 'situation.role'),
    inquiry_question: statement('What are you hoping to achieve with the agreement?', 'suggestion', 'client.goals', 'focus.work'),
    validation_step: statement('Compare this definition with recent matters and client feedback.', 'suggestion', 'direction.evidence'),
  },
  work_to_promote_less: [],
};
async function seed(page: Page, capacity = 'room') {
  await page.addInitScript(({ key, answers }) => {
    const now = Date.now();
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2, answers, currentStage: 7,
      lastEditedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 86400000).toISOString(),
    }));
  }, { key: KEY, answers: { ...baseline, delivery: { ...baseline.delivery, capacity } } });
}
async function openReview(page: Page, ai: boolean) {
  await page.goto(ROUTE);
  await page.getByRole('button', { name: ai ? 'Resume with AI assistance' : 'Resume without AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Does this describe the work you want more of?' })).toBeVisible();
}
async function createStructured(page: Page) {
  await seed(page);
  await openReview(page, false);
  await page.getByRole('button', { name: 'Create my brief', exact: true }).click();
}
test('a successful third attempt remains an AI brief, with no fourth request', async ({ page }) => {
  await seed(page);
  const requests: Record<string, unknown>[] = [];
  await page.route(API, route => {
    const payload = route.request().postDataJSON();
    requests.push(payload);
    if (requests.length < 3) return route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ ok: false, requestId: payload.requestId, error: { code: 'AI_UNAVAILABLE' } }),
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, requestId: payload.requestId, answerRevision: payload.answerRevision, reviewRunId: payload.reviewRunId,
      result: { brief, clarification_code: null },
    }) });
  });
  await openReview(page, true);
  await page.getByRole('button', { name: 'Prepare my brief with AI', exact: true }).click();
  await page.getByRole('button', { name: 'Try AI again', exact: true }).click();
  await page.getByRole('button', { name: 'Try AI again', exact: true }).click();
  await expect(page.getByText(brief.definition.text, { exact: true })).toBeVisible();
  await expect(page.getByText('Prepared with AI assistance from your answers.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try AI again', exact: true })).toHaveCount(0);
  expect(requests.map(r => r.analysisIndex)).toEqual([0, 1, 2]);
  expect(new Set(requests.map(r => r.reviewRunId)).size).toBe(1);
  expect(requests.map(r => r.clarifications)).toEqual([[], [], []]);
});
test('leaving a clarification open preserves answers and makes no extra request', async ({ page }) => {
  await seed(page, 'change');
  let calls = 0;
  await page.route(API, route => {
    calls++;
    const payload = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, requestId: payload.requestId, answerRevision: payload.answerRevision, reviewRunId: payload.reviewRunId,
      result: { brief, clarification_code: 'CURRENT_CAPACITY_CONFLICT' },
    }) });
  });
  await openReview(page, true);
  await page.getByRole('button', { name: 'Prepare my brief with AI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How should the profile describe this direction?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Leave this open', exact: true }).click();
  await expect(page.getByText(brief.definition.text, { exact: true })).toBeVisible();
  await expect(page.getByText('Still open: Establish the capacity or support needed before increasing demand.', { exact: true })).toBeVisible();
  expect(calls).toBe(1);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(saved.answers.revision).toBe(1);
  expect(saved.answers.delivery.capacity).toBe('change');
  expect(saved.answers.clarifications.CURRENT_CAPACITY_CONFLICT).toBeNull();
});
test('clipboard denial exposes the complete selectable brief', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } });
  });
  await createStructured(page);
  await page.getByRole('button', { name: 'Copy brief', exact: true }).click();
  const fallback = page.getByRole('textbox', { name: 'Select and copy the brief', exact: true });
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveValue(/Commercial agreement drafting and review/);
  await expect(fallback).toHaveValue(/Working draft, not yet reviewed/);
});
test('clear removes this draft while preserving other tools', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('another-tool-draft', 'keep'));
  await createStructured(page);
  await page.getByRole('button', { name: 'Clear this draft', exact: true }).click();
  await page.getByRole('button', { name: 'Clear draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Begin without AI', exact: true })).toBeVisible();
  const values = await page.evaluate(key => [localStorage.getItem(key), localStorage.getItem('another-tool-draft')], KEY);
  expect(values).toEqual([null, 'keep']);
});
test('expired draft is removed with the specified notice', async ({ page }) => {
  await page.addInitScript(({ key, answers }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 2, answers, currentStage: 7,
      lastEditedAt: new Date(Date.now() - 9 * 86400000).toISOString(),
      expiresAt: new Date(Date.now() - 2 * 86400000).toISOString() }));
  }, { key: KEY, answers: baseline });
  await page.goto(ROUTE);
  await expect(page.getByText('Your saved draft expired after seven days without changes. Start a new draft to continue.', { exact: true })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull();
});
test('printing uses the full brief with the export review status', async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { printCount: number }).printCount = 0;
    window.print = () => { (window as unknown as { printCount: number }).printCount++; }; });
  await createStructured(page);
  await page.getByRole('button', { name: 'Print / save PDF', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { printCount: number }).printCount)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('heading', { name: 'Your Desired Client Brief', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy brief', exact: true })).not.toBeVisible();
  await expect(page.getByText('Working draft, not yet reviewed', { exact: true })).toBeVisible();
  await expect(page.getByText('Which type of work should we focus on?: Commercial agreement drafting and review', { exact: true }).first()).toBeVisible();
});



test('switching to the structured brief discards a pending AI response', async ({ page }) => {
  await seed(page);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route(API, async route => {
    calls++;
    const payload = route.request().postDataJSON();
    await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, requestId: payload.requestId, answerRevision: payload.answerRevision, reviewRunId: payload.reviewRunId,
      result: { brief, clarification_code: null },
    }) }).catch(() => {});
  });
  await openReview(page, true);
  await page.getByRole('button', { name: 'Prepare my brief with AI', exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  await page.getByRole('button', { name: 'Create without AI', exact: true }).click();
  await expect(page.getByText('Structured summary of your answers.', { exact: true })).toBeVisible();
  release();
  await page.waitForTimeout(300);
  await expect(page.getByText('Structured summary of your answers.', { exact: true })).toBeVisible();
  await expect(page.getByText(brief.definition.text, { exact: true })).toHaveCount(0);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
  expect(saved.savedBrief.mode).toBe('structured');
});

test('network failure promptly leaves an exportable structured brief', async ({ page }) => {
  await seed(page);
  await page.route(API, route => route.abort('internetdisconnected'));
  await openReview(page, true);
  await page.getByRole('button', { name: 'Prepare my brief with AI', exact: true }).click();
  await expect(page.getByText('AI assistance is unavailable. Your structured brief is ready.', { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Download Markdown', exact: true })).toBeEnabled();
});


test('the actual local analyze route fails closed with AI disabled', async ({ request }) => {
  const payload = {
    schemaVersion: 2, requestId: '11111111-1111-4111-8111-111111111111', answerRevision: baseline.revision,
    reviewRunId: '22222222-2222-4222-8222-222222222222', analysisIndex: 0, aiConsent: true,
    answers: baseline, clarifications: [],
  };
  const response = await request.post('/api/tools/desired-client-matter/analyze', {
    headers: { origin: 'http://localhost:3301', 'sec-fetch-site': 'same-origin' }, data: payload,
  });
  expect(response.status()).toBe(503);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({ ok: false, requestId: payload.requestId, error: { code: 'AI_DISABLED' } });
});
