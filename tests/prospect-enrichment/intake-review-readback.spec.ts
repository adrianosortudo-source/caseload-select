import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { prospectEnrichmentIdempotencyKey } from "../../src/lib/prospect-enrichment-hash";
import { localOrigin, renderedManifest, useSyntheticOperator, waitForResearch } from "./browser-support";

test("synthetic intake, explicit operator review, apply and real read-back", async ({ page, context }) => {
  const fixture = renderedManifest();
  const token = process.env.PROSPECT_ENRICHMENT_AGENT_TOKEN;
  if (!token?.toLowerCase().includes("test")) throw new Error("Use a dedicated test-only PROSPECT_ENRICHMENT_AGENT_TOKEN for the disposable local stack.");
  const raw = readFileSync(fixture.stageEnvelopePath, "utf8");
  const envelope = JSON.parse(raw);
  if (!raw.includes("enrichment-fixture-") || envelope.schemaVersion !== "prospect-enrichment/v1") throw new Error("Stage envelope must be a synthetic prospect-enrichment/v1 fixture.");
  const response = await context.request.post(localOrigin + "/api/internal/prospect-enrichment/drafts", {
    headers: { authorization: "Bearer " + token, "content-type": "application/json", "idempotency-key": prospectEnrichmentIdempotencyKey(envelope.sourceSystem, envelope.runId, envelope.packageId) }, data: raw,
  });
  expect(response.ok()).toBe(true);
  const receipt = await response.json();
  const packageId = receipt.packageId ?? receipt.package?.packageId;
  expect(packageId).toMatch(/^[0-9a-f-]{36}$/i);
  await useSyntheticOperator(context, fixture);
  await page.goto(localOrigin + "/admin/prospects/research-packages/" + packageId);
  await waitForResearch(page);
  await page.getByLabel("Use verified existing firm", { exact: false }).check();
  for (;;) {
    for (const item of await page.locator('[data-ui-component-content="research-review-item"]').all()) {
      const select = item.getByLabel("Intended disposition");
      const allowed = await select.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
      const disposition = allowed.includes("accept_new") ? "accept_new" : allowed.includes("link_existing") ? "link_existing" : "retain_only";
      await select.selectOption(disposition);
      if (disposition === "retain_only") await item.getByLabel("Reason for retaining this item").fill("Synthetic evidence retained with explicit source gap.");
      await expect(item.getByLabel("Use this observation in the current profile")).not.toBeChecked();
    }
    const next = page.getByRole("button", { name: "Next 25 items", exact: true }); if (await next.isDisabled()) break; await next.click();
  }
  await page.getByRole("button", { name: "Prepare exact review", exact: true }).click();
  const apply = page.getByRole("button", { name: "Apply reviewed evidence", exact: true });
  await expect(apply).toBeDisabled();
  await page.getByLabel("I reviewed this exact package and the changes shown below.").check();
  await expect(apply).toBeEnabled();
  const verifyResponse = page.waitForResponse((candidate) => candidate.url().endsWith("/packages/" + packageId + "/verify") && candidate.request().method() === "POST");
  await apply.click();
  const verified = await verifyResponse;
  expect(verified.ok()).toBe(true);
  expect((await verified.json()).verified).toBe(true);
  await page.reload(); await waitForResearch(page);
  await expect(page.getByRole("button", { name: "Apply reviewed evidence", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Open firm research", exact: true }).click();
  await expect(page.getByTestId("prospect-research-detail")).toBeVisible();
  await waitForResearch(page);
  await expect(page.getByRole("heading", { name: "Sources and evidence", exact: true })).toBeVisible();
  await expect(page.getByTestId("prospect-research-detail").getByRole("alert")).toHaveCount(0);
});
