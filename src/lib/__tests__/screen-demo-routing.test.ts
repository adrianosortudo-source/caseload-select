import { describe, expect, it, vi } from "vitest";
import config from "../../../next.config";
import ScreenToolPage from "@/app/tools/screen/page";
import { ProspectDemoClient } from "@/components/prospect-demo/ProspectDemoClient";
vi.mock("@/components/prospect-demo/ProspectDemoClient", () => ({ ProspectDemoClient: () => null }));
describe("current SCREEN entry point and embed boundary", () => {
  it("uses the canonical prospect presentation as an isolated embeddable public sample", async () => {
    const page = await ScreenToolPage({ searchParams: Promise.resolve({ embed: "1" }) });
    expect(page.type).toBe(ProspectDemoClient);
    expect(page.props).toEqual({ profileId: "example-law-firm", sampleOnly: true, embedded: true });
  });
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
