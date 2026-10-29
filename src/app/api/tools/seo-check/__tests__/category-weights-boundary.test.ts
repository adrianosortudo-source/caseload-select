import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CATEGORY_WEIGHTS } from "../category-weights";

describe("SEO report model client import boundary", () => {
  it("keeps server crawler and Node networking code out of the client report model dependency graph", () => {
    const reportModelPath = path.join(__dirname, "../report-model.ts");
    const source = fs.readFileSync(reportModelPath, "utf-8");

    expect(source).toContain('from "./category-weights"');
    expect(source).not.toMatch(/import\s+(?!type\b)[^;]*from\s+["']\.\/engine-core["']/);
    expect(source).toContain('import type { AiBotPurpose } from "./engine-core"');
  });

  it("preserves the established score weights", () => {
    expect(CATEGORY_WEIGHTS).toEqual({
      "On-Page SEO": 20,
      Indexability: 8,
      "Schema & Structured Data": 16,
      "AI Visibility": 0,
      "Legal Marketing": 16,
      "Local SEO": 12,
      "Technical & Security": 4,
      "Rendering & Crawlability": 2,
      Performance: 6,
      "Links & Content": 6,
      "Intent Alignment": 8,
    });
  });
});
