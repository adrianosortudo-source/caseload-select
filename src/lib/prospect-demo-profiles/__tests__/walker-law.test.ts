import { describe, expect, it } from "vitest";

import { walkerLawProspectDemoProfile } from "../walker-law";

describe("Walker Law prospect demo profile", () => {
  it("preserves the supplied screenshot dimensions and placement contract", () => {
    const { placement, screenshot } = walkerLawProspectDemoProfile;

    expect(screenshot).toEqual({
      assetId: "walker-law-consultation-reference",
      width: 2340,
      height: 1650,
      mimeType: "image/png",
    });
    expect(placement).toEqual({
      x: 0.071795,
      y: 0.169697,
      width: 0.258974,
      height: 0.593939,
    });
    expect(placement.x + placement.width).toBeLessThan(0.34);
    expect(placement.y + placement.height).toBeGreaterThan(0.76);
  });

  it("uses only fictional, replayable presentation scenarios", () => {
    expect(walkerLawProspectDemoProfile.defaultView).toBe("website");
    expect(walkerLawProspectDemoProfile.defaultMode).toBe("guided");
    expect(walkerLawProspectDemoProfile.scenarios).toEqual([
      {
        id: "fictional-unpaid-invoice",
        label: "Fictional unpaid invoice",
        description:
          "A fictional business says an invoice remains unpaid after completed work.",
      },
      {
        id: "fictional-employment-dispute",
        label: "Fictional employment concern",
        description:
          "A fictional employee says their role ended and they want to understand their next steps.",
      },
    ]);
  });
});
