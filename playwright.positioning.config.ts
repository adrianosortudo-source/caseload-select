import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests/positioning-check", timeout: 60000, workers: 1, use: { baseURL: process.env.POSITIONING_TEST_URL || "http://localhost:3098", screenshot: "only-on-failure", trace: "retain-on-failure" }, outputDir: "test-results/positioning-check", reporter: "line" });
