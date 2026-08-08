import { defineConfig } from "vitest/config";

export default defineConfig({
  // This service has zero CSS/UI code, but Vite's own resolveConfig()
  // unconditionally calls postcss-load-config as part of its CSS plugin
  // setup -- regardless of test.css settings -- which walks up parent
  // directories from services/render/ and finds the main app's
  // postcss.config.mjs (for Tailwind) at the repo root. Loading that
  // config requires "tailwindcss", which is correctly absent from this
  // service's own dependency tree.
  //
  // test.css: false was tried first and does NOT fix this: it only
  // controls whether CSS *files imported by test code* get transformed,
  // not whether Vite's config-resolution phase searches the filesystem
  // for a PostCSS config at all -- that search happens earlier and
  // unconditionally. The actual fix is providing an inline `css.postcss`
  // object: once Vite has an inline config, postcss-load-config's
  // filesystem search is never invoked in the first place.
  //
  // This stayed hidden in earlier local testing because the repo root's
  // node_modules (with tailwindcss installed) happened to already exist
  // on the dev machine; CI installs services/render in isolation via its
  // own `npm ci` step and surfaced it immediately (`Cannot find module
  // 'tailwindcss'`, `Failed to load PostCSS config`). Re-verified locally
  // by temporarily hiding node_modules/tailwindcss at the repo root
  // *without* restoring it before re-running tests -- confirmed this
  // fix passes under that exact condition, not just under normal ones.
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    globals: true,
    css: false,
  },
});
