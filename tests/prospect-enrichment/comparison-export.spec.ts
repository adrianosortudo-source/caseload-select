import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { localOrigin, renderedManifest, useSyntheticOperator, waitForResearch } from "./browser-support";

test("comparison export binds the upload to the logical run key, not the Admin database UUID", async ({ page, context }) => {
  const fixture = renderedManifest();
  await useSyntheticOperator(context, fixture);
  await page.goto(localOrigin + "/admin/prospects/research-runs/" + fixture.runId);
  await waitForResearch(page);

  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/admin/prospect-enrichment/comparison-export") && response.request().method() === "POST");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#prospect-comparison-request").setInputFiles(fixture.comparisonRequestPath);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("prospect-enrichment-comparison-" + fixture.sourceRunKey + ".json");
  const snapshot = JSON.parse(readFileSync(await download.path(), "utf8")) as { signature?: { algorithm?: unknown; signatureBase64?: unknown } };
  expect(snapshot.signature).toMatchObject({ algorithm: "Ed25519" });
  expect(typeof snapshot.signature?.signatureBase64).toBe("string");

  let postedAfterMismatch = false;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/admin/prospect-enrichment/comparison-export") && request.method() === "POST") postedAfterMismatch = true;
  });
  await page.locator("#prospect-comparison-request").setInputFiles({
    name: "different-run.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: "prospect-enrichment-comparison-request/v1", manifest: { runId: "run-" + "f".repeat(32) } })),
  });
  await expect(page.getByRole("alert")).toContainText("Choose the complete comparison request for this exact run.");
  expect(postedAfterMismatch).toBe(false);
});
