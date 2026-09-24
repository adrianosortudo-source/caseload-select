import { existsSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { defineConfig } from "@playwright/test";
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(name + " is required for rendered prospect enrichment tests.");
  return value;
}
function localUrl(name: string, raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" || !["127.0.0.1", "::1"].includes(url.hostname.replace(/^\[|\]$/g, "")) || !url.port) {
    throw new Error(name + " must use an explicit HTTP loopback host and port.");
  }
  return url.origin;
}
const supabaseUrl = localUrl("PROSPECT_ENRICHMENT_TEST_SUPABASE_URL", required("PROSPECT_ENRICHMENT_TEST_SUPABASE_URL"));
const database = new URL(required("PROSPECT_ENRICHMENT_TEST_DATABASE_URL").trim().replace(/^["']|["']$/g, ""));
if (!["postgres:", "postgresql:"].includes(database.protocol) ||
    !["127.0.0.1", "::1"].includes(database.hostname.replace(/^\[|\]$/g, "")) ||
    !database.port || database.pathname !== "/postgres") {
  throw new Error("Rendered prospect enrichment tests require direct loopback Postgres for a disposable database.");
}
const portalSecret = required("PROSPECT_ENRICHMENT_TEST_PORTAL_SECRET");
const agentToken = required("PROSPECT_ENRICHMENT_TEST_AGENT_TOKEN");
if (!portalSecret.toLowerCase().includes("test") || !agentToken.toLowerCase().includes("test")) {
  throw new Error("Rendered tests require dedicated test-only operator and agent credentials.");
}
const serviceRoleKey = required("PROSPECT_ENRICHMENT_TEST_SUPABASE_SERVICE_ROLE_KEY");
const renderedManifest = required("PROSPECT_ENRICHMENT_RENDERED_MANIFEST");
if (!existsSync(renderedManifest)) throw new Error("The synthetic rendered-test manifest does not exist. Run the local rendered-fixture seed command first.");
const comparisonSigningKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
export default defineConfig({
  testDir: "./tests/prospect-enrichment",
  outputDir: "test-results/prospect-enrichment",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "github" : "line",
  use: { baseURL: "http://127.0.0.1:3100", browserName: "chromium", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...process.env,
      PROSPECT_QUALIFICATION_PREVIEW: "1",
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      PORTAL_SECRET: portalSecret,
      PROSPECT_ENRICHMENT_AGENT_TOKEN: agentToken,
      GTA_PROSPECT_AGENT_DRAFT_TOKEN: agentToken,
      PROSPECT_ENRICHMENT_RENDERED_MANIFEST: renderedManifest,
      PROSPECT_ENRICHMENT_COMPARISON_SIGNING_KEY_ID: "local-rendered-test",
      PROSPECT_ENRICHMENT_COMPARISON_SIGNING_PRIVATE_KEY_PEM: comparisonSigningKey,
    },
  },
});
