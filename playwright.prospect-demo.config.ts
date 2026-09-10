import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/prospect-demo",
  outputDir: "test-results/prospect-demo",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: "http://127.0.0.1:3109",
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/prospect-demo/auth-fixture.mjs",
      url: "http://127.0.0.1:3110/ready",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3109",
      url: "http://127.0.0.1:3109/operator/login",
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        PORTAL_SECRET: "prospect-demo-rendered-test-only-not-a-production-secret",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3110",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "prospect-demo-test-anon",
        SUPABASE_SERVICE_ROLE_KEY: "prospect-demo-test-service",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
