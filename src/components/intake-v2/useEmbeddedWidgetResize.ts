"use client";

import { useEffect, useState, type RefObject } from "react";

const RESIZE_MESSAGE_TYPE = "caseload-widget-resize";

/**
 * Keeps an embedded widget frame synchronized with the rendered content.
 * The caller controls `enabled` so screens that mount conditionally can start
 * observing only after their target ref exists.
 */
export function useEmbeddedWidgetResize<T extends HTMLElement>(
  targetRef: RefObject<T | null>,
  enabled = true,
) {
  const [isEmbedded, setIsEmbedded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const embedded = window.parent !== window;
    setIsEmbedded(embedded);
    if (!embedded || !enabled) return;

    if (!targetRef.current) return;
    const observedTarget = targetRef.current as T;

    let lastSent = 0;
    function reportHeight() {
      const measured = Math.max(
        observedTarget.scrollHeight,
        observedTarget.offsetHeight,
        observedTarget.getBoundingClientRect().height,
      );
      const height = Math.ceil(measured);
      if (height === lastSent || height < 100) return;
      lastSent = height;
      window.parent.postMessage({ type: RESIZE_MESSAGE_TYPE, height }, "*");
    }

    reportHeight();

    const observer = new ResizeObserver(reportHeight);
    observer.observe(observedTarget);

    const fallback = window.setInterval(reportHeight, 300);

    if (typeof document !== "undefined" && "fonts" in document) {
      void document.fonts.ready.then(() => {
        reportHeight();
        window.requestAnimationFrame(reportHeight);
      });
    }

    const lateSettle = window.setTimeout(reportHeight, 1500);

    return () => {
      observer.disconnect();
      window.clearInterval(fallback);
      window.clearTimeout(lateSettle);
    };
  }, [enabled, targetRef]);

  return isEmbedded;
}
