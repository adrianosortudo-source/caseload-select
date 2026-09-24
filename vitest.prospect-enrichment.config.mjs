import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  test: {
    environment: "node",
    include: [
      "src/lib/__tests__/prospect-enrichment-*.test.ts",
      "src/lib/__tests__/prospect-candidate*.migration-contract.test.ts",
      "src/app/api/internal/prospect-enrichment/**/*.test.ts",
      "src/app/api/admin/prospect-enrichment/**/*.test.ts",
      "src/app/admin/prospects/__tests__/new-firm-evidence-review.test.ts",
      "src/app/admin/prospects/reconciled/__tests__/route.test.ts",
      "scripts/prospect-enrichment/__tests__/client-lineage.test.ts",
    ],
    exclude: ["src/lib/__tests__/prospect-enrichment.integration.test.ts"],
    setupFiles: ["./tests/vitest.server-only.setup.ts"],
    pool: "threads",
    maxWorkers: 1,
    minWorkers: 1,
  },
  resolve: { alias: { "@": path.resolve(root, "src") } },
});