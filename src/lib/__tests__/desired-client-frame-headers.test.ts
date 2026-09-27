import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import nextConfig from "../../../next.config";

const loadModule = createRequire(import.meta.url);
const { pathToRegexp } = loadModule("next/dist/compiled/path-to-regexp") as {
  pathToRegexp: (source: string) => RegExp;
};

const EMBED_PATH = "/tools/desired-client-matter";

describe("Desired Client frame security headers", () => {
  it("uses scoped embed headers only for the exact route and strict denial for siblings and descendants", async () => {
    const rules = await nextConfig.headers!();
    const embedRule = rules.find((rule) => rule.source === EMBED_PATH);
    const mainDenialRule = rules.find((rule) => rule.headers.some(
      (header) => header.key === "X-Frame-Options" && header.value === "DENY",
    ));
    expect(embedRule).toBeDefined();
    expect(mainDenialRule).toBeDefined();

    const matches = (source: string, path: string) => pathToRegexp(source).test(path);
    const embedHeaders = embedRule!.headers;
    const embedPolicy = embedHeaders.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
    expect(embedPolicy).toContain("frame-ancestors 'self' https://www.caseloadselect.ca https://caseloadselect.ca http://localhost:3300");
    expect(embedHeaders.some((header) => header.key === "X-Frame-Options")).toBe(false);

    for (const path of [EMBED_PATH, EMBED_PATH + "/"]) {
      const matchingRules = rules.filter((rule) => matches(rule.source, path));
      expect(matchingRules).toContain(embedRule);
      expect(matchingRules).not.toContain(mainDenialRule);
    }

    for (const path of [EMBED_PATH + "-admin", EMBED_PATH + "/private"]) {
      const matchingRules = rules.filter((rule) => matches(rule.source, path));
      expect(matchingRules).not.toContain(embedRule);
      expect(matchingRules).toContain(mainDenialRule);
    }
  });
});