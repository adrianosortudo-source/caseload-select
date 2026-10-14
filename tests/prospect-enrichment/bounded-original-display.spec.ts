import { expect, test } from "@playwright/test";
import { candidateDetail, candidateHistory, candidateSummaries } from "./candidate-fixtures";
import { renderedCopyFailures } from "./browser-support";
import { createProspectEnrichmentFixtures } from "../../src/lib/__fixtures__/prospect-enrichment-v1";
import { encodeOriginalJsonNodes } from "../../src/lib/prospect-enrichment-original-nodes";
import { encodeBoundedProspectEnvelope } from "../../src/lib/prospect-enrichment-original-content";
import { prospectEnrichmentProtocolHash as hash } from "../../src/lib/prospect-enrichment-hash";
import type { JsonValue } from "../../src/lib/prospect-enrichment-contract";

function fixture(tampered = false) {
  const base = structuredClone(createProspectEnrichmentFixtures()[0].envelope);
  const original: Record<string, JsonValue> = { answer: "Preserved synthetic questionnaire answer.", unknown: null, permission: false, empty: [],
    "escaped/key~": "Exact pointer value", smallNumber: 1e-7, longFinding: "Synthetic source evidence 🧭 ".repeat(3000) };
  let nested = original;
  for (let i = 0; i < 16; i++) { nested.receipt = {}; nested = nested.receipt as Record<string, JsonValue>; }
  nested.finding = "Deep source answer remains available.";
  const envelope = encodeBoundedProspectEnvelope({ ...base, originalResearch: { ...base.originalResearch, content: original, contentSha256: hash(original) } });
  const baseline = candidateHistory(candidateSummaries[0].id);
  const history = { ...baseline, items: [{ ...baseline.items[0], packageId: "84000000-0000-4000-8000-000000000001", originalJson: envelope as unknown as typeof baseline.items[number]["originalJson"],
    originalJsonSha256: tampered ? "0".repeat(64) : hash(envelope), payloadSha256: hash(envelope) }] };
  return { envelope, history };
}

test("reconstructs verified original evidence at six widths and preserves exact transport inspection", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const { history, envelope } = fixture();
  await page.route("**/api/admin/prospect-enrichment/candidates/**", route => route.fulfill({ json: route.request().url().includes("/history") ? history : candidateDetail(candidateSummaries[0].id) }));
  for (const width of [1440, 1024, 768, 640, 375, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/dev/prospect-candidate-preview?candidateId=" + candidateSummaries[0].id);
    const revision = page.getByTestId("candidate-revision");
    await revision.getByText("Evidence, exact fields and original revision", { exact: true }).click();
    await revision.getByText("Complete original JSON", { exact: true }).click();
    await expect(revision.getByText("Evidence hashes match.", { exact: true })).toBeVisible();
    const reconstructed = revision.getByRole("region", { name: "Verified original research" });
    const answer = reconstructed.getByText("Preserved synthetic questionnaire answer.", { exact: true });
    await answer.scrollIntoViewIfNeeded();
    await expect(answer).toBeInViewport();
    for (const preserved of [reconstructed.getByText("False", { exact: true }).first(), reconstructed.getByText("Not recorded (null)", { exact: true }).first()]) {
      await preserved.scrollIntoViewIfNeeded();
      await expect(preserved).toBeInViewport();
    }
    await answer.scrollIntoViewIfNeeded();
    await expect(answer).toBeInViewport();
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    expect(await renderedCopyFailures(page), width + "px").toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(width + "-reconstructed-evidence.png"), fullPage: true });
    const raw = revision.getByText("Saved transport JSON", { exact: true });
    await raw.focus(); await page.keyboard.press("Enter");
    const saved = revision.locator('pre').filter({ hasText: 'prospect-original-nodes/v1' });
    await expect(saved).toBeVisible();
    expect(JSON.parse(await saved.innerText())).toEqual(envelope);
    await raw.focus(); await page.keyboard.press("Enter");
    await expect(saved).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("does not show reconstructed evidence when retained envelope verification fails", async ({ page }) => {
  const { history } = fixture(true);
  await page.route("**/api/admin/prospect-enrichment/candidates/**", route => route.fulfill({ json: route.request().url().includes("/history") ? history : candidateDetail(candidateSummaries[0].id) }));
  await page.goto("/dev/prospect-candidate-preview?candidateId=" + candidateSummaries[0].id);
  const revision = page.getByTestId("candidate-revision");
  await revision.getByText("Evidence, exact fields and original revision", { exact: true }).click();
  await revision.getByText("Complete original JSON", { exact: true }).click();
  await expect(revision.getByRole("alert").filter({ hasText: "Verification failed." })).toBeVisible();
  await expect(revision.getByText("Preserved synthetic questionnaire answer.", { exact: true })).toHaveCount(0);
  await expect(revision.getByText("Evidence hashes match.", { exact: true })).toHaveCount(0);
});


test("preserves ordinary v1 node-shaped data and records the existing JSON view", async ({ page }, testInfo) => {
  const base = structuredClone(createProspectEnrichmentFixtures()[0].envelope);
  const ordinary = encodeOriginalJsonNodes({ answer: "Ordinary v1 source object.", unknown: null });
  const baseline = candidateHistory(candidateSummaries[0].id);
  const envelope = { ...base, originalResearch: { ...base.originalResearch, content: ordinary, contentSha256: hash(ordinary) } };
  const history = { ...baseline, items: [{ ...baseline.items[0], packageId: "84000000-0000-4000-8000-000000000001",
    originalJson: envelope as unknown as typeof baseline.items[number]["originalJson"], originalJsonSha256: hash(envelope) }] };
  await page.route("**/api/admin/prospect-enrichment/candidates/**", route => route.fulfill({ json: route.request().url().includes("/history") ? history : candidateDetail(candidateSummaries[0].id) }));
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/dev/prospect-candidate-preview?candidateId=" + candidateSummaries[0].id);
    const revision = page.getByTestId("candidate-revision");
    await revision.getByText("Evidence, exact fields and original revision", { exact: true }).click();
    await revision.getByText("Complete original JSON", { exact: true }).click();
    await expect(revision.getByText("prospect-original-nodes/v1", { exact: true })).toBeVisible();
    await expect(revision.getByText("Evidence hashes match.", { exact: true })).toHaveCount(0);
    await revision.getByText("Complete original JSON", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(width + "-existing-v1-json-view.png") });
  }
});
