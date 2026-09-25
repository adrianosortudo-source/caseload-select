import { expect, test } from '@playwright/test';
import { capture, layout } from './helpers';

test('iframe uses verified messages, grows and shrinks, and preserves the public wrapper', async ({ page }) => {
  await page.goto('http://localhost:3300/tools/desired-client-matter.html');
  const frame = page.frameLocator('iframe[data-desired-client-frame]');
  await expect(frame.getByRole('button', { name: 'Begin without AI', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the tool in its own window', exact: true })).toHaveAttribute('href', 'http://localhost:3301/tools/desired-client-matter');
  const child = page.frames().find(f => f.url().includes('localhost:3301'));
  expect(child).toBeTruthy();
  const dimensions = async () => page.locator('iframe[data-desired-client-frame]').evaluate(el => ({ height: el.getBoundingClientRect().height, style: el.style.height }));
  await expect.poll(async () => (await dimensions()).style).not.toBe('');
  const before = await dimensions();
  await page.evaluate(() => {
    const el = document.querySelector('iframe')!;
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://unrelated.example', source: el.contentWindow, data: { type: 'desired-client:height', version: 1, height: 16000 } }));
    window.dispatchEvent(new MessageEvent('message', { origin: 'http://localhost:3301', source: window, data: { type: 'desired-client:height', version: 1, height: 15000 } }));
  });
  expect(await dimensions()).toEqual(before);
  await frame.getByRole('button', { name: 'Begin without AI', exact: true }).click();
  await frame.getByLabel('Business & commercial', { exact: true }).check();
  await frame.getByLabel('Commercial agreement drafting and review', { exact: true }).check();
  await frame.getByLabel('We already do it and want more', { exact: true }).check();
  await expect.poll(async () => {
    const height = await child!.evaluate(() => document.documentElement.scrollHeight);
    return Math.abs((await dimensions()).height - height);
  }).toBeLessThanOrEqual(2);
  const focusHeight = (await dimensions()).height;
  await frame.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(frame.getByRole('heading', { name: 'When does this client usually seek help?', exact: true })).toBeVisible();
  await expect.poll(async () => (await dimensions()).height).toBeLessThan(focusHeight);
  const stable = (await dimensions()).height;
  await page.waitForTimeout(500);
  expect((await dimensions()).height).toBe(stable);
});

for (const width of [1440, 1024, 768, 640, 375, 320]) {
  test('embedded welcome reflows at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('http://localhost:3300/tools/desired-client-matter.html');
    const frame = page.frameLocator('iframe[data-desired-client-frame]');
    await expect(frame.getByRole('button', { name: 'Begin without AI', exact: true })).toBeVisible();
    await layout(page);
    const child = page.frames().find(f => f.url().includes('localhost:3301'))!;
    await layout(child);
    expect(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await capture(page, width + '-embedded-welcome');
  });
}
