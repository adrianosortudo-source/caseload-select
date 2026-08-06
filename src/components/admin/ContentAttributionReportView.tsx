"use client";

import { useEffect, useState } from "react";

interface ReportResponse {
  ok: true;
  range: { from: string | null; to: string | null };
  published_deliverables: { id: string; title: string; status: string }[];
  placements: { id: string; deliverable_id: string; destination: string; state: string }[];
  enquiries: {
    total: number;
    attribution_breakdown: Record<string, number>;
    unknown_volume: number;
    sufficient_sample: boolean;
    min_sample_for_observation: number;
  };
  outcome_signals: Record<string, number>;
  what_we_learned: string[];
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Phase 4 reporting layer client. Observation and recommendation stay
 * separate sections; "what we learned" only ever comes from the API's
 * own data-sufficiency-gated computation, never invented here.
 */
export default function ContentAttributionReportView({ firmId }: { firmId: string }) {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setState("loading");
    setError(null);
    try {
      const params = new URLSearchParams({ firm_id: firmId, from, to });
      const res = await fetch(`/api/admin/content-performance/report?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setState("error");
        setError(json.error ?? "Could not load report.");
        return;
      }
      setReport(json as ReportResponse);
      setState("idle");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Network error.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded border border-black/8 bg-white p-5 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-black/50 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-black/12 rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-black/50 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-black/12 rounded px-2 py-1 text-sm" />
        </div>
        <button
          type="button"
          onClick={load}
          disabled={state === "loading"}
          className="text-xs font-semibold text-navy bg-black/5 hover:bg-black/10 rounded px-3 py-1.5 disabled:opacity-50"
        >
          {state === "loading" ? "Loading..." : "Run report"}
        </button>
      </div>

      {error && <div className="text-sm text-rose-600">{error}</div>}

      {report && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded border border-black/8 bg-white p-5">
              <div className="text-xs uppercase tracking-wider text-black/50">Enquiries in range</div>
              <div className="mt-2 text-2xl font-semibold">{report.enquiries.total}</div>
            </div>
            <div className="rounded border border-black/8 bg-white p-5">
              <div className="text-xs uppercase tracking-wider text-black/50">Unknown volume</div>
              <div className="mt-2 text-2xl font-semibold">{report.enquiries.unknown_volume}</div>
            </div>
            <div className="rounded border border-black/8 bg-white p-5">
              <div className="text-xs uppercase tracking-wider text-black/50">Published deliverables</div>
              <div className="mt-2 text-2xl font-semibold">{report.published_deliverables.length}</div>
            </div>
            <div className="rounded border border-black/8 bg-white p-5">
              <div className="text-xs uppercase tracking-wider text-black/50">Data sufficiency</div>
              <div className="mt-2 text-sm font-medium">
                {report.enquiries.sufficient_sample
                  ? "Sufficient"
                  : `Below minimum (${report.enquiries.min_sample_for_observation})`}
              </div>
            </div>
          </div>

          <div className="rounded border border-black/8 bg-white p-5">
            <div className="text-sm font-medium mb-3">What we learned</div>
            <div className="text-xs text-black/40 mb-3">
              Observation only, from evidence actually recorded in this range. Not a recommendation.
            </div>
            {report.what_we_learned.length === 0 ? (
              <div className="text-sm text-black/40">
                Insufficient evidence in this range to observe a reliable pattern.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {report.what_we_learned.map((line) => (
                  <li key={line} className="text-sm text-black/70">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {Object.keys(report.outcome_signals).length > 0 && (
            <div className="rounded border border-black/8 bg-white p-5">
              <div className="text-sm font-medium mb-3">Outcome signals (existing matter stages)</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(report.outcome_signals).map(([stage, n]) => (
                  <span key={stage} className="inline-block px-2.5 py-0.5 rounded text-xs font-medium bg-black/5 text-black/70">
                    {stage}: {n}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
