import { test, expect } from "@playwright/test";
import { renderedCopyFailures } from "./browser-support";

test("all returned dispositions retain structured intake, research profiles and filters at six widths", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.fulfill({ json: { states: [] } }));
  await page.goto("/dev/prospect-qualified-preview?supplementalGbp=1");
  await page.getByRole("button", { name: "More qualification filters" }).click();
  for (const width of [1440, 1024, 768, 640, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const status of ["held", "rejected", "incomplete", "not_selected"]) {
      await page.getByRole("combobox", { name: "Research field", exact: true }).selectOption("/supplementalEvidence/qualification/criteria/originalStatus");
      await page.getByRole("combobox", { name: "Research value", exact: true }).selectOption(JSON.stringify(status));
      await expect(page.getByText("1 of 4 unified prospect records", { exact: true })).toBeVisible();
      const row = page.getByRole("row").filter({ has: page.getByTestId("retained-research-profile") });
      await row.getByText("Research profile", { exact: true }).click();
      const profile = row.getByTestId("retained-research-profile");
      await expect(profile.getByText(status, { exact: true })).toBeVisible();
      if (status === "not_selected") await expect(profile.getByText("needs_evidence", { exact: true })).toBeVisible();
      await expect(profile.getByRole("link", { name: "https://synthetic.example.test/contact", exact: true })).toHaveAttribute("href", "https://synthetic.example.test/contact");
      await expect(profile.getByText("Consent", { exact: true })).toBeVisible();
      await expect(profile.getByText("2026-09-24", { exact: true }).first()).toBeVisible();
      await expect(profile).not.toContainText("[object Object]");
      expect(await renderedCopyFailures(page)).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(width + "-" + status + "-profile.png"), fullPage: true });
      await row.getByText("Research profile", { exact: true }).click();
    }
    await page.getByRole("combobox", { name: "Research field", exact: true }).selectOption("");
    await page.getByPlaceholder("Firm, research, source, date, or status").fill("synthetic-gap");
    await expect(page.getByText("4 of 4 unified prospect records", { exact: true })).toBeVisible();
    await page.getByLabel("Visible intake channel").selectOption("web-form");
    await expect(page.getByText("4 of 4 unified prospect records", { exact: true })).toBeVisible();
    await page.getByPlaceholder("Firm, research, source, date, or status").fill("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  }
  expect(errors).toEqual([]);
});
