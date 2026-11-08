import { describe, expect, it } from "vitest";
import config from "../../../next.config";
describe("current SCREEN entry point and embed boundary", () => {
  it("routes the existing tools entry to the new demo while preserving old result URLs", async () => {
    const rules = await config.redirects!();
    const rule = rules.find((rule) => rule.source === "/screen-demo");
    expect(rule).toMatchObject({destination:"/tools/screen",permanent:false});
    expect(rules.some((rule) => rule.source === "/screen-demo/:path*")).toBe(false);
  });
  it("allows only the existing trusted marketing hosts to embed the canonical demo", async () => {
    const rules = await config.headers!();
    const screen = rules.find((rule) => rule.source === "/tools/screen")!;
    const csp = screen.headers.find((header) => header.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("https://caseloadselect.ca");
    expect(csp).not.toContain("frame-ancestors *");
    const deny = rules.find((rule) => rule.headers.some((header) => header.key === "X-Frame-Options" && header.value === "DENY"))!;
    const matcher = new RegExp(`^${deny.source}$`);
    expect(matcher.test("/tools/screen")).toBe(false);
    expect(matcher.test("/tools/screen-private")).toBe(true);
    expect(matcher.test("/portal/private-lead")).toBe(true);
  });
});
