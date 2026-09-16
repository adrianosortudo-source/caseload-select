import { defineConfig } from "@playwright/test";

const rawBaseUrl = process.env.PREVIEW_QA_BASE_URL?.trim();
if (!rawBaseUrl) {
  throw new Error("PREVIEW_QA_BASE_URL is required for the preview QA audit.");
}

const baseUrl = new URL(rawBaseUrl);
if (
  baseUrl.protocol !== "https:" ||
  baseUrl.username ||
  baseUrl.password ||
  baseUrl.search ||
  baseUrl.hash
) {
  throw new Error(
    "PREVIEW_QA_BASE_URL must be an https origin without credentials, query, or hash.",
  );
}

export default defineConfig({
  testDir: "./tests/preview-qa",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI
    ? [
        ["line"],
        ["json", { outputFile: "test-results/preview-qa/results.json" }],
      ]
    : "line",
  use: {
    baseURL: baseUrl.origin,
    ignoreHTTPSErrors: false,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  outputDir: "test-results/preview-qa",
});
