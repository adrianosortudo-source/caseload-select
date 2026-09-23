import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/prospect-enrichment/__tests__/client-lineage.test.ts"],
    setupFiles: ["./tests/vitest.server-only.setup.ts"],
  },
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") } },
});
