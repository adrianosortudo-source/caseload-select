/**
 * Regression: mixed-content detection must count only genuinely LOADED http://
 * sub-resources, never <a href> navigations or declaration <link> tags. Field
 * case chaabanelaw.com: the old detector fired "1 HTTP resource" on
 * <link rel="profile" href="http://gmpg.org/xfn/11">, the WordPress XFN
 * declaration that ships on every WordPress install and that browsers never
 * fetch, so the finding was a false positive a prospect could rebut live.
 */

import { describe, it, expect, vi } from "vitest";

// route.ts pulls in save-run -> supabase-admin (server-only) plus portal-auth
// at module load; countMixedContentResources is pure, so stub the server
// surface just to import the module.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/portal-auth", () => ({ getOperatorSession: async () => null }));

import { countMixedContentResources } from "../route";

describe("countMixedContentResources", () => {
  it("does NOT count the WordPress XFN profile link (rel=profile, never fetched)", () => {
    expect(countMixedContentResources(`<link rel="profile" href="http://gmpg.org/xfn/11" />`)).toBe(0);
  });

  it("does NOT count <a href> navigations", () => {
    expect(countMixedContentResources(`<a href="http://example.com/page">link</a>`)).toBe(0);
  });

  it("does NOT count declaration links or form-field values", () => {
    const html =
      `<link rel="canonical" href="http://x.com/">` +
      `<link rel="dns-prefetch" href="http://fonts.example">` +
      `<link rel="pingback" href="http://x.com/xmlrpc.php">` +
      `<input name="referer-page" value="http://Direct%20Visit">` +
      `<input data-value="http://Direct%20Visit">`;
    expect(countMixedContentResources(html)).toBe(0);
  });

  it("counts genuinely loaded sub-resources over http://", () => {
    expect(countMixedContentResources(`<script src="http://cdn.example/a.js"></script>`)).toBe(1);
    expect(countMixedContentResources(`<img src="http://img.example/a.png">`)).toBe(1);
    expect(countMixedContentResources(`<iframe src="http://embed.example/x"></iframe>`)).toBe(1);
    expect(countMixedContentResources(`<link rel="stylesheet" href="http://cdn.example/a.css">`)).toBe(1);
    expect(countMixedContentResources(`<link href="http://cdn.example/a.css" rel="stylesheet">`)).toBe(1); // rel after href
    expect(countMixedContentResources(`<link rel="icon" href="http://x.com/favicon.ico">`)).toBe(1);
    expect(countMixedContentResources(`<object data="http://x.com/a.swf"></object>`)).toBe(1);
  });

  it("counts the hardening vectors the field page did not exercise", () => {
    expect(countMixedContentResources(`<img srcset="http://x.com/a 1x, http://x.com/b 2x">`)).toBe(1);
    expect(countMixedContentResources(`<video poster="http://x.com/p.jpg"></video>`)).toBe(1);
    expect(countMixedContentResources(`<div style="background:url(http://x.com/bg.png)"></div>`)).toBe(1);
    expect(countMixedContentResources(`<style>@import url(http://x.com/a.css);</style>`)).toBe(1);
    expect(countMixedContentResources(`<img data-src="http://x.com/lazy.png">`)).toBe(1);
  });

  it("returns 0 for an all-HTTPS page and mirrors the chaabanelaw case", () => {
    const html =
      `<link rel="profile" href="http://gmpg.org/xfn/11" />` +
      `<script src="https://code.jquery.com/jquery.js"></script>` +
      `<img src="https://chaabanelaw.com/logo.png">` +
      `<a href="http://twitter.com/share">share</a>`;
    expect(countMixedContentResources(html)).toBe(0);
  });
});
