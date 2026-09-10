import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/voice-screen-demo",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3108",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3108",
    url: "http://127.0.0.1:3108/demo/voice-to-screen",
    reuseExistingServer: false,
    timeout: 180_000,
  },
  outputDir: "test-results/voice-screen-demo",
});
