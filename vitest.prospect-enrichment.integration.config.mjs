import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const root = path.dirname(fileURLToPath(import.meta.url));
const raw = process.env.DIRECT_DATABASE_URL ?? process.env.PROSPECT_ENRICHMENT_TEST_DATABASE_URL;
if (!raw) throw new Error("Prospect enrichment integration checks require a disposable loopback Postgres URL.");
const database = new URL(raw.trim().replace(/^["']|["']$/g, ""));
if (!["postgres:", "postgresql:"].includes(database.protocol) ||
    !["127.0.0.1", "::1"].includes(database.hostname.replace(/^\[|\]$/g, "")) ||
    !database.port || database.pathname !== "/postgres") {
  throw new Error("Prospect enrichment integration checks accept only direct loopback Postgres for a disposable database.");
}
export default defineConfig({
  root,
  test: {
    environment: "node",
    include: ["src/lib/__tests__/prospect-enrichment.integration.test.ts", "src/lib/__tests__/prospect-candidate*.integration.test.ts"],
    setupFiles: ["./tests/vitest.server-only.setup.ts"],
    pool: "threads",
    maxWorkers: 1,
    minWorkers: 1,
  },
  resolve: { alias: { "@": path.resolve(root, "src") } },
});