/**
 * Why Your Firm · Funnel events
 *
 * Four events per the build plan §3.5: wyf_start, wyf_step, wyf_gate_view,
 * wyf_complete. Visitor-to-start is the leak every benchmark in the research
 * behind this build hides, so these exist to make the funnel measurable from
 * day one, not to add a dashboard nobody asked for.
 *
 * DELIBERATELY NOT WIRED TO A SCRIPT LOADER (see the Phase 2 build report)
 * This app loads no gtag.js anywhere today, and this route's own CSP
 * script-src is `'self' 'unsafe-inline'` with no external host allowed
 * (toolsEmbedSecurityHeaders in next.config.ts). Injecting the Google Tag
 * Manager script would need that script-src widened to
 * googletagmanager.com, plus connect-src widened for the beacon, on the
 * shared header tier five other public tools already use. That is a CSP
 * change with real security surface, not a copy-paste addition like the
 * per-route allow-list entry this build already made twice; it belongs to
 * Adriano, not to a build session executing under a plan that told it not
 * to touch the CSP tier at all.
 *
 * trackEvent() below is therefore a no-op until window.gtag exists by some
 * other means. The instrumentation is complete and correct now; flipping it
 * on later is a CSP decision and a script tag, not a code change here.
 */

type GtagFn = (...args: unknown[]) => void;

function gtag(): GtagFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { gtag?: GtagFn };
  return typeof w.gtag === "function" ? w.gtag : null;
}

export function trackEvent(name: string, params?: Record<string, unknown>) {
  gtag()?.("event", name, params);
}

export const EVENTS = {
  start: "wyf_start",
  step: "wyf_step",
  gateView: "wyf_gate_view",
  complete: "wyf_complete",
} as const;
