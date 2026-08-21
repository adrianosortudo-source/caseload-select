"use client";

/**
 * DemoSplitClient — client-side glue for the split-screen demo.
 *
 * Renders the deterministic Screen demo. The former split view used the
 * legacy intake controller, which creates live sessions and can reach OTP
 * routes. This route is intentionally self-contained and never persists.
 */

import { ScreenDemoWidget } from "@/components/intake-v2/ScreenDemoWidget";

interface Props {
  firmId: string;
  firmName: string;
}

export function DemoSplitClient({ firmId, firmName }: Props) {
  return (
    <div data-firm-id={firmId} data-firm-name={firmName}>
      <ScreenDemoWidget />
    </div>
  );
}
