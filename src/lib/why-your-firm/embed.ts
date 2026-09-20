/**
 * Why Your Firm · Embed protocol
 *
 * The tool ships two ways: standalone at /tools/why-your-firm, and framed
 * inline on tools.html at /tools/why-your-firm?embed=1. A five-step wizard
 * does not have one height; the same page is short on the alternatives step
 * and tall once the differentiator grid or the full brief renders. A fixed
 * iframe height clips it either way, so the embedded page announces its own
 * height on every change and the parent resizes the frame to match.
 *
 * Two message types, both posted only when embedded:
 *
 *   wyf-height   { type: "wyf-height", height: number }
 *     Sent on mount and on every ResizeObserver callback against the
 *     document body. The parent (tools.html) sets the iframe's height to
 *     this value.
 *
 *   wyf-step     { type: "wyf-step" }
 *     Sent whenever the wizard's step index changes. The parent scrolls the
 *     iframe's own top edge into view if it currently sits above the
 *     viewport, so moving from a short step to a tall one does not strand
 *     the reader mid-page. Deliberately sent as an intent, not an autofocus
 *     or a scrollIntoView call made from inside the iframe: WebKit bugs
 *     164512 and 176451 make focus() and scrollIntoView() called from inside
 *     a framed page scroll the PARENT to the wrong position. The parent
 *     performs its own scroll, correctly, in response to the message.
 *
 * No autofocus is called anywhere in this tool for the same reason: an
 * autofocused input on load yanks the host page down to the embed the
 * instant the iframe mounts.
 */

export const EMBED_APP_ORIGIN_HOST = "app.caseloadselect.ca";

export type EmbedMessage =
  | { type: "wyf-height"; height: number }
  | { type: "wyf-step" };

function postToParent(message: EmbedMessage) {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(message, "*");
}

/**
 * Starts observing document.body for size changes and posts wyf-height on
 * every change plus once immediately. Returns a cleanup function.
 * No-op (returns a no-op cleanup) when not running inside an iframe, so
 * callers can invoke it unconditionally.
 */
export function watchEmbedHeight(): () => void {
  if (typeof window === "undefined" || window.parent === window) {
    return () => {};
  }

  const report = () => {
    // scrollHeight, never getBoundingClientRect().height. The app's shared
    // globals.css sets `html, body { height: 100% }`; inside an iframe that
    // 100% resolves against the IFRAME'S OWN current height, so a bounding
    // rect always reports back whatever height the parent already set,
    // never the page's real content extent. scrollHeight is unaffected by
    // an ancestor's fixed height and reports the true scrollable content
    // size, which is the only number this protocol can safely trust.
    // Found live during Phase 2 QA: the parent kept resizing the frame to
    // an unchanging 940px no matter what step was showing.
    const height = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    postToParent({ type: "wyf-height", height });
  };

  report();

  if (typeof ResizeObserver === "undefined") {
    // Fallback for a browser without ResizeObserver: report on a short
    // interval instead of never resizing at all.
    const id = window.setInterval(report, 500);
    return () => window.clearInterval(id);
  }

  const observer = new ResizeObserver(() => report());
  observer.observe(document.body);
  return () => observer.disconnect();
}

/** Call whenever the wizard's step index changes. No-op outside an iframe. */
export function announceStepChange() {
  postToParent({ type: "wyf-step" });
}

/**
 * Parent-side listener installer, called from tools.html's own inline
 * script (Phase 3), documented here so the protocol has one definition
 * both sides can be checked against:
 *
 *   window.addEventListener("message", (event) => {
 *     if (event.origin !== "https://app.caseloadselect.ca") return;
 *     const data = event.data;
 *     if (!data || typeof data !== "object") return;
 *     const frame = document.querySelector('iframe[data-wyf-frame]');
 *     if (!frame) return;
 *     if (data.type === "wyf-height" && typeof data.height === "number") {
 *       frame.style.height = data.height + "px";
 *     } else if (data.type === "wyf-step") {
 *       const rect = frame.getBoundingClientRect();
 *       if (rect.top < 0) frame.scrollIntoView({ behavior: "smooth", block: "start" });
 *     }
 *   });
 */
export const PARENT_LISTENER_REFERENCE = true;
