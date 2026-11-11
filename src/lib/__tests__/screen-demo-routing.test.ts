import { describe, expect, it, vi } from "vitest";
import config from "../../../next.config";
import ScreenToolPage from "@/app/tools/screen/page";
import { ProspectDemoClient } from "@/components/prospect-demo/ProspectDemoClient";
import GeneColmanScreenPage from "@/app/tools/screen/gene-colman/page";
import { PublicScreenSandboxFrame } from "@/components/intake-v2/PublicScreenSandboxFrame";
vi.mock("@/components/prospect-demo/ProspectDemoClient", () => ({ ProspectDemoClient: () => null }));
describe("current SCREEN entry point and embed boundary", () => {
  it("renders the canonical app-origin demo and passes only permitted settings", async () => {
    const page = await ScreenToolPage({ searchParams: Promise.resolve({ embed: "1", practice_area: "employment", channel: "sms", profile: "gene" }) });
    expect(page.type).toBe(PublicScreenSandboxFrame);
    expect(page.props.query).toBe("embed=1&practice_area=employment&channel=sms&profile=gene");
    const defaults = await ScreenToolPage({ searchParams: Promise.resolve({}) });
    expect(defaults.props.query).toBe("");
    const rejected = await ScreenToolPage({ searchParams: Promise.resolve({ embed: "yes", practice_area: "criminal", channel: "gbp", profile: "other" }) });
    expect(rejected.props.query).toBe("");
  });
  it("preserves the Gene family prospect presentation", () => {
    const page = GeneColmanScreenPage();
    expect(page.type).toBe(ProspectDemoClient);
    expect(page.props).toEqual({ profileId: "gene-colman", sampleOnly: true });
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
