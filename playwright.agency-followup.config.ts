import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/agency-followup-rendered",
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:4178", browserName: "chromium", headless: true },
  reporter: "list",
  outputDir: "test-results/agency-followup-rendered",
  webServer: {
    command: `node "${process.cwd()}\\node_modules\\.pnpm\\vite@5.4.21_@types+node@22.20.5\\node_modules\\vite\\bin\\vite.js" --config scripts/agency-followup-rendered/vite.config.mjs`,
    url: "http://127.0.0.1:4178",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
