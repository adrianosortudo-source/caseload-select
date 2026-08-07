import { defineConfig } from "vitest/config";

export default defineConfig({
  // This service has zero CSS/UI code, but Vite's config resolution
  // otherwise searches upward past services/render/ and finds the main
  // app's postcss.config.mjs (for Tailwind) at the repo root. Loading
  // that config requires "tailwindcss", which is correctly absent from
  // this service's own dependency tree. Locally this stayed hidden
  // because the repo root's node_modules (with tailwindcss installed)
  // happened to already exist; CI installs services/render in isolation
  // and surfaced it immediately (`Cannot find module 'tailwindcss'`,
  // `Failed to load PostCSS config`). test.css: false skips CSS
  // processing entirely, so this config search never runs.
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    globals: true,
    css: false,
  },
});
