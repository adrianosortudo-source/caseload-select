"use client";

import { useState } from "react";

type DomainState = {
  domain: string | null;
  verified: boolean | null;
};

type DnsInstructions = {
  type: string;
  name: string;
  value: string;
  note: string;
};

export default function DomainManager({
  firmId,
  firmName,
  initialDomain,
}: {
  firmId: string;
  firmName: string;
  initialDomain: string | null;
}) {
  const [state, setState] = useState<DomainState>({
    domain: initialDomain,
    verified: null,
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dns, setDns] = useState<DnsInstructions | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [removed, setRemoved] = useState(false);

  async function add() {
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firm_id: firmId, domain: input.trim() }),
      });
      const data = await res.json() as {
        ok?: boolean;
        error?: string;
        domain?: string;
        verified?: boolean;
        dns?: DnsInstructions;
      };
      if (!res.ok || data.error) {
        setError(data.error ?? "Failed to add domain");
        return;
      }
      setState({ domain: data.domain ?? input.trim(), verified: data.verified ?? false });
      setDns(data.dns ?? null);
      setShowAdd(false);
      setInput("");
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${state.domain} from ${firmName}? The DNS record can remain but routing will stop.`)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/domain", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firm_id: firmId }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Failed to remove domain");
        return;
      }
      setState({ domain: null, verified: null });
      setDns(null);
      setRemoved(true);
      setTimeout(() => setRemoved(false), 3000);
    } finally {
      setLoading(false);
    }
  }

  if (state.domain) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <code className="text-xs bg-black/5 px-2 py-1 rounded font-mono">{state.domain}</code>
          {state.verified === true && (
            <span className="badge bg-emerald-50 text-emerald-700">Verified</span>
          )}
          {state.verified === false && (
            <span className="badge bg-amber-50 text-amber-700">DNS pending</span>
          )}
          <button
            onClick={remove}
            disabled={loading}
            className="text-xs text-rose-500 hover:text-rose-700 font-medium disabled:opacity-50"
          >
            {loading ? "..." : "Remove"}
          </button>
        </div>

        {dns && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 space-y-2">
            <div className="text-xs font-semibold text-amber-800">DNS setup required</div>
            <div className="font-mono text-xs text-amber-900 space-y-1">
              <div>Type: <span className="font-semibold">{dns.type}</span></div>
              <div>Name: <span className="font-semibold">{dns.name}</span></div>
              <div>Value: <span className="font-semibold">{dns.value}</span></div>
            </div>
            <p className="text-xs text-amber-700">{dns.note}</p>
          </div>
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    );
  }

  if (showAdd) {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="intake.firmdomain.ca"
            className="flex-1 border border-black/12 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-navy/20"
            autoFocus
          />
          <button
            onClick={add}
            disabled={loading || !input.trim()}
            className="px-3 py-1.5 rounded bg-navy text-white text-xs font-medium disabled:opacity-50"
          >
            {loading ? "..." : "Add"}
          </button>
          <button
            onClick={() => { setShowAdd(false); setInput(""); setError(null); }}
            className="px-2 py-1.5 rounded text-xs text-black/40 hover:text-black/70"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-black/20 text-xs"> - </span>
      <button
        onClick={() => setShowAdd(true)}
        className="text-xs text-gold hover:text-gold-2 font-medium"
      >
        Add domain
      </button>
      {removed && <span className="text-xs text-emerald-600">Removed</span>}
    </div>
  );
}
