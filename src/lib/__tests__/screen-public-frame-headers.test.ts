import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const load = createRequire(import.meta.url);
const { pathToRegexp } = load("next/dist/compiled/path-to-regexp") as { pathToRegexp: (source: string) => RegExp };
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
async function headers(path: string) {
  const { default: config } = await import("../../../next.config");
  const matching = (await config.headers!()).filter(rule => pathToRegexp(rule.source).test(path));
  return Object.fromEntries(matching.flatMap(rule => rule.headers).map(h => [h.key, h.value]));
}
describe("public SCREEN frame integration", () => {
  it.each(["/tools/screen", "/tools/screen/", "/screen-demo-app/index.html", "/screen-demo-app/assets/main.js"])("allows the canonical app frame at %s", async path => {
    const h = await headers(path);
    expect(h["Content-Security-Policy"]).toContain("frame-src 'self';");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'self' https://www.caseloadselect.ca https://caseloadselect.ca http://localhost:3300");
    expect(h["X-Frame-Options"]).toBeUndefined();
    expect(h["X-Robots-Tag"]).toBe("noindex, nofollow");
  });
  it.each(["/portal/example/triage/example", "/admin", "/tools/screen/private", "/tools/screen-admin", "/screen-demo-app-admin"])("preserves strict denial at %s", async path => {
    const h = await headers(path);
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["X-Frame-Options"]).toBe("DENY");
  });
  it("does not change the other tools' frame sources", async () => {
    expect((await headers("/tools/seo-check"))["Content-Security-Policy"]).toContain("frame-src https://cal.com https://app.cal.com;");
  });
  it("limits the optional marketing preview origin to SCREEN previews", async () => {
    const origin = "https://caseloadselect-site-example-adrianosortudo-7282s-projects.vercel.app";
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("SCREEN_DEMO_MARKETING_PREVIEW_ORIGIN", origin); vi.resetModules();
    expect((await headers("/tools/screen"))["Content-Security-Policy"]).toContain(origin);
    expect((await headers("/portal/example"))["Content-Security-Policy"]).not.toContain(origin);
    vi.stubEnv("VERCEL_ENV", "production"); vi.resetModules();
    expect((await headers("/tools/screen"))["Content-Security-Policy"]).not.toContain(origin);
  });
  it("rejects an unexpected preview origin", async () => {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("SCREEN_DEMO_MARKETING_PREVIEW_ORIGIN", "https://unexpected.example"); vi.resetModules();
    await expect(headers("/tools/screen")).rejects.toThrow("exact CaseLoad Select preview origin");
  });
});
