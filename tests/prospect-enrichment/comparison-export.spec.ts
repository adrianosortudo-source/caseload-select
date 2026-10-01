import { readFileSync } from "node:fs";
import { prospectEnrichmentProtocolHash } from "../../src/lib/prospect-enrichment-hash";
import { gzipSync } from "node:zlib";
import { test, expect } from "@playwright/test";
import { localOrigin, renderedManifest, renderedCopyFailures, useSyntheticOperator, waitForResearch } from "./browser-support";

test("comparison export binds the upload to the logical run key, not the Admin database UUID", async ({ page, context }) => {
  const fixture = renderedManifest();
  await useSyntheticOperator(context, fixture);
  await page.goto(localOrigin + "/admin/prospects/research-runs/" + fixture.runId);
  await waitForResearch(page);

  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/admin/prospect-enrichment/comparison-export") && response.request().method() === "POST");
  await page.locator("#prospect-comparison-request").setInputFiles(fixture.comparisonRequestPath);
  const response = await responsePromise;
  const exportBody = response.status() === 200 ? null : await response.json();
  expect(response.status(), JSON.stringify(exportBody?.diagnostic ?? exportBody)).toBe(200);
  await expect(page.getByRole("link", { name: "Download signed comparison" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download signed comparison" }).click();
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
  await expect(page.locator('[aria-label="Export authenticated comparison"]').getByRole("alert")).toContainText("Choose the complete comparison request for this exact run.");
  expect(postedAfterMismatch).toBe(false);
});

test("initial comparison is available with no recorded runs and preserves gzip transport", async ({ page, context }) => {
  const fixture = renderedManifest();
  await useSyntheticOperator(context, fixture);
  await page.route("**/api/admin/prospect-enrichment/runs?*", (route) => route.fulfill({ json: { runs: [], nextCursor: null } }));
  const compressed = gzipSync(readFileSync(fixture.comparisonRequestPath));
  let wireBody: Buffer | null = null, encoding: string | undefined;
  await page.route("**/api/admin/prospect-enrichment/comparison-export/bootstrap", async (route) => {
    wireBody = route.request().postDataBuffer(); encoding = route.request().headers()["content-encoding"];
    await route.fulfill({ json: { schemaVersion: "prospect-enrichment-comparison/v1", projectId: "ssxryjxifwiivghglqer", snapshotSha256: "a".repeat(64), signature: { algorithm: "Ed25519", keyId: "rendered-test", signatureBase64: "synthetic-browser-transport-test" }, provenance: { reader: "admin-prospect-enrichment-bootstrap/v1", operatorAuthenticated: true, sourceArtifactSha256: prospectEnrichmentProtocolHash(JSON.parse(readFileSync(fixture.comparisonRequestPath, "utf8"))) }, packages: [], identities: [], events: [], capturedAt: new Date().toISOString() } });
  });
  await page.goto(localOrigin + "/admin/prospects/research");
  await waitForResearch(page);
  await expect(page.getByText("No research runs have been recorded.")).toBeVisible();
  await expect(page.locator("#prospect-comparison-mode")).toHaveValue("bootstrap");
  for (const width of [1440, 1024, 768, 640, 375, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await waitForResearch(page);
    expect((await renderedCopyFailures(page)).filter((failure) => failure.startsWith("research-comparison-export/"))).toEqual([]);
    await test.info().attach(`comparison-upload-${width}`, { body: await page.locator('[aria-label="Export authenticated comparison"]').screenshot(), contentType: "image/png" });
  }
  await page.locator("#prospect-comparison-request").setInputFiles({ name: "initial-request.json.gz", mimeType: "application/gzip", buffer: compressed });
  await expect(page.getByRole("link", { name: "Download signed comparison" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download signed comparison" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("prospect-enrichment-comparison-" + fixture.sourceRunKey + ".json");
  expect(encoding).toBe("gzip"); expect(wireBody).toEqual(compressed);
});
