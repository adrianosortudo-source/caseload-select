import { expect, test } from '@playwright/test';
import { capture, layout } from './helpers';
import { completeAnswers, validBlueprint } from '../../src/lib/desired-client/__tests__/blueprint-helpers';

const fixture = { answers: completeAnswers(), result: validBlueprint() };

test('optional question groups stay visible through the guided discovery flow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/tools/desired-client-matter');
  await page.getByRole('button', { name: 'Define my desired client' }).click();
  await page.getByLabel('Business & commercial', { exact: true }).check();
  await page.getByLabel('Commercial agreement drafting and review', { exact: true }).check();
  await page.getByLabel('We already do it and want more', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('A business purchase, sale or ownership change is planned', { exact: true }).check();
  await page.getByLabel('Before a planned decision or change', { exact: true }).check();
  await page.getByLabel('Business or organization', { exact: true }).check();
  await expect(page.getByRole('heading', { name: 'First contact (optional)' })).toBeVisible();
  await expect(page.getByLabel('Who makes the first contact?').first()).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Client concerns (optional)' })).toBeVisible();
  await page.getByLabel('Complete a planned transaction or process', { exact: true }).check();
  await expect(page.getByLabel("I'm worried about the cost")).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Commercial detail (optional)' })).toBeVisible();
  await expect(page.getByText('Typical total team time')).toBeVisible();
  await page.getByLabel('It lets us make a useful difference for the client', { exact: true }).check();
  await page.getByLabel('Usually worthwhile', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Important limit (optional)' })).toBeVisible();
  await expect(page.getByLabel('Too little preparation time')).toBeVisible();
  await page.getByLabel('Yes, with the current team', { exact: true }).check();
  await page.getByLabel('They are open to agreeing the scope and next step', { exact: true }).check();
  await layout(page);
  await capture(page, 'profile-experience-375-delivery');
});

test('a saved AI result opens the synthesized Blueprint report', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.addInitScript(({ answers, brief }) => {
    const now = Date.now();
    localStorage.setItem('cls-desired-client-v2', JSON.stringify({ schemaVersion: 2, answers, currentStage: 7,
      lastEditedAt: new Date(now).toISOString(), expiresAt: new Date(now + 7 * 86400000).toISOString(),
      savedBrief: { brief, sourceBriefRevision: (answers as { revision: number }).revision,
        generatedAt: new Date(now).toISOString(), wordingReviewed: false, mode: 'ai' } }));
  }, { answers: fixture.answers, brief: fixture.result.brief });
  await page.goto('/tools/desired-client-matter');
  await page.getByRole('button', { name: 'Continue my saved draft' }).click();
  await expect(page.getByRole('heading', { name: 'Desired Client Blueprint', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Desired client portrait', exact: true }).first()).toBeVisible();
  await expect(page.getByText(fixture.result.brief.portrait.text, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download one-page PDF', exact: true })).toBeVisible();
  for (const width of [1440, 1024, 768, 640, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.locator('.dc-brief').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    if ([1440, 768, 320].includes(width)) await capture(page, `profile-experience-${width}-ai`);
  }
});
