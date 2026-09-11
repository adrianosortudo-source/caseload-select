import type { ProspectDemoProfile } from "@/lib/prospect-demo/types";

/**
 * Presentation-only profile derived from the supplied Walker Law screenshot.
 * It contains fictional scenarios and does not represent the firm's policies.
 */
export const walkerLawProspectDemoProfile: ProspectDemoProfile = {
  formatVersion: 1,
  id: "walker-law",
  slug: "walker-law",
  revision: 2,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T18:00:00.000Z",
  firmName: "Walker Law",
  websiteTitle: "Walker Law website intake preview",
  reference: {
    url: "https://tcwalkerlawyers.com/homepage-demo/",
    capturedAt: "2026-09-10",
    notes:
      "Presentation reference from the supplied screenshot. The surrounding website is a visual snapshot for a private demonstration.",
  },
  screenshot: {
    assetId: "walker-law-consultation-reference",
    width: 2340,
    height: 1650,
    mimeType: "image/png",
  },
  placement: {
    x: 230 / 2340,
    y: 360 / 1650,
    width: 730 / 2340,
    height: 1220 / 1650,
  },
  theme: {
    accent: "#B79A69",
    surface: "#F8F7F4",
    text: "#262626",
    buttonText: "#FFFFFF",
  },
  scenarios: [
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
  ],
  defaultView: "website",
  defaultMode: "guided",
};

const ORIGINAL_PLACEMENT = {
  x: 0.071795,
  y: 0.169697,
  width: 0.258974,
  height: 0.593939,
};

/** Correct the shipped crop without changing a presenter's calibrated screenshot. */
export function upgradeWalkerLawProspectDemoProfile(profile: ProspectDemoProfile): ProspectDemoProfile {
  const isOriginalCrop = (Object.keys(ORIGINAL_PLACEMENT) as (keyof typeof ORIGINAL_PLACEMENT)[])
    .every((key) => Math.abs(profile.placement[key] - ORIGINAL_PLACEMENT[key]) < 0.0000001);
  if (profile.id !== "walker-law" || profile.revision !== 1 ||
    profile.screenshot.assetId !== "walker-law-consultation-reference" ||
    profile.screenshot.width !== 2340 || profile.screenshot.height !== 1650 || !isOriginalCrop) {
    return profile;
  }
  return {
    ...profile,
    revision: walkerLawProspectDemoProfile.revision,
    updatedAt: walkerLawProspectDemoProfile.updatedAt,
    placement: { ...walkerLawProspectDemoProfile.placement },
  };
}
