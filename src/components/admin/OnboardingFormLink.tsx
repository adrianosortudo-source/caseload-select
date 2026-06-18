"use client";

/**
 * OnboardingFormLink: operator panel to preview and mint per-firm links for
 * the two onboarding forms. The token in each URL is the credential and
 * becomes the firm's name on the page, so there is nothing to register first.
 *
 *   Registration and integrations  /firm-onboarding/[token]  (send first)
 *   Firm profile                    /firm-profile/[token]     (alongside / after kickoff)
 */

import { useEffect, useState } from "react";

type Which = "registration" | "profile";

export default function OnboardingFormLink() {
  const [token, setToken] = useState("PREVIEW");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<Which | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const cleanToken = token.trim().replace(/\s+/g, "-") || "PREVIEW";
  const regPath = `/firm-onboarding/${encodeURIComponent(cleanToken)}`;
  const profilePath = `/firm-profile/${encodeURIComponent(cleanToken)}`;
  const regUrl = origin ? `${origin}${regPath}` : regPath;
  const profileUrl = origin ? `${origin}${profilePath}` : profilePath;
  const valid = token.trim().length > 0;

  async function copy(which: Which, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard can be blocked; the field is selectable as a fallback.
    }
  }

  return (
    <div className="bg-white border border-black/10 p-4 sm:p-5 space-y-4">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-navy">Onboarding forms</h2>
        <p className="text-xs text-black/50 mt-0.5">
          Type a token (it becomes the firm name on the page), then preview or copy a link. Send Registration first; Firm Profile runs alongside or after kickoff.
        </p>
      </div>

      <label className="block max-w-xs">
        <span className="block text-xs uppercase tracking-wider font-semibold text-black/60 mb-1">Token</span>
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="DRG-LAW-2026-06-17"
          className="w-full text-sm px-3 py-2 border border-black/15 bg-white focus:outline-none focus:border-navy"
        />
      </label>

      <FormLinkRow
        title="Registration and integrations"
        badge="Send first"
        path={regPath}
        url={regUrl}
        valid={valid}
        copied={copied === "registration"}
        onCopy={() => copy("registration", regUrl)}
      />
      <FormLinkRow
        title="Firm profile"
        badge="Alongside / after kickoff"
        path={profilePath}
        url={profileUrl}
        valid={valid}
        copied={copied === "profile"}
        onCopy={() => copy("profile", profileUrl)}
      />

      <p className="text-[11px] text-black/40">
        Recommended token: FIRMNAME-YYYY-MM-DD. Anyone with a link can open that form; submissions land in the list below.
      </p>
    </div>
  );
}

function FormLinkRow({
  title,
  badge,
  path,
  url,
  valid,
  copied,
  onCopy,
}: {
  title: string;
  badge: string;
  path: string;
  url: string;
  valid: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="border border-black/10 bg-parchment/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-navy">{title}</span>
          <span className="text-[10px] uppercase tracking-wider font-semibold text-black/40 border border-black/15 px-1.5 py-0.5">
            {badge}
          </span>
        </div>
        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold px-3 py-1.5 bg-navy text-white hover:bg-navy-deep transition-colors"
        >
          Open <span aria-hidden>↗</span>
        </a>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 text-xs px-2.5 py-1.5 border border-black/15 bg-white text-black/70 focus:outline-none focus:border-navy"
        />
        <button
          type="button"
          onClick={onCopy}
          disabled={!valid}
          className="text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1.5 border border-navy/30 text-navy hover:bg-navy hover:text-white transition-colors disabled:opacity-40 whitespace-nowrap"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
