"use client";

import { useState, useRef, useEffect } from "react";
import WebsiteDesignCheckReport, { type DesignCheckResult } from "./WebsiteDesignCheckReport";

/**
 * The report is shown as soon as the scan completes. The earlier email gate
 * collected an address locally and discarded it, so it added friction without
 * providing a user benefit or a consented lead path.
 */
type Step = "input" | "scanning" | "report";

const SCAN_PHASES = [
  "Connecting to site",
  "Rendering at mobile and desktop widths",
  "Measuring typography, contrast, and spacing",
  "Checking forms and mobile usability",
  "Reading authority and positioning signals",
  "Running the design-judgment pass",
  "Scoring and ranking findings",
];

export default function WebsiteDesignCheckTool() {
  const [step, setStep] = useState<Step>("input");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<DesignCheckResult | null>(null);
  const [scanPhase, setScanPhase] = useState(0);
  const phaseInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (phaseInterval.current) clearInterval(phaseInterval.current);
    };
  }, []);

  async function handleScan() {
    const trimmed = domain.trim();
    if (!trimmed) {
      setError("Enter a domain to check.");
      return;
    }

    setError("");
    setStep("scanning");
    setScanPhase(0);

    phaseInterval.current = setInterval(() => {
      setScanPhase((prev) => (prev < SCAN_PHASES.length - 1 ? prev + 1 : prev));
    }, 2200);

    try {
      const res = await fetch("/api/tools/website-design-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: trimmed }),
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
      setStep("report");
    } catch {
      if (phaseInterval.current) clearInterval(phaseInterval.current);
      setError("Network error. Check your connection and try again.");
      setStep("input");
    }
  }

  function handleReset() {
    setStep("input");
    setDomain("");
    setResult(null);
    setError("");
    setScanPhase(0);
  }

  return (
    <div className="dc-tool" aria-busy={step === "scanning"}>
      {step === "input" && (
        <div className="dc-input-card" data-ui-component-content="website-input">
          <label className="dc-field-label" htmlFor="dc-domain-input">Public website URL</label>
          <div className="dc-input-row">
            <div className="dc-input-field-wrap">
              {!/^https?:\/\//i.test(domain.trim()) && <span className="dc-input-prefix" aria-hidden="true">https://</span>}
              <input
                id="dc-domain-input"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "dc-domain-error dc-domain-hint" : "dc-domain-hint"}
                className="dc-input-field"
                placeholder="yourfirm.ca"
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleScan()}
                autoFocus
              />
            </div>
            <button type="button" className="dc-scan-btn" onClick={handleScan}>
              Check my site
            </button>
          </div>
          {error && <p id="dc-domain-error" className="dc-error" role="alert" data-ui-copy="supporting">{error}</p>}
          <p id="dc-domain-hint" className="dc-input-hint" data-ui-copy="supporting">
            Renders your homepage in a real browser at mobile and desktop widths, then measures typography, contrast, spacing,
            forms, and authority signals against a fixed rubric.
          </p>
        </div>
      )}

      {step === "scanning" && (
        <div className="dc-scanning">
          <div className="dc-scanning-card" role="status" aria-live="polite" data-ui-component-content="scan-status">
            <div className="dc-spinner" aria-hidden="true" />
            <h2 className="dc-scanning-domain">{domain}</h2>
            <div className="dc-phases">
              {SCAN_PHASES.map((phase, i) => (
                <div key={i} className={`dc-phase ${i < scanPhase ? "dc-phase-done" : i === scanPhase ? "dc-phase-active" : "dc-phase-pending"}`}>
                  <span className="dc-phase-dot" />
                  <span className="dc-phase-label">{phase}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === "report" && result && <WebsiteDesignCheckReport result={result} onReset={handleReset} />}


    </div>
  );
}
