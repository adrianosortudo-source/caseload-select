import type { ProspectDemoProfile } from "@/lib/prospect-demo/types";

/** Fictional public sample, never registered in the operator profile library. */
export const exampleLawFirmProspectDemoProfile: ProspectDemoProfile = {
  formatVersion: 1, id: "example-law-firm", slug: "example-law-firm", revision: 1,
  createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z",
  firmName: "Example Law Firm", websiteTitle: "Fictional Example Law Firm website preview",
  reference: { url: "", capturedAt: "2026-11-08", notes: "Fictional website created for this demonstration." },
  screenshot: { assetId: "example-law-firm-website", width: 2340, height: 1650, mimeType: "image/png" },
  placement: { x: 230 / 2340, y: 625 / 1650, width: 730 / 2340, height: 850 / 1650 },
  theme: { accent: "#B59A6F", surface: "#FAF9F6", text: "#1C2B39", buttonText: "#FFFFFF" },
  scenarios: [
    { id: "fictional-unpaid-invoice", label: "Fictional unpaid invoice", description: "A fictional business says an invoice remains unpaid after completed work." },
    { id: "fictional-employment-dispute", label: "Fictional employment concern", description: "A fictional employee says their role ended and they want to understand their next steps." },
  ],
  defaultView: "website", defaultMode: "guided",
};
