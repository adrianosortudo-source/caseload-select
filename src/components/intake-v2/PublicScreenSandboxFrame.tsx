"use client";

import { useEffect, useRef, useState } from "react";

const RESIZE_MESSAGE_TYPE = "caseload-widget-resize";
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 20000;

// Keep this aligned with the SCREEN frame-ancestors policy in next.config.ts.
function trustedParentOrigin(referrer: string, ownOrigin: string): string | null {
  try {
    const origin = new URL(referrer).origin;
    if (
      origin === ownOrigin ||
      origin === "https://caseloadselect.ca" ||
      origin === "https://www.caseloadselect.ca" ||
      origin === "http://localhost:3300" ||
      /^https:\/\/caseloadselect-site-[a-z0-9-]+\.vercel\.app$/.test(origin)
    ) return origin;
  } catch {
    // Missing or invalid referrers are not trusted.
  }
  return null;
}

export function PublicScreenSandboxFrame({ query = "" }: { query?: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const parentOrigin = trustedParentOrigin(document.referrer, window.location.origin);
    let lastHeight: number | null = null;
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const data: unknown = event.data;
      if (!data || typeof data !== "object" || !("type" in data) || data.type !== RESIZE_MESSAGE_TYPE || !("height" in data)) return;
      const measured = data.height;
      if (typeof measured !== "number" || !Number.isFinite(measured) || measured < MIN_HEIGHT || measured > MAX_HEIGHT) return;
      const nextHeight = Math.ceil(measured);
      if (nextHeight === lastHeight) return;
      lastHeight = nextHeight;
      setHeight(nextHeight);
      if (window.parent !== window && parentOrigin) {
        window.parent.postMessage({ type: RESIZE_MESSAGE_TYPE, height: nextHeight }, parentOrigin);
      }
    }
    window.addEventListener("message", onMessage);
    const src = "/screen-demo-app/index.html" + (query ? "?" + query : "");
    if (frameRef.current && frameRef.current.getAttribute("src") !== src) {
      frameRef.current.setAttribute("src", src);
    }
    return () => window.removeEventListener("message", onMessage);
  }, [query]);

  return (
    <main aria-label="SCREEN demonstration" style={{ width: "100%" }}>
      <iframe
        ref={frameRef}
        title="SCREEN practice-area and channel demonstration"
        allow="clipboard-write"
        referrerPolicy="same-origin"
        style={{ display: "block", width: "100%", height: height === null ? "100dvh" : `${height}px`, border: 0 }}
      />
    </main>
  );
}
