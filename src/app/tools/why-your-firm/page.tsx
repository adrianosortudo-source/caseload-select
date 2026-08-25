import type { Metadata } from "next";
import WhyYourFirm from "@/components/why-your-firm/WhyYourFirm";
import ToolHeader from "@/components/why-your-firm/ToolHeader";

export const metadata: Metadata = {
  title: "Why Your Firm · CaseLoad Select",
  description:
    "A positioning tool for small Ontario law firms. Pick what makes your firm different, test each claim against the Law Society's advertising rules, and read your Firm Positioning Brief on screen.",
  robots: { index: false, follow: false },
};

/**
 * /tools/why-your-firm
 *
 * Interactive positioning wizard (BUILD_PLAN §5). Deliberately noindex,
 * matching the Firm Voice Builder's own launch posture: unpromoted until
 * Adriano links it publicly. Outside the frozen (marketing) route group by
 * the same rule that placed the Voice Builder here (check-website-boundary.mjs
 * Rule A, zero exceptions since 2026-07-05); a fresh top-level route, sibling
 * to /tools/firm-voice-builder, added to the CSP tools-embed allow-list in
 * next.config.ts and to the AdminShell bypass (which already covers all of
 * /tools/* and needed no change).
 *
 * `?embed=1` drops the ToolHeader, same contract as every other tools-embed
 * route: the marketing site frames this route inline on tools.html, and
 * without the flag the embed would show a second CaseLoad Select wordmark stranded
 * mid-page inside a page that already has one.
 *
 * NEVER use min-h-screen (or any vh unit) on <main> here. Found live during
 * Phase 2 QA: vh inside an iframe resolves against the IFRAME'S OWN current
 * height, not the outer page. With `.tool-embed iframe { height: 940px }` in
 * tools.html and `min-h-screen` on <main>, 100vh inside the frame equals
 * 940px, so <main> floors at 940px no matter what the wizard's real content
 * height is, and embed.ts's ResizeObserver reports exactly 940 back to the
 * parent forever, a stable but meaningless equilibrium at whatever height the
 * frame already happened to have. The embed protocol only works if the page
 * sizes to its own content, so height here comes from padding and content
 * alone, standalone or embedded alike.
 */
interface PageProps {
  searchParams: Promise<{ embed?: string }>;
}

export default async function WhyYourFirmPage({ searchParams }: PageProps) {
  const { embed } = await searchParams;
  const isEmbedded = embed === "1";

  return (
    <>
      {!isEmbedded && <ToolHeader />}
      <main className="bg-parchment px-4 py-10">
        <WhyYourFirm />
      </main>
    </>
  );
}
