import { describe, expect, it } from "vitest";

import { upgradeWalkerLawProspectDemoProfile, walkerLawProspectDemoProfile } from "../walker-law";

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
      x: 230 / 2340,
      y: 360 / 1650,
      width: 730 / 2340,
      height: 1220 / 1650,
    });
    expect(placement.x * screenshot.width).toBeCloseTo(230);
    expect((placement.x + placement.width) * screenshot.width).toBeCloseTo(960);
    expect((placement.y + placement.height) * screenshot.height).toBeCloseTo(1580);
  });

  it("repairs the old shipped crop and preserves other local settings", () => {
    const oldProfile = {
      ...walkerLawProspectDemoProfile,
      revision: 1,
      firmName: "Walker Law meeting",
      placement: { x: 0.071795, y: 0.169697, width: 0.258974, height: 0.593939 },
    };
    const upgraded = upgradeWalkerLawProspectDemoProfile(oldProfile);
    expect(upgraded.placement).toEqual(walkerLawProspectDemoProfile.placement);
    expect(upgraded.revision).toBe(2);
    expect(upgraded.firmName).toBe("Walker Law meeting");
  });

  it("leaves a presenter's calibrated crop or replacement screenshot intact", () => {
    const calibrated = { ...walkerLawProspectDemoProfile, revision: 1, placement: { x: 0.12, y: 0.2, width: 0.4, height: 0.7 } };
    expect(upgradeWalkerLawProspectDemoProfile(calibrated)).toBe(calibrated);
    const replacement = { ...walkerLawProspectDemoProfile, revision: 1, screenshot: { ...walkerLawProspectDemoProfile.screenshot, assetId: "new-screenshot" } };
    expect(upgradeWalkerLawProspectDemoProfile(replacement)).toBe(replacement);
    expect(upgradeWalkerLawProspectDemoProfile(walkerLawProspectDemoProfile)).toBe(walkerLawProspectDemoProfile);
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
