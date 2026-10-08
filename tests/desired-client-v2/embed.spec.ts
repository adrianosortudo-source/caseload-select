import { expect, test } from '@playwright/test';
import { capture, layout } from './helpers';

test('iframe uses verified messages, grows and shrinks, and preserves the public wrapper', async ({ page }) => {
  const appOrigin = new URL(test.info().project.use.baseURL ?? 'http://localhost:3301').origin;
  await page.goto('http://localhost:3300/tools/desired-client-matter.html');
  const frame = page.frameLocator('iframe[data-desired-client-frame]');
  await expect(frame.getByRole('button', { name: 'Build my profile', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the tool in its own window', exact: true })).toHaveAttribute('href', appOrigin + '/tools/desired-client-matter');
  const child = page.frames().find(f => f.url().startsWith(appOrigin + '/'));
  expect(child).toBeTruthy();
  const dimensions = async () => page.locator('iframe[data-desired-client-frame]').evaluate(el => ({ height: el.getBoundingClientRect().height, style: el.style.height }));
  await expect.poll(async () => (await dimensions()).style).not.toBe('');
  const before = await dimensions();
  await page.evaluate((appOrigin) => {
    const el = document.querySelector('iframe')!;
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://unrelated.example', source: el.contentWindow, data: { type: 'desired-client:height', version: 1, height: 16000 } }));
    window.dispatchEvent(new MessageEvent('message', { origin: appOrigin, source: window, data: { type: 'desired-client:height', version: 1, height: 15000 } }));
  });
  expect(await dimensions()).toEqual(before);
  await frame.getByRole('button', { name: 'Build my profile', exact: true }).first().click();
  const practiceHeight = (await dimensions()).height;
  await frame.getByRole('group', { name: 'What do you want this profile to help your firm do?', exact: true }).getByRole('radio').last().check();
  await frame.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'Which client situation and specific matter do you want more of?', exact: true })).toBeVisible();
  await frame.getByLabel('Practice area for the work list').selectOption({ label: 'Business & commercial' });
  await expect.poll(async () => {
    const height = await child!.evaluate(() => document.documentElement.scrollHeight);
    return Math.abs((await dimensions()).height - height);
  }).toBeLessThanOrEqual(2);
  const focusHeight = (await dimensions()).height;
  expect(focusHeight).toBeGreaterThan(practiceHeight);
  await frame.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'What work does the firm want to build around?', exact: true })).toBeVisible();
  await expect.poll(async () => (await dimensions()).height).toBeLessThan(focusHeight);
  const stable = (await dimensions()).height;
  await page.waitForTimeout(500);
  expect((await dimensions()).height).toBe(stable);
});

for (const width of [1440, 1024, 768, 640, 390, 375, 320]) {
  test('embedded welcome reflows at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('http://localhost:3300/tools/desired-client-matter.html');
    const frame = page.frameLocator('iframe[data-desired-client-frame]');
    await expect(frame.getByRole('button', { name: 'Build my profile', exact: true }).first()).toBeVisible();
    await layout(page);
    const child = page.frames().find(f => f.url().startsWith(appOrigin + '/'))!;
    await layout(child);
    expect(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await capture(page, width + '-embedded-welcome');
  });
}
