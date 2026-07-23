import type { Metadata } from "next";
import FirmVoiceBuilder from "@/components/firm-voice-builder/FirmVoiceBuilder";

export const metadata: Metadata = {
  title: "The Firm Voice Builder · CaseLoad Select",
  description:
    "A free, guided interview that builds a Firm Voice Profile you paste into any AI so its drafts finally sound like you. Ontario advertising rails and an AI-tell blocklist built in.",
  robots: { index: false, follow: false },
};

/**
 * /tools/firm-voice-builder
 *
 * Interactive Firm Voice Builder (BUILD_PLAN_firm_voice_builder_tool_v1.md).
 * Deliberately noindex per plan S8: not promoted or linked anywhere until
 * the email gate and consent wiring land in a later build. Outside the
 * frozen (marketing)/ route group by necessity (check-website-boundary.mjs
 * Rule A has zero exceptions since 2026-07-05); this is a fresh top-level
 * route, sibling to /widget and /book, added to the AdminShell bypass list.
 */
export default function FirmVoiceBuilderPage() {
  return (
    <main className="min-h-screen bg-parchment px-4 py-10">
      <FirmVoiceBuilder />
    </main>
  );
}
