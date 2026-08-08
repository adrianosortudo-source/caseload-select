#!/usr/bin/env node
/**
 * Fails when services/render's copied files have drifted from their
 * main-app originals. See docs/BUILD_PLAN_render_isolation_v1.md §3.3:
 * the render service is a separate deployable with its own package.json,
 * so it cannot `import` from src/lib -- three files are instead copied
 * across the boundary, and this script is what keeps the copies honest.
 *
 * render-types.ts is byte-identical on both sides (it is pure wire-shape
 * types, nothing environment-specific). ssrf.ts is also byte-identical
 * (it does no I/O and has no server-only or path-alias dependency to
 * begin with). ssrf-fetch.ts is copied with exactly two mechanical edits:
 * the `import "server-only"` line is dropped (the service has no
 * Next.js server-component boundary for that guard to protect), and the
 * `@/lib/ssrf` path alias becomes the relative `./ssrf` (the service has
 * no bundler-level alias resolution). This script re-applies those same
 * two edits to the main-app original before comparing, so a drift check
 * failure always means a REAL, unintended divergence -- a logic change
 * landed on one side only -- never a false positive from the expected,
 * documented difference.
 *
 * Run locally after editing either side of a pair:
 *   node scripts/check-render-service-parity.mjs
 * Wired into CI as its own job (see .github/workflows/ci.yml,
 * "render-service-parity").
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

function identity(source) {
  return source;
}

function stripServerOnlyAndRelativizeSsrfImport(source) {
  // The repo's checked-in files use CRLF line endings on this Windows
  // dev environment; matching \r?\n keeps the transform correct
  // regardless of which line-ending convention either copy carries.
  return source
    .replace(/import "server-only";\r?\n/, "")
    .replace('from "@/lib/ssrf"', 'from "./ssrf"');
}

const PAIRS = [
  {
    label: "render-types.ts",
    original: "src/lib/design-check/render-types.ts",
    copy: "services/render/render-types.ts",
    transform: identity,
    note: "should be an exact copy",
  },
  {
    label: "ssrf.ts",
    original: "src/lib/ssrf.ts",
    copy: "services/render/ssrf.ts",
    transform: identity,
    note: "should be an exact copy",
  },
  {
    label: "ssrf-fetch.ts",
    original: "src/lib/ssrf-fetch.ts",
    copy: "services/render/ssrf-fetch.ts",
    transform: stripServerOnlyAndRelativizeSsrfImport,
    note: 'should match after dropping `import "server-only";` and rewriting `@/lib/ssrf` to `./ssrf`',
  },
];

let failed = false;
for (const pair of PAIRS) {
  const original = read(pair.original);
  const copy = read(pair.copy);
  const expected = pair.transform(original);
  if (expected !== copy) {
    failed = true;
    console.error(`::error::${pair.label} has drifted between ${pair.original} and ${pair.copy} (${pair.note}).`);
  }
}

if (failed) {
  console.error(
    "\nservices/render's copied files no longer match their main-app originals. Re-copy the changed file and, for ssrf-fetch.ts, re-apply the server-only-strip + @/lib/ssrf-to-./ssrf edit, then re-run this check."
  );
  process.exit(1);
}

console.log("OK: services/render's copied files match their main-app originals (render-types.ts, ssrf.ts, ssrf-fetch.ts).");
