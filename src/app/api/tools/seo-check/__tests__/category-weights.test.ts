import { describe, expect, it } from "vitest";
import { CATEGORY_WEIGHTS } from "../category-weights";

describe("SEO category weights", () => {
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
