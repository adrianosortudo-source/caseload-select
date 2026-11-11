import { defineConfig } from "@playwright/test";

const appUrl = process.env.SCREEN_ROUTING_APP_PREVIEW?.trim();
if (!appUrl) throw new Error("SCREEN_ROUTING_APP_PREVIEW is required.");
const parsed = new URL(appUrl);
if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
  throw new Error("SCREEN_ROUTING_APP_PREVIEW must be an HTTPS origin.");
}

export default defineConfig({
  testDir: "./tests/prospect-demo",
  testMatch: "screen-routing-single-page.spec.ts",
  outputDir: "test-results/screen-routing-acceptance",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "line",
  use: {
    baseURL: parsed.origin,
    browserName: "chromium",
    channel: "chrome",
    actionTimeout: 15_000,
    viewport: { width: 1280, height: 720 },
    screenshot: "only-on-failure",
    trace: "off",
  },
});
