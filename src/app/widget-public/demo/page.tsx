import type { Metadata } from "next";
import { ScreenDemoWidget } from "@/components/intake-v2/ScreenDemoWidget";

/**
 * Canonical embeddable marketing demonstration.
 *
 * Unlike `/widget-public/[firmId]`, this static route does not mount the
 * production public widget. It runs the deterministic, browser-only Screen
 * demo: no extraction request, checkpoint, contact capture, consent, submit,
 * or persistence pathway exists on this route.
 */

export const metadata: Metadata = {
  title: "CaseLoad Screen · Fictional Demonstration",
  robots: { index: false, follow: false },
};

export default function PublicWidgetDemoPage() {
  return <ScreenDemoWidget />;
}
