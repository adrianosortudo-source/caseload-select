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
  it("keeps the real report layout but removes operational controls", () => {
    const state = initialiseState("I am buying a house and need a lawyer for the closing.");
    const html = renderBriefHtmlServer(buildReport(state), "web", null, undefined, state.matter_type, state.practice_area, { presentation: "view-only" });
    expect(html).toContain("brief-cover");
    expect(html).toContain("brief-main-grid");
    expect(html).not.toMatch(/ACTION_RAIL_SLOT|CHANNEL_CONVERSATION_SLOT|Decision window/);
    expect(html).toContain("Fictional demonstration");
  });
});

