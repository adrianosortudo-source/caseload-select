import { defineConfig } from "@playwright/test";

const fixtureUrl = "http://127.0.0.1:3107/test-screen/secure-import";

export default defineConfig({
  testDir: "./tests/secure-import",
  outputDir: "test-results/secure-import",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "line",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: fixtureUrl,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3107",
    url: fixtureUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
