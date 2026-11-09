import type { ProspectDemoProfile } from "@/lib/prospect-demo/types";

/** Fictional public sample, never registered in the operator profile library. */
export const exampleLawFirmProspectDemoProfile: ProspectDemoProfile = {
  formatVersion: 1, id: "example-law-firm", slug: "example-law-firm", revision: 1,
  createdAt: "2026-11-08T00:00:00.000Z", updatedAt: "2026-11-08T00:00:00.000Z",
  firmName: "Example Law Firm", websiteTitle: "Fictional Example Law Firm website preview",
  reference: { url: "https://example.invalid/", capturedAt: "2026-11-08", notes: "Fictional website created for this demonstration." },
  screenshot: { assetId: "example-law-firm-website", width: 2340, height: 1650, mimeType: "image/png" },
  placement: { x: 230 / 2340, y: 625 / 1650, width: 730 / 2340, height: 850 / 1650 },
  theme: { accent: "#B59A6F", surface: "#FAF9F6", text: "#1C2B39", buttonText: "#FFFFFF" },
  scenarios: [
    { id: "fictional-unpaid-invoice", label: "Unpaid invoice", description: "I own a small business and can decide whether to hire a lawyer. A client has not paid a $4,800 invoice for work delivered on March 15, 2026, under a written services agreement. I have the agreement, invoice, and follow-up email." },
    { id: "fictional-employment-dispute", label: "Employment issue", description: "I worked for my employer for seven years and received a written offer of eight weeks of pay in exchange for signing a release. I have not signed; the offer says I must respond by November 20, 2026. I want to understand what else a lawyer needs to review." },
  ],
  defaultView: "website", defaultMode: "guided",
};
