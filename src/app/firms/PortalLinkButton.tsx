"use client";

import { useState } from "react";

export default function PortalLinkButton({ firmId }: { firmId: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/portal-link?firmId=${firmId}`);
      const data = await res.json() as { magic_link: string };
      setLink(data.magic_link);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!link) {
    return (
      <button
        onClick={generate}
        disabled={loading}
        className="text-xs text-gold hover:text-gold-2 font-medium disabled:opacity-50"
      >
        {loading ? "..." : "Portal link"}
      </button>
    );
  }

  return (
    <button
      onClick={copy}
      className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
      title={link}
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
