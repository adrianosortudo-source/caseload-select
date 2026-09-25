import { expect, test } from "@playwright/test";
import { capture, layout } from "./helpers";

for (const width of [320, 768]) {
  test("custom-only answers complete the guided flow at " + width + "px", async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/tools/desired-client-matter");
    await page.getByRole("button", { name: "Begin without AI" }).click();
    await page.getByLabel("Business & commercial", { exact: true }).check();
    await page.getByLabel("Buying or selling a business", { exact: true }).check();
    await page.getByLabel("We already do it and want more", { exact: true }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await page.getByRole("textbox", { name: "Other answer to: When does this client usually seek help?" }).fill("Before an owner plans a sale");
    await page.getByLabel("Business or organization", { exact: true }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await page.getByRole("textbox", { name: "Other answer to: What does the client most want to achieve?" }).fill("Prepare the company for a smooth handover");
    await page.getByRole("textbox", { name: "Other answer to: What concern have you heard from these clients?" }).fill("Keeping key staff informed");
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await page.getByRole("textbox", { name: "Other answer to: What makes this work worth pursuing?" }).fill("The team values complex ownership transitions");
    await page.getByRole("textbox", { name: "Other answer to: How does the fee compare with the work involved?" }).fill("Worthwhile only with clear scope");
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await page.getByRole("textbox", { name: "Other answer to: What helps your team deliver this work well?" }).fill("A practical adviser on the financial records");
    await page.getByRole("textbox", { name: "Other answer to: Could the firm take on more of this work now?" }).fill("Yes, once a colleague joins");
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await page.getByRole("textbox", { name: "Other answer to: What should this work help the firm become known for?" }).fill("Practical support for ownership changes");
    await page.getByRole("textbox", { name: "Other answer to: What supports this direction?" }).fill("Prior work with business owners");
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Does this describe the work you want more of?" })).toBeVisible();
    for (const text of ["Before an owner plans a sale", "Prepare the company for a smooth handover", "The team values complex ownership transitions", "Practical support for ownership changes"]) {
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
    await page.getByRole("button", { name: "Create my brief", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your Desired Client Brief" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your own answers" })).toBeVisible();
    await expect(page.getByText("Prepare the company for a smooth handover", { exact: true }).first()).toBeVisible();
    await layout(page);
    await capture(page, "write-in-" + width + "-brief");
    await page.reload();
    await expect(page.getByRole("button", { name: "Resume without AI" })).toBeVisible();
    await page.getByRole("button", { name: "Resume without AI" }).click();
    await expect(page.getByRole("heading", { name: "Your own answers" })).toBeVisible();
  });
}
