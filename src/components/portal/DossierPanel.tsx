"use client";

/**
 * DossierPanel  -  Phase 2 + 3 of the Dalil-style intelligence dashboard.
 *
 * Phase 2: GPT-generated intelligence brief (engagement label, watchpoints,
 *   demands, next-step recommendation). Triggered on first click, cached in
 *   scoring._dossier, refreshable.
 *
 * Phase 3: Source-anchored citations. Every watchpoint and demand carries a
 *   source_idx that points to the original conversation turn that drove the
 *   insight. Clicking a card highlights that turn in the collapsible transcript.
 */

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface WatchpointItem {
  text: string;
  severity: "high" | "medium" | "low";
  source_idx: number;
}

export interface DemandItem {
  text: string;
  source_idx: number;
}

export interface Dossier {
  engagement_label: string;
  watchpoints: WatchpointItem[];
  demands: DemandItem[];
  next_step: string;
  generated_at: string;
}

interface DossierPanelProps {
  leadId: string;
  firmId: string;
  apiPath: string;
  initialDossier: Dossier | null;
  conversation: ConversationTurn[];
}

// ─── Severity colours ─────────────────────────────────────────────────────────

const SEVERITY_STYLE: Record<string, string> = {
  high:   "bg-red-50   border-red-200   text-red-800",
  medium: "bg-amber-50 border-amber-200 text-amber-800",
  low:    "bg-black/[0.03] border-black/10 text-black/60",
};

const SEVERITY_DOT: Record<string, string> = {
  high:   "bg-red-500",
  medium: "bg-amber-500",
  low:    "bg-black/30",
};

