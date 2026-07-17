// Phase 0 spike verification script. Not part of the shipped tool.
// Proves the renderer actually works locally before any scoring logic is
// built on top of it: launches Chromium, renders a real domain at both
// viewports, captures a screenshot + DOM snapshot + web-vitals sample,
// and proves the SSRF guard blocks a request it should block.
//
// Run with: node --experimental-strip-types scripts/spike-render-check.mjs <domain>
// (uses tsx if available, otherwise expects a transpiled build)

import { renderUrl } from "../src/lib/design-check/renderer.ts";
import { checkOutboundRequest } from "../src/lib/design-check/ssrf-guard.ts";
import { writeFileSync } from "node:fs";

const domain = process.argv[2] || "sakurabalaw.com";
const url = `https://${domain}`;

console.log(`=== SSRF guard smoke test (before any real render) ===`);
const localhostCheck = await checkOutboundRequest("http://localhost:3000/");
console.log("localhost:", localhostCheck);
const metadataCheck = await checkOutboundRequest("http://169.254.169.254/latest/meta-data/");
console.log("cloud metadata endpoint:", metadataCheck);
const publicCheck = await checkOutboundRequest("https://example.com/");
console.log("example.com (should be allowed):", publicCheck);

if (!localhostCheck.blocked || !metadataCheck.blocked || publicCheck.blocked) {
  console.error("SSRF guard smoke test FAILED. Stopping before rendering anything.");
  process.exit(1);
}
console.log("SSRF guard smoke test passed.\n");

console.log(`=== Rendering ${url} ===`);
const t0 = Date.now();
const result = await renderUrl(url);
console.log(`Total render time: ${Date.now() - t0}ms (renderUrl-reported: ${result.totalMs}ms)`);

for (const capture of result.captures) {
  console.log(`\n--- ${capture.viewport} (${capture.finalUrl}) ---`);
  console.log("renderMs:", capture.renderMs);
  console.log("h1Count:", capture.domSnapshot.h1Count, "h1Text:", capture.domSnapshot.h1Text);
  console.log("headingOrder:", capture.domSnapshot.headingOrder.join(","));
  console.log("hasHorizontalOverflow:", capture.domSnapshot.hasHorizontalOverflow);
  console.log("viewportMetaContent:", capture.domSnapshot.viewportMetaContent);
  console.log("bodyTextSample count:", capture.domSnapshot.bodyTextSample.length);
  console.log("webVitals:", capture.webVitals);
  console.log("blockedRequests:", capture.blockedRequests.length, capture.blockedRequests.slice(0, 5));
  console.log("screenshot bytes:", capture.screenshotPng.length);

  const outPath = `scratchpad-${capture.viewport}.png`;
  writeFileSync(outPath, capture.screenshotPng);
  console.log("screenshot written to", outPath);
}

console.log("\n=== Phase 0 spike: PASS ===");
