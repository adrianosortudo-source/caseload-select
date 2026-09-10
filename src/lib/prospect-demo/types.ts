import type { ReactNode } from "react";

export const PROSPECT_DEMO_FORMAT_VERSION = 1 as const;

export type ProspectDemoView = "website" | "review" | "split";
export type ProspectDemoMode = "guided" | "live-ai";

export interface ProspectDemoScenario {
  id: string;
  label: string;
  description: string;
}

/** All values represent a fraction of the source screenshot dimensions. */
export interface ScreenshotPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProspectDemoTheme {
  accent: string;
  surface: string;
  text: string;
  buttonText: string;
}

export interface ProspectScreenshotReference {
  assetId: string;
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}

export interface ProspectDemoProfile {
  formatVersion: typeof PROSPECT_DEMO_FORMAT_VERSION;
  id: string;
  slug: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  firmName: string;
  websiteTitle: string;
  reference: {
    url: string;
    capturedAt: string;
    notes?: string;
  };
  screenshot: ProspectScreenshotReference;
  placement: ScreenshotPlacement;
  theme: ProspectDemoTheme;
  scenarios: ProspectDemoScenario[];
  defaultView: ProspectDemoView;
  defaultMode: ProspectDemoMode;
}

export interface ProspectDemoAsset {
  assetId: string;
  blob: Blob;
  width: number;
  height: number;
  mimeType: ProspectScreenshotReference["mimeType"];
}

export interface ProspectDemoSessionContext {
  profile: ProspectDemoProfile;
  scenario: ProspectDemoScenario;
  mode: ProspectDemoMode;
  /** Changes when a fresh session is requested: profile, scenario, mode, or Restart. */
  sessionKey: number;
}

/**
 * The presentation is independent of the intake engine. The integrating
 * route supplies the actual Screen Engine and its corresponding lawyer view.
 */
export interface ProspectDemoSessionAdapter {
  renderIntake(context: ProspectDemoSessionContext): ReactNode;
  renderReview(context: ProspectDemoSessionContext): ReactNode;
  onRestart?(context: ProspectDemoSessionContext): void;
}

export interface ProspectDemoPackage {
  packageType: "caseload-select.prospect-demo";
  packageVersion: 1;
  exportedAt: string;
  profile: ProspectDemoProfile;
  screenshot: {
    assetId: string;
    mimeType: ProspectScreenshotReference["mimeType"];
    width: number;
    height: number;
    dataBase64: string;
  };
}
