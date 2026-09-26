export type DesiredClientEmbedMessage =
  | { type: "desired-client:height"; version: 1; height: number }
  | { type: "desired-client:step"; version: 1 };

export interface DesiredClientEmbedBridge {
  observeContent: (root: HTMLElement) => () => void;
  announceStepChange: () => void;
}

const ALLOWED_PARENT_ORIGINS = new Set([
  "https://caseloadselect.ca",
  "https://www.caseloadselect.ca",
  "http://localhost:3300",
]);

/** Bind child messages to the exact, approved origin that loaded this frame. */
export function createDesiredClientEmbedBridge(): DesiredClientEmbedBridge | null {
  if (typeof window === "undefined" || typeof document === "undefined" || window.parent === window) return null;

  let targetOrigin: string;
  try {
    targetOrigin = new URL(document.referrer).origin;
  } catch {
    return null;
  }
  if (!ALLOWED_PARENT_ORIGINS.has(targetOrigin)) return null;

  const parentWindow = window.parent;
  const post = (message: DesiredClientEmbedMessage) => parentWindow.postMessage(message, targetOrigin);

  return {
    announceStepChange() {
      post({ type: "desired-client:step", version: 1 });
    },
    observeContent(root) {
      let frame = 0;
      let stopped = false;
      const report = () => {
        frame = 0;
        if (stopped) return;
        const rectHeight = root.getBoundingClientRect().height;
        const height = Math.ceil(Math.max(root.scrollHeight, rectHeight));
        if (Number.isFinite(height) && height > 0) post({ type: "desired-client:height", version: 1, height });
      };
      const schedule = () => {
        if (stopped || frame) return;
        frame = window.requestAnimationFrame(report);
      };

      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
      observer?.observe(root);
      schedule();

      return () => {
        stopped = true;
        observer?.disconnect();
        if (frame) window.cancelAnimationFrame(frame);
      };
    },
  };
}
