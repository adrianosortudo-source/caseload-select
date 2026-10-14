import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/prospect-enrichment",
  testMatch: "bounded-original-display.spec.ts",
  outputDir: "test-results/prospect-original-display",
  timeout: 120_000, workers: 1, retries: 0,
  use: { baseURL: "http://127.0.0.1:3101", browserName: "chromium", channel: "chrome", screenshot: "only-on-failure" },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3101",
    url: "http://127.0.0.1:3101/dev/prospect-candidate-preview", reuseExistingServer: process.env.PROSPECT_ORIGINAL_DISPLAY_REUSE_LOCAL_SERVER === "1", timeout: 300_000,
    env: { ...process.env, PROSPECT_QUALIFICATION_PREVIEW: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55561",
      SUPABASE_SERVICE_ROLE_KEY: "test-only-disabled-for-mocked-display", PORTAL_SECRET: "test-only-bounded-original-display",
      PROSPECT_ENRICHMENT_AGENT_TOKEN: "test-only-disabled-for-mocked-display" },
  },
});
