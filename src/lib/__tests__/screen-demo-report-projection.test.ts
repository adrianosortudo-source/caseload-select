// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderBriefHtmlServer } from "../screen-brief-html";
import { buildDemoReport, startDemoState } from "../screen-demo";
import { confirmDemoFacts } from "../screen-demo-confirmation";

const input = "Fictional inquiry. A Toronto business client owes a $18,450 invoice for completed work. We have a signed contract, invoice and emails accepting delivery. I can approve hiring a lawyer. I want a demand letter.";
function htmlRoot(html: string) { const root = document.createElement("div"); root.innerHTML = html; return root; }

describe("shared production report projection for the demo", () => {
  it("uses the same four-axis presentation, including inverted Simplicity", () => {
    const state = confirmDemoFacts(startDemoState(input));
    const report = buildDemoReport(state);
    report.axis_reasoning.complexity.score = 2;
    report.four_axis.complexity = 2;
    const portal = htmlRoot(renderBriefHtmlServer(report, "web", "en", undefined, state.matter_type, state.practice_area));
    const demo = htmlRoot(renderBriefHtmlServer(report, "web", "en", undefined, state.matter_type, state.practice_area, { presentation: "demo" }));
    for (const root of [portal, demo]) {
      const simplicity = root.querySelector('[data-axis="complexity"]')!;
      expect(simplicity.querySelector(".axis-block-name")?.textContent).toBe("Simplicity");
      expect(simplicity.querySelector(".axis-block-score")?.textContent).toBe("8/10");
    }
    expect(demo.querySelectorAll("[data-axis]").length).toBe(4);
    for (const group of ["headline", "commercial", "callprep", "facts", "reasoning", "contact"]) expect(demo.querySelector(`[data-group="${group}"]`)).toBeTruthy();
    expect(demo.querySelector(".brief-decision-band")).toBeNull();
    expect(demo.querySelector("[data-channel-conversation-slot]")).toBeNull();
    expect(demo.textContent).not.toContain(report.lead_id);
    expect(portal.querySelector("[data-channel-conversation-slot]")).toBeTruthy();
  });
  it("retains every resolved fact and quote check, escapes intake text, and keeps inferred facts distinguishable", () => {
    const state = startDemoState(input);
    const report = buildDemoReport(state);
    report.resolved_facts_v2 = Array.from({length: 12}, (_, i) => ({label: `Evidence ${i + 1}`, value: `Fact ${i + 1}`, source: i === 11 ? "llm_inferred" as const : "explicit_from_caller" as const}));
    report.what_to_confirm = Array.from({length: 7}, (_, i) => `Quote check ${i + 1}`);
    report.matter_snapshot = '<img src=x onerror="alert(1)">';
    const demo = htmlRoot(renderBriefHtmlServer(report, "web", "en", undefined, state.matter_type, state.practice_area, {presentation: "demo"}));
    expect(demo.textContent).toContain("Fact 12");
    expect(demo.textContent).toContain("Quote check 7");
    expect(demo.textContent).toContain("Inferred from web intake");
    expect(demo.querySelector("img")).toBeNull();
    expect(demo.textContent).toContain(report.matter_snapshot);
  });
});


it("does not choose a court from a broad amount bucket in either projection", () => {
  const state = startDemoState(input);
  const report = buildDemoReport(state);
  report.strategic_considerations = ["Above Small Claims threshold. Superior Court action with proper pleadings; consider summary judgment if defence is thin."];
  for (const presentation of ["portal", "demo"] as const) {
    const html = htmlRoot(renderBriefHtmlServer(report, "web", "en", undefined, state.matter_type, state.practice_area, {presentation}));
    expect(html.textContent).not.toContain("Above Small Claims threshold");
    expect(html.textContent).toContain(presentation === "demo" ? "Confirm the exact claim amount, relief and court before choosing a procedure." : "Confirm the exact claim amount, relief sought and appropriate court");
  }
  expect(report.strategic_considerations[0]).toContain("Above Small Claims threshold");
});
