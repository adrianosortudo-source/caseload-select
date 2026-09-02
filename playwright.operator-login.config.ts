import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/operator-login",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3107",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3107",
    url: "http://127.0.0.1:3107/operator/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  outputDir: "test-results/operator-login",
});
