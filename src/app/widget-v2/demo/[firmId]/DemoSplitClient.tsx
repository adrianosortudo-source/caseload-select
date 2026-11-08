"use client";

import { ScreenDemoWorkspace } from "@/components/intake-v2/ScreenDemoWorkspace";

export function DemoSplitClient({ firmId, firmName }: { firmId: string; firmName: string; consentCaptureEnabled?: boolean }) {
  return <ScreenDemoWorkspace firmId={firmId} firmName={firmName} preserveFirmTheme />;
}
