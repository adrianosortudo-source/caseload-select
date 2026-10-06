import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { completeAnswers, validBlueprint } from "../../src/lib/desired-client/__tests__/blueprint-helpers";
import { validateAnalysisResult } from "../../src/lib/desired-client/output";
import { REPORT_EDIT_LINKS } from "../../src/lib/desired-client/blueprint";
import { REPORT_FOOTNOTE_COPY } from "../../src/lib/desired-client/copy";
import { STAGE_DEFINITIONS } from "../../src/lib/desired-client/screens";

const route = "**/api/tools/desired-client-matter/analyze";
const storageKey = "cls-desired-client-v2";
const answers = completeAnswers();
Object.assign(answers.value, {
  fee_amount: "8000",
  direct_cost_amount: "8500",
  currency: "CAD",
  amount_basis: "recorded",
  amount_scope: "per_matter",
  collected_fee: "15to50",
  team_hours: "16to40",
  payment: "predictable",
  payment_context: "Clients told the firm that the first invoice was usually paid on schedule.",
  payment_context_basis: "client_feedback",
});
answers.delivery.capacity = "room";
Object.assign(answers.repeatability, {
  success_measure: "retained_matters",
  target: "2 additional retained matters per quarter",
  review_period: "6 months",
  additional_matters: "2 comparable matters per quarter",
  staffing_constraint: "An associate must be hired before increasing volume.",
});
const result = validateAnalysisResult(validBlueprint(answers), answers, [])!;
if (!result) throw new Error("The fictional export fixture must satisfy the current report contract before browser assertions run.");

