import { describe, expect, it } from "vitest";
import { aggregateRenderingSummary, analyzeRenderingSnapshot, buildRenderingCategory } from "../rendering-analysis";

describe("rendering-analysis", () => {
  it("flags thin JavaScript app shells as high risk", () => {
    const html = `<!doctype html><html><body><div id="__next"></div>${"<script src=\"/app.js\"></script>".repeat(7)}</body></html>`;
    const snapshot = analyzeRenderingSnapshot(html);
    expect(snapshot.risk).toBe("high");
    expect(snapshot.emptyAppRoot).toBe(true);
    expect(buildRenderingCategory(snapshot).items[0].status).toBe("fail");
  });

  it("keeps rich server-rendered HTML low risk", () => {
    const words = Array.from({ length: 300 }, (_, i) => `word${i}`).join(" ");
    const snapshot = analyzeRenderingSnapshot(`<html><body><main><h1>Family Lawyer Toronto</h1><p>${words}</p></main></body></html>`);
    expect(snapshot.risk).toBe("low");
    expect(buildRenderingCategory(snapshot).items[0].status).toBe("pass");
  });

  it("does not warn on app-shell markers when server HTML is substantive", () => {
    const words = Array.from({ length: 320 }, (_, i) => `service${i}`).join(" ");
    const snapshot = analyzeRenderingSnapshot(`<html><body><div id="__next"><main>${words}</main></div>${"<script src=\"/x.js\"></script>".repeat(8)}</body></html>`);
    const category = buildRenderingCategory(snapshot);
    expect(snapshot.risk).toBe("low");
    expect(category.items.find((i) => i.label === "JavaScript app-shell dependency")?.status).toBe("pass");
  });

  it("aggregates the worst rendering risk across pages", () => {
    const summary = aggregateRenderingSummary([
      { url: "https://example.com/", rendering: analyzeRenderingSnapshot("<html><body><p>Enough words ".repeat(260) + "</p></body></html>") },
      { url: "https://example.com/contact", rendering: analyzeRenderingSnapshot(`<div id="root"></div>${"<script src=\"/x.js\"></script>".repeat(6)}`) },
    ]);
    expect(summary?.risk).toBe("high");
    expect(summary?.highRiskPages).toBe(1);
  });

  it("does not rate a short but fully server-rendered page as high risk", () => {
    // Field case marathonlaw.ca /contact (Squarespace): ~110 words of complete
    // NAP content (addresses, tel:, mailto:, hours) with 26 external scripts
    // and zero app-shell markers. Short by design, not JS-dependent. HIGH must
    // require an app-shell signal, not brevity alone.
    const napWords = Array.from({ length: 110 }, (_, i) => `nap${i}`).join(" ");
    const html = `<html><body><main><h1>Contact</h1><p>${napWords}</p><a href="tel:18774593237">call</a><a href="mailto:info@x.ca">email</a></main>${"<script src=\"/vendor.js\"></script>".repeat(26)}</body></html>`;
    const snapshot = analyzeRenderingSnapshot(html);
    expect(snapshot.appShellLikely).toBe(false);
    expect(snapshot.risk).not.toBe("high");
  });

  it("matches app-shell mount points by exact class token, not substring", () => {
    // A hyphenated platform class merely CONTAINING "app" (Squarespace emits
    // several) is not an app-shell mount point. An exact "app" token is.
    const scripts = "<script src=\"/x.js\"></script>".repeat(6);
    const substringOnly = analyzeRenderingSnapshot(`<div class="sqs-announcement-bar-app-wrapper"></div>${scripts}`);
    expect(substringOnly.emptyAppRoot).toBe(false);
    const exactToken = analyzeRenderingSnapshot(`<div class="app"></div>${scripts}`);
    expect(exactToken.emptyAppRoot).toBe(true);
    expect(exactToken.risk).toBe("high");
  });
});
