import { expect, test } from "@playwright/test";

for (const submit of ["Reply", "Enter"] as const) {
  test(`Kadish keeps a typed Something else answer when submitted with ${submit}`, async ({ page }, testInfo) => {
    const reply = "It is a long-term disability plan through my employer.";
    const mappedReplies: string[] = [];
    await page.route("**/api/extract", async route => {
      const body = route.request().postDataJSON() as { pending_slot_id?: string; reply?: string };
      if (body.pending_slot_id) {
        expect(body.pending_slot_id).toBe("disability_benefit");
        mappedReplies.push(body.reply ?? "");
        await route.fulfill({ json: { mode: "live", extracted: {}, mapping_mode: "live", mapped_answer: { slotId: "disability_benefit", value: "Long-term disability insurance" } } });
      } else {
        await route.fulfill({ json: { mode: "live", extracted: {} } });
      }
    });
    await page.goto("/tools/screen/kadish-dsouza");
    const widget = page.frameLocator('iframe[title="Kadish disability-benefit SCREEN demonstration"]');
    await widget.getByRole("textbox", { name: "Tell us how a lawyer can help you today.", exact: true }).fill("My disability payments have stopped.");
    await widget.getByRole("button", { name: "Continue matter review", exact: true }).click();
    await expect(widget.getByRole("heading", { name: "Which benefit is your enquiry about?", exact: true })).toBeVisible();
    const typed = widget.getByRole("textbox", { name: "Something else", exact: true });
    for (const width of [1440, 1024, 768, 640, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(typed).toBeVisible();
      await expect(widget.getByRole("button", { name: "Reply", exact: true })).toBeVisible();
      expect(await widget.locator(".q-typed-answer").evaluate(root => {
        const label = root.querySelector("label")!;
        return Math.abs(label.getBoundingClientRect().width - root.getBoundingClientRect().width) <= 1;
      })).toBe(true);
      await expect.poll(() => widget.locator("html").evaluate(root => root.scrollWidth <= root.clientWidth + 1)).toBe(true);
      expect(await page.locator("html").evaluate(root => root.scrollWidth <= root.clientWidth + 1)).toBe(true);
      if (submit === "Reply" && [1440, 375, 320].includes(width)) await page.screenshot({ path: testInfo.outputPath(`kadish-something-else-${width}.png`), fullPage: true });
    }
    await typed.fill(reply);
    if (submit === "Reply") await widget.getByRole("button", { name: "Reply", exact: true }).click();
    else await typed.press("Enter");
    await expect(widget.getByRole("textbox", { name: "Type your answer…", exact: true })).toBeVisible();
    expect(mappedReplies).toEqual([reply]);
    await widget.getByRole("textbox", { name: "Type your answer…", exact: true }).fill("The fictional letter is dated October 30, 2026.");
    await widget.getByRole("button", { name: "Save", exact: true }).click();
    await widget.getByRole("button", { name: "Yes", exact: true }).click();
    await widget.getByRole("button", { name: "Ontario", exact: true }).click();
    await widget.getByRole("button", { name: "No", exact: true }).click();
    await widget.getByRole("button", { name: "This week", exact: true }).click();
    await expect(widget.getByText(`Your enquiry concerns ${reply}`, { exact: false })).toBeVisible();
    await expect(widget.getByRole("button", { name: "Yes, share my contact details", exact: true })).toBeVisible();
  });
}
