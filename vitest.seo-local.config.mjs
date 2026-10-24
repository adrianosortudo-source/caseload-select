import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  css: { postcss: { plugins: [] } },
  test: { environment: "node", include: ["src/app/api/tools/seo-check/__tests__/**/*.test.ts", "src/app/admin/prospecting-diagnostic/_lib/__tests__/compare.test.ts"], setupFiles: ["./tests/vitest.server-only.setup.ts"], globals: true },
  resolve: { alias: { "@": path.resolve("./src") } },
});