const SEVERITY_LABEL: Record<string, string> = {
  high: "High", medium: "Medium", low: "Low",
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function DossierPanel({
  leadId,
  firmId,
  apiPath,
  initialDossier,
  conversation,
}: DossierPanelProps) {
  const [dossier, setDossier] = useState<Dossier | null>(initialDossier);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 3: source highlighting
  const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, firmId }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      const json = await res.json() as { dossier: Dossier };
      setDossier(json.dossier);
      setHighlightedIdx(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function handleCardClick(sourceIdx: number) {
    setHighlightedIdx(sourceIdx === highlightedIdx ? null : sourceIdx);
    setShowTranscript(true);
    // Scroll the transcript into view after state update
    setTimeout(() => {
      document.getElementById(`transcript-turn-${sourceIdx}`)?.scrollIntoView({
        behavior: "smooth", block: "center",
      });
    }, 50);
  }

  const hasConversation = conversation.length > 0;

  return (
    <div className="bg-white rounded-xl border border-black/5 overflow-hidden">
      {/* Header row */}
      <div className="px-5 py-4 border-b border-black/8 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-black/80">Intelligence Brief</div>
          {dossier ? (
            <div className="text-xs text-black/40 mt-0.5">
              Generated {new Date(dossier.generated_at).toLocaleString("en-CA")}
            </div>
          ) : (
            <div className="text-xs text-black/40 mt-0.5">
              AI-generated watchpoints, client demands, and recommended next step
            </div>
          )}
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition flex-shrink-0 ${
            loading
              ? "bg-black/5 text-black/30 cursor-wait"
              : dossier
              ? "bg-black/5 text-black/60 hover:bg-black/8"
              : "bg-navy text-white hover:bg-navy/90"
          }`}
        >
          {loading ? (
            <>
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Analyzing...
            </>
          ) : dossier ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              </svg>
              Refresh
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
                <path d="M12 8v4l3 3" />
              </svg>
              Generate Brief
            </>
          )}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="px-5 py-3 bg-red-50 border-b border-red-100 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!dossier && !loading && !error && (
        <div className="px-5 py-10 text-center">
          <div className="text-black/20 mb-2">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
              <path d="M12 8v4l3 3" />
            </svg>
          </div>
          <p className="text-sm text-black/40">
            Generate an intelligence brief to surface watchpoints, client demands, and a recommended next step.
          </p>
        </div>
      )}

      {/* Dossier content */}
      {dossier && !loading && (
        <div className="divide-y divide-black/5">
          {/* Engagement label */}
          <div className="px-5 py-4">
            <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest mb-1.5">Engagement signal</div>
            <div className="text-sm font-medium text-black/80">{dossier.engagement_label}</div>
          </div>

          {/* Watchpoints */}
          <div className="px-5 py-4">
            <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest mb-2.5">Watchpoints</div>
            <div className="space-y-2">
              {dossier.watchpoints.map((wp, i) => (
                <button
                  key={i}
                  onClick={() => handleCardClick(wp.source_idx)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border text-xs leading-relaxed transition cursor-pointer ${
                    SEVERITY_STYLE[wp.severity] ?? SEVERITY_STYLE.low
                  } ${highlightedIdx === wp.source_idx ? "ring-2 ring-navy/30" : "hover:opacity-90"}`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${SEVERITY_DOT[wp.severity] ?? SEVERITY_DOT.low}`} />
                    <span className="flex-1">{wp.text}</span>
                    <span className="flex-shrink-0 text-[10px] opacity-60">
                      {SEVERITY_LABEL[wp.severity]}
                      {hasConversation && (
                        <span className="ml-1 opacity-60">↗</span>
                      )}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Client demands */}
          <div className="px-5 py-4">
            <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest mb-2.5">Client demands</div>
            <div className="space-y-2">
              {dossier.demands.map((d, i) => (
                <button
                  key={i}
                  onClick={() => handleCardClick(d.source_idx)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border text-xs leading-relaxed transition cursor-pointer bg-blue-50 border-blue-200 text-blue-800 ${
                    highlightedIdx === d.source_idx ? "ring-2 ring-navy/30" : "hover:opacity-90"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1 flex-shrink-0" />
                    <span className="flex-1">{d.text}</span>
                    {hasConversation && (
                      <span className="flex-shrink-0 text-[10px] opacity-50 ml-1">↗</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Next step */}
          <div className="px-5 py-4 bg-navy/[0.02]">
            <div className="text-[10px] font-semibold text-black/35 uppercase tracking-widest mb-1.5">Recommended next step</div>
            <p className="text-sm text-black/75 leading-relaxed">{dossier.next_step}</p>
          </div>

          {/* Phase 3: Conversation transcript */}
          {hasConversation && (
            <div className="px-5 py-3">
              <button
                onClick={() => setShowTranscript(v => !v)}
                className="flex items-center gap-1.5 text-xs text-black/50 hover:text-black/70 transition"
              >
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2"
                  className={`transition-transform ${showTranscript ? "rotate-90" : ""}`}
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
                {showTranscript ? "Hide" : "Show"} intake transcript ({conversation.length} turns)
                {highlightedIdx != null && !showTranscript && (
                  <span className="ml-1 text-navy font-medium">— source highlighted</span>
                )}
              </button>

              {showTranscript && (
                <div className="mt-3 space-y-2 max-h-96 overflow-y-auto pr-1">
                  {conversation.map((turn, idx) => {
                    const isHighlighted = highlightedIdx === idx;
                    const isUser = turn.role === "user";
                    return (
                      <div
                        key={idx}
                        id={`transcript-turn-${idx}`}
                        onClick={() => setHighlightedIdx(isHighlighted ? null : idx)}
                        className={`px-3 py-2 rounded-lg text-xs leading-relaxed transition cursor-pointer ${
                          isHighlighted
                            ? "bg-amber-100 border border-amber-300 text-amber-900"
                            : isUser
                            ? "bg-black/[0.03] text-black/70"
                            : "bg-blue-50/50 text-black/50"
                        }`}
                      >
                        <span className={`font-semibold mr-1.5 text-[10px] uppercase tracking-wide ${
                          isHighlighted ? "text-amber-700" : isUser ? "text-black/40" : "text-blue-400"
                        }`}>
                          [{idx}] {isUser ? "Client" : "System"}
                        </span>
                        {turn.content}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
