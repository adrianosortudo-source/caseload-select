"use client";

/**
 * CR-21: Release tab (Section 15). Read-only release-preflight dashboard.
 * No Publish button anywhere in this component -- release authorization
 * happens through this codebase's existing, separately-reviewed publishing
 * flows, never from this view. "Run preflight" persists the check results
 * (publishing_package_checks) and updates the package status -- it never
 * publishes anything.
 */
import { useState } from "react";
import type { PieceReleaseGates, ReleaseGateName } from "@/lib/publishing-package-control-room-release";

interface ReleaseTabViewProps {
  pieces: PieceReleaseGates[];
  firmId?: string;
  periodId?: string;
  /** Only true on the real route; the fixture preview never sets this, keeping its Release tab strictly read-only (no database to persist to). */
  canRun?: boolean;
}

const GATE_LABEL: Record<ReleaseGateName, string> = {
  editorial: "Editorial",
  asset: "Asset",
  experience: "Experience",
  publication: "Publication",
};

export default function ReleaseTabView({ pieces, firmId, periodId, canRun }: ReleaseTabViewProps) {
  const releaseReadyCount = pieces.filter((p) => p.allPass).length;
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [running, setRunning] = useState(false);

  async function runPreflight() {
    if (!firmId || !periodId) return;
    setRunning(true);
    try {
      const res = await fetch(`/api/portal/${firmId}/periods/${periodId}/package-preflight-run`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ kind: "error", message: (json as { error?: string }).error ?? `HTTP ${res.status}` });
        return;
      }
      setResult({
        kind: "success",
        message: `Preflight persisted -- ${json.piecesClear} clear, ${json.piecesBlocked} blocked. Package status: ${json.packageStatus}.`,
      });
    } catch (err) {
      setResult({ kind: "error", message: err instanceof Error ? err.message : "preflight run failed" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <section aria-labelledby="control-room-release-heading" className="space-y-4">
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 id="control-room-release-heading" className="text-sm font-semibold text-navy">
            Release preflight -- {releaseReadyCount} of {pieces.length} pieces clear
          </h2>
          {canRun && (
            <button
              type="button"
              onClick={runPreflight}
              disabled={running}
              className="text-[11px] font-medium text-navy border border-navy/30 px-2 py-1 hover:bg-navy/5 disabled:opacity-50"
            >
              {running ? "Running..." : "Run preflight"}
            </button>
          )}
        </div>
        <p className="text-xs text-black/50 border border-black/10 bg-parchment-2 px-3 py-2 mt-2">
          HTTP success, passing tests, asset upload, visual selection, and portal rendering are not approval or publication authorization.
        </p>
        {result && (
          <div className={`text-xs px-2.5 py-1.5 border mt-2 ${result.kind === "success" ? "border-navy/30 bg-navy/5 text-navy" : "border-red-300 bg-red-50 text-red-800"}`}>
            {result.message}
          </div>
        )}
      </div>

      <ul className="space-y-3">
        {pieces.map((piece) => (
          <li key={piece.contentSlotId} className={`border p-3.5 ${piece.allPass ? "border-black/8 bg-white" : "border-red-200 bg-red-50/30"}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <span className="font-medium text-navy">{piece.pieceTitle}</span>
              <span className={`text-[11px] font-semibold uppercase tracking-wider ${piece.allPass ? "text-navy" : "text-red-800"}`}>
                {piece.allPass ? "Release ready" : "Blocked"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {piece.gates.map((gate) => (
                <div key={gate.gate} className={`border p-2 text-xs ${gate.allPass ? "border-black/10" : "border-red-300"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-navy/80">{GATE_LABEL[gate.gate]}</span>
                    <span className={gate.allPass ? "text-black/40" : "text-red-800 font-semibold"}>
                      {gate.allPass ? "pass" : "fail"}
                    </span>
                  </div>
                  {!gate.allPass && (
                    <ul className="space-y-0.5">
                      {gate.checks
                        .filter((c) => c.status === "fail")
                        .map((c) => (
                          <li key={c.checkKey} className="text-red-800">
                            <span className="font-mono text-[10px]">{c.reasonCode}</span> -- {c.message}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
