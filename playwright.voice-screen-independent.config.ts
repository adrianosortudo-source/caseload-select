import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/voice-screen-independent",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3111",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3111",
    url: "http://127.0.0.1:3111/test/voice-screen/widget",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
  outputDir: "test-results/voice-screen-independent",
});
