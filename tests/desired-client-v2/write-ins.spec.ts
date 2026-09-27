import { expect, test } from "@playwright/test";
import { capture, layout } from "./helpers";

for (const width of [320, 768]) {
  test("custom-only answers complete the guided flow at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/tools/desired-client-matter");
    await page.getByRole("button", { name: "Define my desired client" }).click();
    await page.getByLabel("Business & commercial", { exact: true }).check();
    await page.getByLabel("Buying or selling a business", { exact: true }).check();
    await page.getByLabel("We already do it and want more", { exact: true }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await page.getByRole("textbox", { name: "Other answer to: What usually happens that makes this client seek help?" }).fill("An owner plans a sale");
    await page.getByRole("textbox", { name: "Other answer to: At what stage do they usually contact you?" }).fill("Before a planned sale");
    await page.getByLabel("Business or organization", { exact: true }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await page.getByRole("textbox", { name: "Other answer to: What does the client most want to achieve?" }).fill("Prepare the company for a smooth handover");
    await page.getByRole("textbox", { name: "Other answer to: What concern have you heard from these clients?" }).fill("Keeping key staff informed");
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await page.getByRole("textbox", { name: "Other answer to: What makes this work especially desirable for your firm?" }).fill("The team values complex ownership transitions");
    await page.getByRole("textbox", { name: "Other answer to: How does the fee compare with the work involved?" }).fill("Worthwhile only with clear scope");
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await page.getByRole("textbox", { name: "Other answer to: What helps your team deliver this work well?" }).fill("A practical adviser on the financial records");
    await page.getByRole("textbox", { name: "Other answer to: Could the firm take on more of this work now?" }).fill("Yes, once a colleague joins");
    await page.getByRole("textbox", { name: "Other answer to: Which early signs would make this inquiry worth a closer look?" }).fill("Clients can share information for an initial conversation");
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await page.getByRole("textbox", { name: "Other answer to: What should this work help the firm become known for?" }).fill("Practical support for ownership changes");
    await page.getByRole("textbox", { name: "Other answer to: What supports this direction?" }).fill("Prior work with business owners");
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Review your direction" })).toBeVisible();
    for (const text of ["An owner plans a sale", "Before a planned sale", "Prepare the company for a smooth handover", "The team values complex ownership transitions", "Practical support for ownership changes"]) {
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    }
    const verbatimFailures = await page.locator('[data-ui-copy-exception="Verbatim user answer with variable line breaks"]').evaluateAll(elements => elements.flatMap(element => {
      const copy = element as HTMLElement;
      const box = copy.closest<HTMLElement>('[data-ui-component-content]');
      if (!box) return ["Missing content box"];
      const rect = copy.getBoundingClientRect();
      const bounds = box.getBoundingClientRect();
      const css = getComputedStyle(box);
      const left = bounds.left + parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth);
      const right = bounds.right - parseFloat(css.paddingRight) - parseFloat(css.borderRightWidth);
      return Math.abs(rect.left - left) > 2 || Math.abs(rect.right - right) > 2 || copy.scrollWidth > copy.clientWidth + 1 ? [copy.textContent || "Overflow"] : [];
    }));
    expect(verbatimFailures).toEqual([]);
    await layout(page);
    await capture(page, "write-in-" + width + "-review");
    await expect(page.getByRole("button", { name: "Create my profile", exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my answers without AI", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/discovery-answers.*\.md$/);
    await layout(page);
    await capture(page, "write-in-" + width + "-brief");
    await page.reload();
    await expect(page.getByRole("button", { name: "Continue my saved draft" })).toBeVisible();
    await page.getByRole("button", { name: "Continue my saved draft" }).click();
    await expect(page.getByRole("button", { name: "Create my profile", exact: true })).toBeVisible();
  });
}
