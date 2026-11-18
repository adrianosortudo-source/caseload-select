import { expect, test } from "@playwright/test";
import { fixture } from "./fixture";

test("keeps the first URL entered while the page is hydrating", async ({ page }) => {
  const domain = "https://synthetic-fixture.example/";
  const submissions: unknown[] = [];
  let startHydration!: () => void;
  const scriptsReleased = new Promise<void>(resolve => { startHydration = resolve; });

  await page.route("**/_next/**", async route => {
    if (route.request().resourceType() === "script") await scriptsReleased;
    await route.continue();
  });
  await page.route("**/api/tools/website-design-check", async route => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({ json: fixture });
  });

  const input = page.getByLabel("Public website URL");
  const submit = page.getByRole("button", { name: "Check my site" });
  try {
    await page.goto("/tools/website-design-check", { waitUntil: "commit" });
    await expect(input).toBeVisible();
    await input.fill(domain);
    await expect(submit).toBeDisabled();
    await input.press("Enter");
    await expect(input).toHaveValue(domain);
    expect(submissions).toEqual([]);
  } finally {
    startHydration();
  }

  await expect(submit).toBeEnabled();
  await expect(input).toHaveValue(domain);
  await expect(page.locator(".dc-input-prefix")).toHaveCount(0);
  await submit.click();
  await expect(page.locator(".dc-report-domain")).toHaveText(fixture.domain);
  expect(submissions).toEqual([{ domain }]);
});
