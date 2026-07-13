/**
 * Trust-fix pass WI-6: unsupported categorical AI claims ("AI models prefer",
 * "AI systems weight", "AI models look for") must never appear in the
 * generated check items or issues-list copy. These claims are too categorical
 * for what a crawler-based check can actually prove; the checks are useful
 * heuristics, not evidence of citation outcomes.
 *
 * Reads the SOURCE FILES directly (not a scan fixture) so this stays a live
 * sweep rather than a snapshot: a future edit that reintroduces one of these
 * phrases fails this test immediately, without needing a fresh scan.
 *
 * See docs/SEO-TOOL-TRUST-FIX-PASS-v1.md.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SOURCE_FILES = [
  "../route.ts",
  "../analysis.ts",
  "../audit-notes.ts",
  "../engine-core.ts",
  "../rendering-analysis.ts",
  "../intent-analysis.ts",
  "../report-pdf.tsx",
];

const BANNED_PHRASES = [/AI models prefer/i, /AI systems weight/i, /AI models look for/i];

describe("evidence-bounded AI copy sweep", () => {
  for (const rel of SOURCE_FILES) {
    const file = path.join(__dirname, rel);
    if (!fs.existsSync(file)) continue;
    it(`${rel} contains no unsupported categorical AI claims`, () => {
      const text = fs.readFileSync(file, "utf-8");
      for (const phrase of BANNED_PHRASES) {
        expect(text, `${rel} matched banned phrase ${phrase}`).not.toMatch(phrase);
      }
    });
  }
});
