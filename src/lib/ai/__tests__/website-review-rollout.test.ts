import { afterEach, describe, expect, it, vi } from "vitest";
import { websiteReviewProvider } from "../website-review-rollout";

const design = "WEBSITE_DESIGN_CHECK";
const message = "POSITIONING_CHECK";
afterEach(() => vi.unstubAllEnvs());

describe("website review provider rollout", () => {
  it("expands a stable 10% cohort to 50% and 100% and contracts it on rollback", () => {
    vi.stubEnv(design + "_PROVIDER", "openai");
    const identities = ["192.0.2.9", "192.0.2.4", "192.0.2.1"];
    const assigned = () => identities.map(identity => websiteReviewProvider(design, identity));
    vi.stubEnv(design + "_OPENAI_PERCENT", "10");
    const first = ["openai", "gemini", "gemini"];
    expect(assigned()).toEqual(first);
    expect(assigned()).toEqual(first);
    vi.stubEnv(design + "_OPENAI_PERCENT", "50");
    expect(assigned()).toEqual(["openai", "openai", "gemini"]);
    vi.stubEnv(design + "_OPENAI_PERCENT", "100");
    expect(assigned()).toEqual(["openai", "openai", "openai"]);
    vi.stubEnv(design + "_OPENAI_PERCENT", "10");
    expect(assigned()).toEqual(first);
    vi.stubEnv(design + "_PROVIDER", "gemini");
    expect(assigned()).toEqual(["gemini", "gemini", "gemini"]);
  });

  it("scopes assignments by feature and handles missing identities and settings", () => {
    vi.stubEnv(design + "_PROVIDER", "openai");
    vi.stubEnv(message + "_PROVIDER", "openai");
    vi.stubEnv(design + "_OPENAI_PERCENT", "10");
    vi.stubEnv(message + "_OPENAI_PERCENT", "10");
    expect(websiteReviewProvider(design, "192.0.2.9")).toBe("openai");
    expect(websiteReviewProvider(message, "192.0.2.9")).toBe("gemini");
    expect(websiteReviewProvider(message, "192.0.2.2")).toBe("openai");
    expect(websiteReviewProvider(message, "unknown")).toBe("gemini");
    expect(websiteReviewProvider(message)).toBe("gemini");
    for (const percent of ["0", "1000", "-1", "10%", ""]) {
      vi.stubEnv(message + "_OPENAI_PERCENT", percent);
      expect(websiteReviewProvider(message, "192.0.2.2")).toBe("gemini");
    }
    vi.stubEnv(message + "_OPENAI_PERCENT", undefined);
    expect(websiteReviewProvider(message)).toBe("openai");
    vi.stubEnv(message + "_PROVIDER", undefined);
    expect(websiteReviewProvider(message)).toBe("gemini");
    expect(websiteReviewProvider(design, "192.0.2.9")).toBe("openai");
  });
});
