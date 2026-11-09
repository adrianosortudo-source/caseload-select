import type { ProspectDemoProfile } from "@/lib/prospect-demo/types";

/** Fixed shareable preview prepared from the operator builder export. */
export const geneColmanProspectDemoProfile: ProspectDemoProfile = {
  "formatVersion": 1,
  "id": "gene-colman",
  "slug": "gene-colman",
  "revision": 3,
  "createdAt": "2026-11-09T19:23:51.665Z",
  "updatedAt": "2026-11-09T19:25:30.224Z",
  "firmName": "Gene C. Colman Family Law Centre",
  "websiteTitle": "Gene C. Colman Family Law Centre website",
  "reference": {
    "url": "https://www.complexfamilylaw.com/",
    "capturedAt": "2026-11-09T19:23:51.665Z",
    "notes": "Website screenshot supplied by Adriano; form placement and scenarios exported from the prospect demo builder on November 9, 2026. Inquiries and replies in this preview are fictional."
  },
  "screenshot": {
    "assetId": "screenshot-143cfe71-d840-4ed8-8877-60646232e92e",
    "width": 1986,
    "height": 16000,
    "mimeType": "image/webp"
  },
  "placement": {
    "x": 0.58,
    "y": 0.01,
    "width": 0.42,
    "height": 0.08
  },
  "theme": {
    "accent": "#B28B50",
    "surface": "#FFFFFF",
    "text": "#182538",
    "buttonText": "#FFFFFF"
  },
  "scenarios": [
    {
      "id": "your-inquiry",
      "label": "Your inquiry",
      "description": "Type a fictional family-law situation to see SCREEN identify the missing facts."
    },
    {
      "id": "fictional-parenting",
      "label": "Fictional parenting concern",
      "description": "My former partner and I have separated in Ontario and need help agreeing on a parenting schedule for our child."
    },
    {
      "id": "fictional-separation",
      "label": "Fictional separation",
      "description": "I live in Ontario and recently separated. I need help with a separation agreement, support and the family home."
    }
  ],
  "defaultView": "website",
  "defaultMode": "live-ai",
  "practiceAreas": [
    "family"
  ]
};
