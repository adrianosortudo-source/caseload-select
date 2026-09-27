import { expect, test } from "@playwright/test";

test("exact applied Zarei source key opens only its firm profile and preserves failed read-back evidence", async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: { states: [] } }));
  await page.goto("/dev/prospect-qualified-preview?zareiProfile=1");
  const rows = page.getByRole("row").filter({ hasText: "Zarei Law Professional Corporation" });
  await expect(rows).toHaveCount(2);
  const linkedRow = rows.nth(0);
  const otherRow = rows.nth(1);
  await linkedRow.getByText("Research profile", { exact: true }).click();
  const links = linkedRow.getByRole("link", { name: "Open this firm’s research profile", exact: true });
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "/admin/prospects/firms/a9989dca-8626-4a6e-93ca-797a1cb7eed2");
  const profile = linkedRow.getByTestId("retained-research-profile");
  await expect(profile).toContainText("q50-zarei-law-professional-corporation");
  await expect(profile).toContainText("admin-prospects-readback-failed");
  await expect(profile).not.toContainText("synced");
  await otherRow.getByText("Research profile", { exact: true }).click();
  await expect(otherRow.getByRole("link", { name: "Open this firm’s research profile", exact: true })).toHaveCount(0);
});