test("a reviewed six-section draft becomes a synthesized blueprint and HTML report", async ({ page }, testInfo) => {
  let analysisCalls = 0;
  await page.addInitScript(({ key, savedAnswers }) => {
    const now = Date.now();
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 2,
      answers: savedAnswers,
      currentStage: 7,
      lastEditedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 7 * 86400000).toISOString(),
    }));
  }, { key: storageKey, savedAnswers: answers });

  await page.route(route, async requestRoute => {
    if (requestRoute.request().method() === "GET") {
      await requestRoute.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true }) });
      return;
    }
    analysisCalls += 1;
    const request = requestRoute.request().postDataJSON();
    await requestRoute.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        requestId: request.requestId,
        answerRevision: request.answerRevision,
        reviewRunId: request.reviewRunId,
        result,
      }),
    });
  });

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/tools/desired-client-matter");
  await page.getByRole("button", { name: "Continue my saved draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your direction", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create my Desired Client Blueprint", exact: true }).click();

  const blueprintTitle = page.getByRole("heading", { level: 1 });
  await expect(blueprintTitle).toBeVisible();
  await expect(blueprintTitle).toContainText("Business & commercial");
  await expect(page.getByText(result.brief.definition_sentence, { exact: true })).toBeVisible();
  await expect(page.getByText("Client definition", { exact: true })).toBeVisible();
  await expect(page.getByText("Client decision pathway", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Progress review", exact: true })).toBeVisible();
  await expect(page.getByText("6 months", { exact: true })).toBeVisible();
  await expect(page.getByText("Before increasing volume, the firm identified this prerequisite: An associate must be hired before increasing volume.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download HTML report", exact: true })).toBeVisible();
  expect(analysisCalls).toBe(1);

  const downloadReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download HTML report", exact: true }).click();
  const download = await downloadReady;
  expect(download.suggestedFilename()).toMatch(/\.html$/);
  const path = await download.path();
  await download.saveAs(testInfo.outputPath("blueprint-negative-report.html"));
  const html = await import("node:fs/promises").then(fs => fs.readFile(path!, "utf8"));
  const printPage = await page.context().newPage();
  await printPage.goto(pathToFileURL(path!).href);
  await printPage.emulateMedia({ media: "print" });
  const printPdf = await printPage.pdf({
    path: testInfo.outputPath("blueprint-negative-report-print-preview.pdf"),
    printBackground: true,
  });
  expect(printPdf.byteLength).toBeGreaterThan(0);
  await printPage.close();
  expect(html).toContain("Desired Client Blueprint");
  expect(html).toContain(REPORT_FOOTNOTE_COPY);
  const progressReview = html.match(/<section class="progress"><h2>Progress review<\/h2>[\s\S]*?<\/section>/)?.[0];
  expect(progressReview).toBeDefined();
  expect(progressReview).toContain("<dt>Target</dt><dd>2 additional retained matters per quarter</dd>");
  expect(progressReview).toContain("<dt>Review period</dt><dd>6 months</dd>");
  const conditions = html.match(/<section class="conditions">[\s\S]*?<\/section>/)?.[0];
  expect(conditions).toBeDefined();
  expect(conditions).toContain("<li>Before increasing volume, the firm identified this prerequisite: An associate must be hired before increasing volume.</li>");
  const valueCard = html.match(/<section class="card"><h2>Why this work<\/h2>[\s\S]*?<\/section>/)?.[0];
  expect(valueCard).toBeDefined();
  expect(valueCard).toContain("8000");
  expect(valueCard).toContain("8500");
  expect(valueCard).toContain("C$15,000 to under C$50,000");
  expect(valueCard).toContain("More than 15, up to 40 hours");
  expect(valueCard).toContain("Firm-reported records");
  expect(valueCard).toContain("Client-reported information");
  expect(valueCard).toContain("−C$500.00");
  expect(valueCard).toContain("−6.25%");
  expect(valueCard).toContain("Clients told the firm that the first invoice was usually paid on schedule.");
  expect(valueCard).toContain("2 comparable matters per quarter");
  expect(valueCard).toContain("An associate must be hired before increasing volume.");
  expect(valueCard).toContain("before overhead and acquisition costs");
  expect(valueCard).toContain("This is not net profit");
  const exportedDefinition = html.match(/<section class="definition"><h2>Client definition<\/h2><p>([\s\S]*?)<\/p><\/section>/)?.[1];
  expect(exportedDefinition).toBeDefined();
  const plainDefinition = exportedDefinition!
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  expect(plainDefinition).toBe(result.brief.definition_sentence);

  for (const width of [1440, 1024, 768, 640, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.evaluate(() => {
      const failures: string[] = [];
      for (const element of Array.from(document.querySelectorAll<HTMLElement>(".dc-brief :is(h1,h2,h3,h4,p,li)"))) {
        if (element.dataset.uiCopyException || !element.getClientRects().length || element.closest("details:not([open])")) continue;
        if (element.scrollWidth > element.clientWidth + 1) failures.push(`overflow: ${element.textContent?.trim() ?? "unknown copy"}`);
        const lines: Array<{ top: number; wordCount: number }> = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            const rect = range.getBoundingClientRect();
            if (!rect.width || !rect.height) continue;
            const line = lines.find((item) => Math.abs(item.top - rect.top) < 1.5);
            if (line) line.wordCount += 1;
            else lines.push({ top: rect.top, wordCount: 1 });
          }
        }
        lines.sort((a, b) => a.top - b.top);
        if (lines.length > 1 && lines.at(-1)?.wordCount === 1) failures.push(`${element.tagName.toLocaleLowerCase()}${element.className ? `.${String(element.className).replace(/\s+/g, ".")}` : ""} (${element.clientWidth}px): ${element.textContent?.trim() ?? "unknown copy"}`);
      }
      return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, failures };
    });
    expect(layout.scrollWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);
    expect(layout.failures, `single-word final lines at ${width}px`).toEqual([]);
    if (width === 1440 || width === 375) {
      await page.screenshot({ path: testInfo.outputPath(`blueprint-report-${width}.png`), fullPage: true });
    }
  }

  const expectedEditDestinations = [
    [1, "Edit practice", "What work does the firm want to build around?"],
    [2, "Edit client and matter", "Which client situation and specific matter do you want more of?"],
    [3, "Edit value", "Why would the firm welcome this work again?"],
    [4, "Edit firm fit", "Why might this client choose your firm?"],
    [5, "Edit matter signals", "What would help you recognize this matter?"],
    [6, "Edit opportunity and progress", "Where have these clients come from, and what do you know?"],
  ] as const;
  expect(REPORT_EDIT_LINKS).toEqual(expectedEditDestinations.map(([stage, label]) => [stage, label]));
  for (const [stage, label, heading] of expectedEditDestinations) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true }), `${label} should open interview stage ${stage}`).toBeVisible();
    if (stage === 6) {
      await expect(page.getByText("How do clients find or approach the firm for this work? (optional)", { exact: true })).toBeVisible();
      await expect(page.getByText("What evidence has the firm seen for this type of work?", { exact: true })).toBeVisible();
      await expect(page.getByText("What would the firm want to review over time? (optional)", { exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: STAGE_DEFINITIONS[6].label, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review your direction", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create my Desired Client Blueprint", exact: true }).click();
    await expect(blueprintTitle).toBeVisible();
  }
});
