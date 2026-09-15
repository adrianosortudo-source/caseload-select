import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { ensureConversationRailSlot } from "../lead-report-layout";

const briefCss = fs.readFileSync(
  path.join(
    process.cwd(),
    "src",
    "app",
    "portal",
    "[firmId]",
    "triage",
    "[leadId]",
    "brief.css",
  ),
  "utf8",
);

describe("ensureConversationRailSlot", () => {
  it("preserves a new brief that already carries the stable slot", () => {
    const html = '<aside class="brief-main-right"><div data-channel-conversation-slot></div></aside>';

    expect(ensureConversationRailSlot(html)).toEqual({ html, inserted: true });
  });

  it("injects the slot directly after Queue posture in an existing v2 brief", () => {
    const html = [
      '<div class="brief-main-grid">',
      '<aside class="brief-main-right">',
      '<section class="sidebar-card sidebar-card-posture"><dl><div>Queue</div></dl></section>',
      '<section class="sidebar-card sidebar-card-watchpoints">Watchpoints</section>',
      '</aside>',
      '</div>',
    ].join("");

    const result = ensureConversationRailSlot(html);
    expect(result.inserted).toBe(true);
    expect(result.html.indexOf("sidebar-card-posture")).toBeLessThan(
      result.html.indexOf("data-channel-conversation-slot"),
    );
    expect(result.html.indexOf("data-channel-conversation-slot")).toBeLessThan(
      result.html.indexOf("sidebar-card-watchpoints"),
    );
  });

  it("returns the legacy brief unchanged when it has no right rail", () => {
    const html = '<section class="legacy-brief">Legacy report</section>';

    expect(ensureConversationRailSlot(html)).toEqual({ html, inserted: false });
  });

  it("widens only the report route and bounds the desktop conversation rail", () => {
    expect(briefCss).toContain(".lead-report-page");
    expect(briefCss).toContain("width: min(1168px, calc(100vw - 2rem))");
    expect(briefCss).toContain('.lead-report-page[data-operator-console]');
    expect(briefCss).toContain("width: min(1168px, calc(100vw - 17rem))");
    expect(briefCss).toContain("minmax(280px, 300px)");
    expect(briefCss).toContain("@media (max-width: 1100px)");
  });

  it("places the conversation after all report modules when the grid flattens", () => {
    expect(briefCss).toContain('.brief-group[data-group="facts"]      { order: 7; }');
    expect(briefCss).toContain(".sidebar-card-posture                 { order: 8; }");
    expect(briefCss).toContain(".brief-conversation-slot              { order: 9; }");
  });
});
