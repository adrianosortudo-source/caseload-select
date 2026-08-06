"use client";

/**
 * Fetches the prospect-list artifact HTML from /admin/prospects/view (operator
 * cookie rides on the same-origin fetch) and renders it in an iframe srcdoc.
 *
 * Why srcdoc instead of iframe src: the app's global security headers block all
 * framing (frame-ancestors 'none' + X-Frame-Options: DENY in next.config.ts,
 * which is hook-protected against edits). Those headers govern frame
 * NAVIGATIONS; srcdoc never navigates the frame to a URL, so the artifact
 * renders inside the console shell without weakening the header posture.
 * The iframe still isolates the artifact's styles and scripts from the console
 * chrome, which is what keeps this integration zero-touch on the artifact.
 */
import { useEffect, useState } from "react";

export default function ProspectsFrame() {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/admin/prospects/view")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setHtml(text);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="border border-black/10 bg-white rounded p-6 text-sm text-black/60">
        The prospect list could not be loaded ({error}). Refresh the page to retry.
      </div>
    );
  }

  if (html === null) {
    return (
      <div className="border border-black/10 bg-white rounded p-6 text-sm text-black/40">
        Loading the prospect list...
      </div>
    );
  }

  return (
    <iframe
      srcDoc={html}
      title="GTA prospect list"
      className="w-full rounded border border-black/10 bg-white"
      style={{ height: "calc(100vh - 190px)", minHeight: "600px" }}
    />
  );
}
