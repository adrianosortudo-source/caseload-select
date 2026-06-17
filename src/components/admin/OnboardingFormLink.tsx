"use client";

/**
 * OnboardingFormLink: operator panel to preview the firm-onboarding form and
 * mint a per-firm link. The token in the URL is the credential and becomes the
 * firm's name on the page (e.g. DRG-LAW-2026-06-17 renders as "DRG Law"), so
 * there is nothing to register first. "Open form" previews exactly what the
 * rep sees; "Copy link" gives the URL to email.
 */

import { useEffect, useState } from "react";

export default function OnboardingFormLink() {
  const [token, setToken] = useState("PREVIEW");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const cleanToken = token.trim().replace(/\s+/g, "-") || "PREVIEW";
  const path = `/firm-onboarding/${encodeURIComponent(cleanToken)}`;
  const url = origin ? `${origin}${path}` : path;
  const valid = token.trim().length > 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the field is selectable as a fallback.
    }
  }

  return (
    <div className="bg-white border border-black/10 p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-navy">Onboarding form</h2>
          <p className="text-xs text-black/50 mt-0.5">
            Preview the form, or make a per-firm link to send. The token becomes the firm name on the page.
          </p>
        </div>
        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold px-4 py-2 bg-navy text-white hover:bg-navy-deep transition-colors"
        >
          Open form <span aria-hidden>↗</span>
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-[190px_1fr_auto] sm:items-end">
        <label className="block">
          <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
            Token
          </span>
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="DRG-LAW-2026-06-17"
            className="w-full text-sm px-3 py-2 border border-black/15 bg-white focus:outline-none focus:border-navy"
          />
        </label>

        <label className="block min-w-0">
          <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">
            Link to send
          </span>
          <input
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full text-sm px-3 py-2 border border-black/15 bg-parchment/40 text-black/70 focus:outline-none focus:border-navy"
          />
        </label>

        <button
          type="button"
          onClick={copy}
          disabled={!valid}
          className="text-xs uppercase tracking-wider font-semibold px-3 py-2 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors disabled:opacity-40"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <p className="text-[11px] text-black/40">
        Recommended token pattern: FIRMNAME-YYYY-MM-DD. Anyone with the link can open the form; submissions land in the list below.
      </p>
    </div>
  );
}
