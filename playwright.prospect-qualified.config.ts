import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/prospect-qualified",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3113",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3113",
    env: { ...process.env, PROSPECT_QUALIFICATION_PREVIEW: "1" },
    url: "http://127.0.0.1:3113/dev/prospect-qualified-preview",
    reuseExistingServer: false,
    timeout: 300_000,
  },
  outputDir: "test-results/prospect-qualified",
});
