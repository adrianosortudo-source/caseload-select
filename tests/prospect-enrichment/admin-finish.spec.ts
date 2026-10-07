import { expect, test, type Page } from "@playwright/test";

const firmPath = "/admin/prospects/firms/de1e6289-836f-487c-9e98-913f88c3db73";
const firmLinkName = /^Open this firm['\u2019]s research profile$/;

async function fixtureTransport(page: Page) {
  await page.route("**/api/**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/candidates")
    ? { items: [], filteredCount: 0, inventoryCount: 0, coverageRevision: 60004, readWarnings: [], complete: true, nextCursor: null }
    : { states: [] } }));
  // Serve the actual detail/list components with gated synthetic data. Navigation
  // still uses the actual firm UUID and actual visible Back link at their Admin URLs.
  await page.route(url => url.pathname === firmPath || url.pathname === "/admin/prospects", async route => {
    const requested = new URL(route.request().url());
    const preview = new URL("/dev/prospect-qualified-preview",requested.origin);
    preview.search = requested.search;
    preview.searchParams.set(requested.pathname === firmPath ? "adminFinishDetail" : "adminFinish","1");
    await route.continue({url:preview.href});
  });
}

async function openSecondPageFirm(page: Page) {
  await page.goto("/dev/prospect-qualified-preview?adminFinish=1&cr_text=Adil+Law&cr_cursor=frozen%2F60004&cr_coverageRevision=60004#retained-context");
  await page.getByRole("combobox", { name: "Practice area", exact: true }).selectOption("Corporate Matters");
  await page.getByRole("combobox", { name: "City", exact: true }).selectOption("Mississauga");
  await page.getByRole("button", { name: "More qualification filters", exact: true }).click();
  await expect(page.getByText("101 of 102 unified prospect records", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Showing 101\u2013101", { exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("up_page")).toBe("1");
  const row = page.getByRole("row").filter({ hasText: "Adil Law" });
  await row.getByText("Research profile", { exact: true }).click();
  await row.getByRole("link", { name: firmLinkName }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(firmPath);
  await expect(page.getByTestId("prospect-research-detail").getByRole("heading", {name:"Adil Law",exact:true})).toBeVisible();
  const returnTo = new URL(page.url()).searchParams.get("returnTo");
  expect(returnTo).toContain("up_page=1");
  await expect(page.getByRole("link", {name:"Back to prospect list",exact:true})).toHaveAttribute("href",returnTo!);
}

async function assertRestored(page: Page) {
  await expect(page.getByRole("combobox", { name: "Practice area", exact: true })).toHaveValue("Corporate Matters");
  await expect(page.getByRole("combobox", { name: "City", exact: true })).toHaveValue("Mississauga");
  await expect(page.getByRole("combobox", { name: "Research field", exact: true })).toBeVisible();
  await expect(page.getByText("Showing 101\u2013101", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Adil Law" })).toHaveCount(1);
  const restored = new URL(page.url());
  expect(restored.searchParams.get("cr_text")).toBe("Adil Law");
  expect(restored.searchParams.get("cr_cursor")).toBe("frozen/60004");
  expect(restored.searchParams.get("cr_coverageRevision")).toBe("60004");
  expect(restored.hash).toBe("#retained-context");
}

test("canonical service facet and exact identity isolate Adil from its unbound same-name twin", async ({ page }, testInfo) => {
  await fixtureTransport(page);
  await page.goto("/dev/prospect-qualified-preview?adminFinish=1");
  const practice = page.getByRole("combobox", { name: "Practice area", exact: true });
  await expect(practice.getByRole("option", { name: "Corporate Matters", exact: true })).toHaveCount(1);
  await expect(practice.getByRole("option", { name: "Notary Availability", exact: true })).toHaveCount(1);
  await page.getByPlaceholder("Firm, research, source, date, or status").fill("Notary availability");
  await practice.selectOption("Notary Availability");
  await page.getByRole("combobox", { name: "City", exact: true }).selectOption("Mississauga");
  await expect(page.getByText("1 of 102 unified prospect records", { exact: true })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Adil Law" });
  await expect(row.getByText("Linked identity", { exact: true })).toBeVisible();
  await expect(row.getByText("Identity review needed", { exact: true })).toHaveCount(0);
  await row.getByText("Research profile", { exact: true }).click();
  const href = await row.getByRole("link", {name:firmLinkName}).getAttribute("href");
  const target = new URL(href!,page.url());
  expect(target.pathname).toBe(firmPath);
  expect(new URL(target.searchParams.get("returnTo")!,target.origin).searchParams.get("up_practiceArea")).toBe("Notary Availability");
  await page.screenshot({ path: testInfo.outputPath("canonical-service-and-identity.png"), fullPage: true });
  await page.getByRole("combobox", { name: "City", exact: true }).selectOption("Toronto");
  await expect(page.getByText("0 of 102 unified prospect records", { exact: true })).toBeVisible();
});

test("browser history Back restores existing filters, advanced controls and page", async ({ page }, testInfo) => {
  await fixtureTransport(page);
  await openSecondPageFirm(page);
  await page.goBack();
  await assertRestored(page);
  await page.screenshot({ path: testInfo.outputPath("history-restored-filter-page.png"), fullPage: true });
});

test("actual firm detail Back control restores existing filters, candidate context and page", async ({ page }, testInfo) => {
  await fixtureTransport(page);
  await openSecondPageFirm(page);
  await page.getByRole("link", {name:"Back to prospect list",exact:true}).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/admin/prospects");
  await assertRestored(page);
  await page.screenshot({ path: testInfo.outputPath("visible-back-restored-filter-page.png"), fullPage: true });
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has("up_page")).toBe(false);
  await expect(page.getByText("Showing 1\u2013100", { exact: true })).toBeVisible();
});
