import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/__tests__/**/*.test.ts",
      "scripts/drg-deploy/__tests__/**/*.test.ts",
      // Scoped, not "src/**/*.test.tsx" (DR-112): a repo-wide .tsx include
      // would also pick up other components' pre-existing, unrelated
      // .test.tsx files that were never part of the running suite and may
      // not be green — a blast radius this change has no business having.
      // Widen this per-directory as other component suites adopt RTL.
      "src/components/intake-v2/__tests__/**/*.test.tsx",
      "src/**/__evals__/**/*.test.ts",
    ],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
