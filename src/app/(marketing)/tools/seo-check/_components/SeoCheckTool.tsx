"use client";

import { useState, useRef, useEffect } from "react";
import SeoReport, { type SeoCheckResult } from "./SeoReport";

type Step = "input" | "scanning" | "email" | "report";
type ScanMode = "quick" | "standard" | "deep";

interface SavedRunSummary {
  id: string;
  domain: string;
  scan_mode: string;
  pages_scanned: number;
  overall_score: number | null;
  ai_search_score: number | null;
  ai_policy_score: number | null;
  grade: string | null;
  rendering_risk: string | null;
  issue_count: number;
  created_at: string;
}

const SCAN_MODE_PAGES: Record<ScanMode, number> = { quick: 10, standard: 25, deep: 50 };

const SCAN_PHASES = [
  "Connecting to site",
  "Fetching robots.txt and llms.txt",
  "Scanning homepage",
  "Discovering internal links and sitemaps",
  "Crawling commercial pages",
  "Running indexability and schema engines",
  "Analyzing AI visibility signals",
  "Scoring and ranking issues",
  "Building the diagnostic",
];

export default function SeoCheckTool({
  variant = "public",
}: {
  variant?: "public" | "operator";
}) {
  const isOperator = variant === "operator";
  const [step, setStep] = useState<Step>("input");
  const [domain, setDomain] = useState("");
  const [scanMode, setScanMode] = useState<ScanMode>("quick");
  const [targetKeyword, setTargetKeyword] = useState("");
  const [targetMatter, setTargetMatter] = useState("");
  const [targetLocation, setTargetLocation] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SeoCheckResult | null>(null);
  const [scanPhase, setScanPhase] = useState(0);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const phaseInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Saved scan history (operator only). Loaded on mount and refreshed after a save.
  const [history, setHistory] = useState<SavedRunSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Open by default: while loading (so the section isn't blank) and once
  // saved scans exist. An operator can still collapse it away manually.
  const [historyOpen, setHistoryOpen] = useState(true);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    return () => {
      if (phaseInterval.current) clearInterval(phaseInterval.current);
    };
  }, []);

  async function loadHistory() {
    if (!isOperator) return;
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/admin/seo-check/runs?limit=15");
      const data = await res.json();
      if (res.ok) setHistory(data.items ?? []);
    } catch {
      // Best-effort. History is a convenience, not a blocking dependency.
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (isOperator) loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOperator]);

  async function handleLoadRun(id: string) {
    setLoadingRunId(id);
    try {
      const res = await fetch(`/api/admin/seo-check/runs?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok || !data.run) return;
      setResult(data.run.result);
      setDomain(data.run.domain);
      setSaveState("idle");
      setStep("report");
    } finally {
      setLoadingRunId(null);
    }
  }

  async function handleSaveRun() {
    if (!result) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/admin/seo-check/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      if (!res.ok) {
        setSaveState("error");
        return;
      }
      setSaveState("saved");
      loadHistory();
    } catch {
      setSaveState("error");
    }
  }

  function handleDownloadJson() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seo-check-${result.domain}-${new Date(result.checkedAt).toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleScan() {
    const trimmed = domain.trim();
    if (!trimmed) {
      setError("Enter a domain to check.");
      return;
    }

    setError("");
    setStep("scanning");
    setScanPhase(0);

    // Deeper scans take longer, so let the phase indicator advance more slowly.
    const phaseMs = isOperator ? (scanMode === "deep" ? 2600 : scanMode === "standard" ? 1700 : 1100) : 1000;
    phaseInterval.current = setInterval(() => {
      setScanPhase((prev) => (prev < SCAN_PHASES.length - 1 ? prev + 1 : prev));
    }, phaseMs);

    try {
      const intentPayload = {
        ...(targetKeyword.trim() ? { targetKeyword: targetKeyword.trim() } : {}),
        ...(targetMatter.trim() ? { targetMatter: targetMatter.trim() } : {}),
        ...(targetLocation.trim() ? { targetLocation: targetLocation.trim() } : {}),
        ...(targetKeyword.trim() || targetMatter.trim() ? { targetAudience: "Legal clients searching for help with this matter" } : {}),
      };
      const res = await fetch("/api/tools/seo-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isOperator ? { domain: trimmed, scanMode, ...intentPayload } : { domain: trimmed }),
      });

      if (phaseInterval.current) clearInterval(phaseInterval.current);
      setScanPhase(SCAN_PHASES.length - 1);

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Check failed. Try again.");
        setStep("input");
        return;
      }

      setResult(data);
      setSaveState("idle");
      await new Promise((r) => setTimeout(r, 600));
      // The email step is a prospect lead-capture gate; operators skip straight
      // to the report.
      setStep(isOperator ? "report" : "email");
    } catch {
      if (phaseInterval.current) clearInterval(phaseInterval.current);
      setError("Network error. Check your connection and try again.");
      setStep("input");
    }
  }

  function handleEmailSubmit() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError("");
    setStep("report");
  }

  function handleSkipEmail() {
    setStep("report");
  }

  function handleReset() {
    setStep("input");
    setDomain("");
    setResult(null);
    setEmail("");
    setError("");
    setEmailError("");
    setScanPhase(0);
    setTargetKeyword("");
    setTargetMatter("");
    setTargetLocation("");
    setSaveState("idle");
  }

  return (
    <div className="seo-tool">
      {step === "input" && (
        <div className="seo-input-card">
          <div className="seo-input-row">
            <div className="seo-input-field-wrap">
              <span className="seo-input-prefix">https://</span>
              <input
                type="text"
                className="seo-input-field"
                placeholder={isOperator ? "firm-or-prospect.ca" : "yourfirm.ca"}
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleScan()}
                autoFocus
              />
            </div>
            <button className="seo-scan-btn" onClick={handleScan}>
              {isOperator ? "Run check" : "Check my site"}
            </button>
          </div>
          {error && <p className="seo-error">{error}</p>}
          {isOperator && (
            <div className="seo-operator-panel">
              <div className="seo-operator-row">
                <label className="seo-operator-label" htmlFor="seo-scanmode">Scan depth</label>
                <select
                  id="seo-scanmode"
                  className="seo-operator-select"
                  value={scanMode}
                  onChange={(e) => setScanMode(e.target.value as ScanMode)}
                >
                  <option value="quick">Quick ({SCAN_MODE_PAGES.quick} pages)</option>
                  <option value="standard">Standard ({SCAN_MODE_PAGES.standard} pages)</option>
                  <option value="deep">Deep ({SCAN_MODE_PAGES.deep} pages)</option>
                </select>
                <span className="seo-operator-note">Deeper scans take longer. Cap is 75 pages.</span>
              </div>
              <div className="seo-intent-stack">
                <label className="seo-intent-field seo-intent-field-full">
                  <span>Target search intent</span>
                  <input value={targetKeyword} onChange={(e) => setTargetKeyword(e.target.value)} placeholder="estate litigation lawyer Toronto" />
                </label>
                <div className="seo-intent-grid-2">
                  <label className="seo-intent-field">
                    <span>Target matter</span>
                    <input value={targetMatter} onChange={(e) => setTargetMatter(e.target.value)} placeholder="estate litigation" />
                  </label>
                  <label className="seo-intent-field">
                    <span>Target location</span>
                    <input value={targetLocation} onChange={(e) => setTargetLocation(e.target.value)} placeholder="Toronto, Ontario" />
                  </label>
                </div>
              </div>
              <p className="seo-operator-subhint">
                Intent fields are optional. Use them when auditing a specific practice area or market; leave blank for a general site audit.
              </p>
              <p className="seo-operator-subhint">
                Checks crawlability, schema, AI search readiness, local SEO, legal-marketing signals, security headers, performance, and page coverage.
              </p>
            </div>
          )}
          <p className="seo-input-hint">
            {isOperator
              ? "Internal diagnostic. Runs a bounded crawl and checks nine categories per page (on-page, indexability, schema, AI visibility, legal marketing, local SEO, technical, performance, links). The report includes a prospecting summary and outreach angles for internal use."
              : "Enter any law firm website. We run a mini-crawl and check SEO, AI visibility, schema, local search, performance, and security signals on each page."}
          </p>
        </div>
      )}

      {isOperator && step === "input" && (
        <div className="seo-history">
          <button type="button" className="seo-history-toggle" onClick={() => setHistoryOpen((v) => !v)}>
            {historyOpen ? "▴" : "▾"} Recent saved scans {history.length > 0 ? `(${history.length})` : ""}
          </button>
          {historyOpen && (
            <div className="seo-history-panel">
              {historyLoading && <p className="seo-history-empty">Loading...</p>}
              {!historyLoading && history.length === 0 && (
                <p className="seo-history-empty">No saved scans yet. Run a check and save it from the report.</p>
              )}
              {!historyLoading && history.length > 0 && (
                <ul className="seo-history-list">
                  {history.map((run) => (
                    <li key={run.id} className="seo-history-row">
                      <button
                        type="button"
                        className="seo-history-row-btn"
                        onClick={() => handleLoadRun(run.id)}
                        disabled={loadingRunId === run.id}
                      >
                        <span className="seo-history-domain">{run.domain}</span>
                        <span className="seo-history-meta">
                          {run.grade ?? "?"} {run.overall_score ?? "?"}/100 · {run.scan_mode} · {run.pages_scanned}p
                          {run.issue_count > 0 ? ` · ${run.issue_count} issues` : ""}
                        </span>
                        <span className="seo-history-date">
                          {new Date(run.created_at).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {step === "scanning" && (
        <div className="seo-scanning">
          <div className="seo-scanning-card">
            <div className="seo-spinner" />
            <h3 className="seo-scanning-domain">{domain}</h3>
            <div className="seo-phases">
              {SCAN_PHASES.map((phase, i) => (
                <div
                  key={i}
                  className={`seo-phase ${i < scanPhase ? "seo-phase-done" : i === scanPhase ? "seo-phase-active" : "seo-phase-pending"}`}
                >
                  <span className="seo-phase-dot" />
                  <span className="seo-phase-label">{phase}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === "email" && result && (
        <div className="seo-email-gate">
          <div className="seo-email-card">
            <div className="seo-email-preview">
              <div className="seo-email-grade-peek">
                <span
                  className="seo-email-grade-letter"
                  style={{
                    color:
                      result.overallScore >= 70
                        ? "var(--navy)"
                        : result.overallScore >= 40
                          ? "var(--stone-on-light)"
                          : "var(--danger)",
                  }}
                >
                  {result.grade}
                </span>
                <span className="seo-email-grade-score">{result.overallScore}/100</span>
              </div>
              <p className="seo-email-preview-text">
                Your report for <strong>{result.domain}</strong> is ready.
              </p>
            </div>
            <div className="seo-email-form">
              <h3 className="seo-email-title">Enter your email to view the report</h3>
              <p className="seo-email-sub">
                Get the detailed breakdown across all nine categories, AI bot access status,
                and recommended fixes ranked by priority.
              </p>
              <div className="seo-email-row">
                <input
                  type="email"
                  className="seo-email-input"
                  placeholder="you@yourfirm.ca"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleEmailSubmit()}
                  autoFocus
                />
                <button className="seo-email-btn" onClick={handleEmailSubmit}>
                  View report
                </button>
              </div>
              {emailError && <p className="seo-error">{emailError}</p>}
              <button className="seo-skip-link" onClick={handleSkipEmail}>
                Skip, show me the report
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "report" && result && (
        <>
          {isOperator && (
            <div className="seo-history-bar">
              <button type="button" className="seo-mini-btn" onClick={handleSaveRun} disabled={saveState === "saving"}>
                {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed, retry" : "Save this scan"}
              </button>
              <button type="button" className="seo-mini-btn" onClick={handleDownloadJson}>
                Download JSON
              </button>
            </div>
          )}
          <SeoReport result={result} onReset={handleReset} hideCta={isOperator} showInternal={isOperator} />
        </>
      )}

      <style>{`
        .seo-tool { width: 100%; }

        /* ── Input ────────────────────────────────────── */
        .seo-input-card {
          max-width: 640px;
          margin: 0 auto;
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          padding: var(--sp-6);
        }
        .seo-input-row {
          display: flex;
          gap: var(--sp-3);
          margin-bottom: var(--sp-3);
        }
        .seo-input-field-wrap {
          flex: 1;
          display: flex;
          align-items: center;
          border: 1.5px solid var(--border);
          border-radius: var(--r-tight);
          overflow: hidden;
          background: var(--parchment);
          transition: border-color 0.2s;
        }
        .seo-input-field-wrap:focus-within {
          border-color: var(--navy);
        }
        .seo-input-prefix {
          font-family: var(--font-body);
          font-size: 14px;
          color: var(--text-muted);
          padding: 0 0 0 14px;
          user-select: none;
        }
        .seo-input-field {
          flex: 1;
          font-family: var(--font-body);
          font-size: 15px;
          color: var(--text);
          padding: 14px 14px 14px 4px;
          border: none;
          outline: none;
          background: transparent;
        }
        .seo-input-field::placeholder { color: var(--text-muted); opacity: 0.5; }
        .seo-scan-btn {
          font-family: var(--font-display);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: var(--ls-button);
          text-transform: uppercase;
          color: var(--white);
          background: var(--navy);
          border: none;
          padding: 14px 28px;
          border-radius: var(--r-tight);
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.2s;
        }
        .seo-scan-btn:hover { background: var(--navy-deep); }
        .seo-error {
          font-size: 13px;
          color: var(--danger);
          margin: var(--sp-2) 0 0;
        }
        .seo-input-hint {
          font-size: 12.5px;
          color: var(--text-muted);
          margin: var(--sp-3) 0 0;
          line-height: 1.55;
        }

        /* ── Scan history (operator only) ────────────── */
        .seo-history {
          max-width: 640px;
          margin: var(--sp-3) auto 0;
        }
        .seo-history-toggle {
          font-family: var(--font-display);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: var(--text-muted);
          background: none;
          border: none;
          cursor: pointer;
          padding: var(--sp-2) 0;
        }
        .seo-history-toggle:hover { color: var(--navy); }
        .seo-history-panel {
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          margin-top: var(--sp-2);
          overflow: hidden;
        }
        .seo-history-empty {
          font-size: 12.5px;
          color: var(--text-muted);
          padding: var(--sp-4);
          margin: 0;
          text-align: center;
        }
        .seo-history-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .seo-history-row { border-bottom: 1px solid var(--border-soft); }
        .seo-history-row:last-child { border-bottom: none; }
        .seo-history-row-btn {
          width: 100%;
          display: flex;
          align-items: center;
          gap: var(--sp-3);
          padding: var(--sp-3) var(--sp-4);
          background: none;
          border: none;
          cursor: pointer;
          text-align: left;
          transition: background 0.15s;
        }
        .seo-history-row-btn:hover { background: var(--parchment); }
        .seo-history-row-btn:disabled { opacity: 0.5; cursor: default; }
        .seo-history-domain {
          font-family: var(--font-display);
          font-size: 13px;
          font-weight: 700;
          color: var(--navy);
          flex-shrink: 0;
        }
        .seo-history-meta {
          font-size: 12px;
          color: var(--text-muted);
          flex: 1;
          min-width: 0;
        }
        .seo-history-date {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .seo-history-bar {
          max-width: 880px;
          margin: 0 auto var(--sp-3);
          display: flex;
          gap: var(--sp-2);
          justify-content: flex-end;
        }
        .seo-operator-panel {
          border-top: 1px solid var(--border);
          margin-top: var(--sp-3);
          padding-top: var(--sp-3);
        }
        .seo-operator-row {
          display: flex;
          align-items: center;
          gap: var(--sp-3);
        }
        .seo-operator-label {
          font-family: var(--font-display);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: var(--ls-eyebrow);
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .seo-operator-select {
          font-family: var(--font-body);
          font-size: 13px;
          color: var(--text);
          padding: 7px 12px;
          border: 1.5px solid var(--border);
          border-radius: var(--r-tight);
          background: var(--white);
          cursor: pointer;
          outline: none;
        }
        .seo-operator-select:focus { border-color: var(--navy); }
        .seo-operator-note { font-size: 11.5px; color: var(--text-muted); }
        .seo-intent-stack {
          display: flex;
          flex-direction: column;
          gap: var(--sp-3);
          margin-top: var(--sp-3);
        }
        .seo-intent-grid-2 {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--sp-3);
        }
        .seo-operator-subhint {
          font-size: 11.5px;
          color: var(--text-muted);
          line-height: 1.5;
          margin: var(--sp-2) 0 0;
        }
        .seo-intent-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-family: var(--font-display);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.7px;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .seo-intent-field input {
          min-width: 0;
          border: 1px solid var(--border);
          border-radius: var(--r-tight);
          background: var(--parchment);
          color: var(--text);
          padding: 10px 11px;
          font: 14px var(--font-body);
          text-transform: none;
          letter-spacing: 0;
          outline: none;
        }
        .seo-intent-field input:focus { border-color: var(--navy); }

        /* ── Scanning ────────────────────────────────── */
        .seo-scanning {
          max-width: 480px;
          margin: 0 auto;
        }
        .seo-scanning-card {
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          padding: var(--sp-7) var(--sp-6);
          text-align: center;
        }
        .seo-spinner {
          width: 40px;
          height: 40px;
          border: 3px solid var(--border);
          border-top-color: var(--navy);
          border-radius: 50%;
          margin: 0 auto var(--sp-5);
          animation: seo-spin 0.8s linear infinite;
        }
        @keyframes seo-spin { to { transform: rotate(360deg); } }
        .seo-scanning-domain {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 700;
          color: var(--navy);
          margin: 0 0 var(--sp-5);
        }
        .seo-phases {
          text-align: left;
          display: flex;
          flex-direction: column;
          gap: var(--sp-2);
        }
        .seo-phase {
          display: flex;
          align-items: center;
          gap: var(--sp-2);
          transition: opacity 0.3s;
        }
        .seo-phase-pending { opacity: 0.3; }
        .seo-phase-active { opacity: 1; }
        .seo-phase-done { opacity: 0.6; }
        .seo-phase-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .seo-phase-active .seo-phase-dot {
          background: var(--navy);
          animation: seo-pulse 1s ease-in-out infinite;
        }
        .seo-phase-done .seo-phase-dot { background: var(--stone); }
        .seo-phase-pending .seo-phase-dot { background: var(--border); }
        @keyframes seo-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.4); }
        }
        .seo-phase-label {
          font-size: 13px;
          color: var(--text);
        }
        .seo-phase-active .seo-phase-label { font-weight: 600; }

        /* ── Email gate ──────────────────────────────── */
        .seo-email-gate {
          max-width: 560px;
          margin: 0 auto;
        }
        .seo-email-card {
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          overflow: hidden;
        }
        .seo-email-preview {
          background: var(--parchment);
          padding: var(--sp-6);
          text-align: center;
          border-bottom: 1px solid var(--border);
        }
        .seo-email-grade-peek {
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: var(--sp-2);
          margin-bottom: var(--sp-3);
        }
        .seo-email-grade-letter {
          font-family: var(--font-display);
          font-size: 48px;
          font-weight: 800;
          line-height: 1;
        }
        .seo-email-grade-score {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 700;
          color: var(--text-muted);
        }
        .seo-email-preview-text {
          font-size: 14.5px;
          color: var(--text-muted);
          margin: 0;
        }
        .seo-email-preview-text strong { color: var(--text); }
        .seo-email-form { padding: var(--sp-6); }
        .seo-email-title {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 700;
          color: var(--navy);
          margin: 0 0 var(--sp-2);
        }
        .seo-email-sub {
          font-size: 13.5px;
          color: var(--text-muted);
          line-height: 1.55;
          margin: 0 0 var(--sp-4);
        }
        .seo-email-row {
          display: flex;
          gap: var(--sp-3);
          margin-bottom: var(--sp-3);
        }
        .seo-email-input {
          flex: 1;
          font-family: var(--font-body);
          font-size: 14px;
          color: var(--text);
          padding: 12px 14px;
          border: 1.5px solid var(--border);
          border-radius: var(--r-tight);
          outline: none;
          transition: border-color 0.2s;
        }
        .seo-email-input:focus { border-color: var(--navy); }
        .seo-email-input::placeholder { color: var(--text-muted); opacity: 0.5; }
        .seo-email-btn {
          font-family: var(--font-display);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: var(--ls-button);
          text-transform: uppercase;
          color: var(--white);
          background: var(--navy);
          border: none;
          padding: 12px 24px;
          border-radius: var(--r-tight);
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.2s;
        }
        .seo-email-btn:hover { background: var(--navy-deep); }
        .seo-skip-link {
          font-family: var(--font-body);
          font-size: 12px;
          color: var(--text-muted);
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .seo-skip-link:hover { color: var(--navy); }

        @media (max-width: 640px) {
          .seo-input-row { flex-direction: column; }
          .seo-intent-grid-2 { grid-template-columns: 1fr; }
          .seo-email-row { flex-direction: column; }
          .seo-input-card { padding: var(--sp-5) var(--sp-4); }
          .seo-scanning-card { padding: var(--sp-6) var(--sp-4); }
          .seo-email-form { padding: var(--sp-5) var(--sp-4); }
          .seo-email-preview { padding: var(--sp-5) var(--sp-4); }
        }
      `}</style>
    </div>
  );
}
