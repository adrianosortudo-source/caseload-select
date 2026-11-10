import { describe, expect, it } from "vitest";
import { initialiseState } from "@/lib/screen-engine/extractor";
import { configureFirmPracticeAreas } from "@/lib/screen-engine/family";
import { buildReport } from "@/lib/screen-engine/report";
import { renderBriefHtmlServer } from "@/lib/screen-brief-html";

describe("read-only SCREEN report", () => {
  it("never displays family compatibility scores or fees in either presentation", () => {
    const state = configureFirmPracticeAreas(initialiseState("I need a family lawyer for custody."), ["family"]);
    const report = buildReport(state);
    expect(report.intake_only).toBe(true);
    for (const presentation of ["portal", "view-only"] as const) {
      const html = renderBriefHtmlServer(report, "web", null, undefined, state.matter_type, state.practice_area, { presentation });
      expect(html).toContain("Firm review required");
      expect(html).not.toMatch(/Band C|axis-grid|fee-block|decision window/i);
    }
  });
  it("does not display compatibility scoring or commercial sections for an out-of-scope case", () => {
    const text = "I have been charged with assault and need a criminal defence lawyer for my bail hearing.";
    const state = initialiseState(text);
    expect(state.matter_type).toBe("out_of_scope");
    const report = { ...buildReport(state), band: "C" as const };
    const html = renderBriefHtmlServer(report, "web", null, undefined, state.matter_type, state.practice_area, { presentation: "view-only" });
    expect(html).toContain('data-group="routing"');
    expect(html).toContain("brief-cover");
    expect(html).not.toMatch(/band-badge|why this is band|axis-grid|commercial angle|fee-block/i);
  });
  it.each(["family", "real_estate"] as const)("keeps actual contact structure in the %s view-only report", area => {
    const initial = initialiseState(area === "family" ? "I need a family lawyer for custody." : "I am buying a house and need a lawyer for the closing.");
    const state = area === "family" ? configureFirmPracticeAreas(initial, ["family"]) : initial;
    const report = { ...buildReport(state), resolved_facts_v2: [{ label: "Name", value: "Example Person", source: "answered" as const }] };
    const html = renderBriefHtmlServer(report, "web", null, undefined, state.matter_type, state.practice_area, { presentation: "view-only" });
    expect(html).toContain("Fictional demonstration. No firm was contacted.");
    expect(html).toContain('class="nap-grid"');
    for (const label of ["Name", "Phone", "Postal code", "Email"]) expect(html).toContain(`>${label}</p>`);
    expect(html).toContain("Example Person");
    expect(html.match(/Not captured/g)).toHaveLength(3);
    expect(html).not.toMatch(/ACTION_RAIL_SLOT|CHANNEL_CONVERSATION_SLOT|Decision window|Queue posture/i);
  });
  it("keeps the real report layout but removes operational controls", () => {
    const state = initialiseState("I am buying a house and need a lawyer for the closing.");
    const html = renderBriefHtmlServer(buildReport(state), "web", null, undefined, state.matter_type, state.practice_area, { presentation: "view-only" });
    expect(html).toContain("brief-cover");
    expect(html).toContain("brief-main-grid");
    expect(html).not.toMatch(/ACTION_RAIL_SLOT|CHANNEL_CONVERSATION_SLOT|Decision window/);
    expect(html).toContain("Fictional demonstration");
  });
});

