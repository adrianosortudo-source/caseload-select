import { expect, test } from '@playwright/test';
import { choose, next } from './helpers';

test('comparison keeps the lawyer’s provisional choice and only fills unanswered ratings', async ({ page }) => {
  await page.goto('/tools/desired-client-matter');
  await page.getByRole('button', { name: 'Begin without AI', exact: true }).click();
  await choose(page, 'Business & commercial');
  await choose(page, 'Commercial agreement drafting and review');
  await choose(page, 'We are building toward it');
  await page.getByRole('button', { name: 'Help me compare two', exact: true }).click();
  await choose(page, 'Commercial agreement drafting and review');
  await choose(page, 'Buying or selling a business');
  await next(page);
  const candidates = page.locator('.dc-candidate');
  for (let i = 0; i < 2; i++) {
    const candidate = candidates.nth(i);
    await candidate.getByRole('group', { name: 'Fee compared with effort', exact: true }).getByRole('radio').first().check();
    await candidate.getByLabel(i === 0 ? 'We have demonstrated capability' : 'We need to develop capability or support', { exact: true }).check();
    await candidate.getByLabel(i === 0 ? 'Room for more' : 'Changes needed first', { exact: true }).check();
    await candidate.getByLabel(i === 0 ? 'Repeated experience' : 'Mainly an expectation', { exact: true }).check();
  }
  await next(page);
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Explore Buying or selling a business provisionally', exact: true }).click();
  await expect(page.getByLabel('Buying or selling a business', { exact: true })).toBeChecked();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cls-desired-client-v2')!));
  expect(saved.answers.focus.work).toBe('business_acquisitions');
  expect(saved.answers.focus.certainty).toBe('provisional');
  expect(saved.answers.focus.comparison.selected).toBe('b');
  expect(saved.answers.delivery.capacity).toBe('change');
  await next(page);
  await expect(page.getByRole('heading', { name: 'When does this client usually seek help?', exact: true })).toBeVisible();
});

test('keyboard controls report a missing required answer and keep visible focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/tools/desired-client-matter');
  const begin = page.getByRole('button', { name: 'Begin without AI', exact: true });
  await begin.focus();
  await page.keyboard.press('Enter');
  const heading = page.getByRole('heading', { name: 'What legal work do you want more of?', exact: true });
  await expect(heading).toBeFocused();
  await page.getByRole('button', { name: 'Continue', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Choose an answer to continue.', { exact: true }).first()).toBeVisible();
  const first = page.getByLabel('Business & commercial', { exact: true });
  await first.focus();
  await page.keyboard.press('Space');
  await expect(first).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(first).toBeChecked();
});
