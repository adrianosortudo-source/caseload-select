import { expect, test, type Page } from "@playwright/test";

const VIEWPORT_WIDTHS = [1440, 1024, 768, 640, 375, 320] as const;
const REPLY_BODY = "Thank you. A lawyer will follow up by phone shortly.";

async function waitForStableLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

for (const width of VIEWPORT_WIDTHS) {
  test(`Channel Conversation copy gates pass at ${width}px`, async ({ page }, testInfo) => {
    let interceptedBody: {
      body?: unknown;
      client_request_id?: unknown;
    } | null = null;
    await page.route("**/api/test/channel-conversation/reply", async (route) => {
      const requestBody = route.request().postDataJSON() as {
        body?: unknown;
        client_request_id?: unknown;
      };
      interceptedBody = requestBody;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: {
            id: "fixture-verified-sent-event",
            direction: "outbound",
            source: "operator",
            body: requestBody.body,
            status: "sent",
            occurredAt: "2026-09-01T14:02:00.000Z",
          },
        }),
      });
    });

    await page.setViewportSize({ width, height: 1000 });
    const response = await page.goto("/test-screen/channel-conversation", {
      waitUntil: "networkidle",
    });
    expect(response?.status()).toBe(200);
    await waitForStableLayout(page);

    await page.getByRole("textbox", { name: "Write a reply" }).fill(REPLY_BODY);
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.getByText("Reply sent.", { exact: true })).toBeVisible();
    expect(interceptedBody).toEqual({
      body: REPLY_BODY,
      client_request_id: expect.any(String),
    });
    await waitForStableLayout(page);

    await expect(page.locator("[data-ui-component-content]")).toHaveCount(3);
    await expect(page.locator("[data-ui-copy]")).toHaveCount(10);

    const audit = await page.evaluate(() => {
      const tolerance = 1;
      const fullWidthFailures: string[] = [];
      const orphanFailures: string[] = [];

      for (const copy of document.querySelectorAll<HTMLElement>("[data-ui-copy]")) {
        if (copy.getClientRects().length === 0) continue;
        if (copy.hasAttribute("data-ui-copy-exception")) continue;

        const container = copy.closest<HTMLElement>("[data-ui-component-content]");
        if (!container) {
          fullWidthFailures.push("tagged copy has no data-ui-component-content ancestor");
          continue;
        }

        const containerRect = container.getBoundingClientRect();
        const copyRect = copy.getBoundingClientRect();
        const style = getComputedStyle(container);
        const innerLeft =
          containerRect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
        const innerRight =
          containerRect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
        if (
          Math.abs(copyRect.left - innerLeft) > tolerance ||
          Math.abs(copyRect.right - innerRight) > tolerance
        ) {
          fullWidthFailures.push(
            `${container.dataset.uiComponentContent}: copy [${copyRect.left.toFixed(2)}, ${copyRect.right.toFixed(2)}] `
              + `does not match usable bounds [${innerLeft.toFixed(2)}, ${innerRight.toFixed(2)}]`,
          );
        }
      }

      for (const guard of document.querySelectorAll<HTMLElement>("[data-ui-copy]")) {
        if (guard.getClientRects().length === 0) continue;
        if (guard.hasAttribute("data-ui-copy-exception")) continue;

        const wordFragments: Array<{
          top: number;
          left: number;
          right: number;
          word: string;
          wordId: number;
        }> = [];
        const walker = document.createTreeWalker(guard, NodeFilter.SHOW_TEXT);
        let textNode = walker.nextNode();
        let wordId = 0;
        while (textNode) {
          const text = textNode.textContent ?? "";
          for (const match of text.matchAll(/\S+/g)) {
            const start = match.index ?? 0;
            const range = document.createRange();
            range.setStart(textNode, start);
            range.setEnd(textNode, start + match[0].length);
            for (const rect of Array.from(range.getClientRects())) {
              if (rect.width > 0 && rect.height > 0) {
                wordFragments.push({
                  top: rect.top,
                  left: rect.left,
                  right: rect.right,
                  word: match[0],
                  wordId,
                });
              }
            }
            wordId += 1;
          }
          textNode = walker.nextNode();
        }

        wordFragments.sort((a, b) => a.top - b.top || a.left - b.left);
        const lines: Array<{ top: number; fragments: typeof wordFragments }> = [];
        for (const fragment of wordFragments) {
          const line = lines.find(
            (candidate) => Math.abs(candidate.top - fragment.top) <= tolerance,
          );
          if (line) line.fragments.push(fragment);
          else lines.push({ top: fragment.top, fragments: [fragment] });
        }

        const finalLine = lines.at(-1);
        const finalLineWords = finalLine
          ? new Set(finalLine.fragments.map((fragment) => fragment.wordId))
          : new Set<number>();
        if (lines.length >= 2 && finalLine && finalLineWords.size === 1) {
          orphanFailures.push(
            `${guard.dataset.uiCopy}: final line contains only "${finalLine.fragments[0].word}"`,
          );
        }
      }

      return {
        fullWidthFailures,
        orphanFailures,
        documentOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        containsEmDash: document.body.innerText.includes("\u2014"),
      };
    });

    if (width === 1440 || width === 320) {
      await page.screenshot({
        path: testInfo.outputPath(`channel-conversation-${width}px.png`),
        fullPage: true,
      });
    }

    expect(audit.fullWidthFailures).toEqual([]);
    expect(audit.orphanFailures).toEqual([]);
    expect(audit.documentOverflow).toBeLessThanOrEqual(1);
    expect(audit.containsEmDash).toBe(false);
  });
}
