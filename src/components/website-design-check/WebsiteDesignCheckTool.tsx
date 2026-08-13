"use client";

import { useState, useRef, useEffect } from "react";
import WebsiteDesignCheckReport, { type DesignCheckResult } from "./WebsiteDesignCheckReport";

/**
 * State machine and email gate mirror seo-check's SeoCheckTool.tsx exactly
 * (input -> scanning -> email -> report). The email gate is a client-side
 * soft lead-capture prompt only: it is never sent anywhere, matching
 * seo-check's own tool and the explicit 2026-07 operator decision that
 * CRM wiring for this tool comes later, after the tool itself works.
 */
type Step = "input" | "scanning" | "email" | "report";

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
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
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
      await new Promise((r) => setTimeout(r, 500));
      setStep("email");
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
  }

  return (
    <div className="dc-tool">
      {step === "input" && (
        <div className="dc-input-card">
          <div className="dc-input-row">
            <div className="dc-input-field-wrap">
              <span className="dc-input-prefix">https://</span>
              <input
                type="text"
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
            <button className="dc-scan-btn" onClick={handleScan}>
              Check my site
            </button>
          </div>
          {error && <p className="dc-error">{error}</p>}
          <p className="dc-input-hint">
            Renders your homepage in a real browser at mobile and desktop widths, then measures typography, contrast, spacing,
            forms, and authority signals against a fixed rubric.
          </p>
        </div>
      )}

      {step === "scanning" && (
        <div className="dc-scanning">
          <div className="dc-scanning-card">
            <div className="dc-spinner" />
            <h3 className="dc-scanning-domain">{domain}</h3>
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

      {step === "email" && result && (
        <div className="dc-email-gate">
          <div className="dc-email-card">
            <div className="dc-email-preview">
              <div className="dc-email-grade-peek">
                <span
                  className="dc-email-grade-letter"
                  style={{ color: result.letterGrade === "A" || result.letterGrade === "B" ? "var(--navy)" : result.letterGrade === "C" ? "var(--stone-on-light)" : "var(--danger)" }}
                >
                  {result.letterGrade}
                </span>
                <span className="dc-email-grade-score">{result.score}/100</span>
              </div>
              <p className="dc-email-preview-text">
                Your design report for <strong>{result.domain}</strong> is ready.
              </p>
            </div>
            <div className="dc-email-form">
              <h3 className="dc-email-title">Enter your email to view the report</h3>
              <p className="dc-email-sub">
                Get the full breakdown across every measured category, plus the ranked list of specific fixes and what each one is worth.
              </p>
              <div className="dc-email-row">
                <input
                  type="email"
                  className="dc-email-input"
                  placeholder="you@yourfirm.ca"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleEmailSubmit()}
                  autoFocus
                />
                <button className="dc-email-btn" onClick={handleEmailSubmit}>
                  View report
                </button>
              </div>
              {emailError && <p className="dc-error">{emailError}</p>}
              <button className="dc-skip-link" onClick={handleSkipEmail}>
                Skip, show me the report
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "report" && result && <WebsiteDesignCheckReport result={result} onReset={handleReset} />}

      <style>{`
        .dc-tool { width: 100%; }

        .dc-input-card { max-width: 640px; margin: 0 auto; background: var(--white); border: 1px solid var(--border); border-radius: var(--r-card); padding: var(--sp-6); }
        .dc-input-row { display: flex; gap: var(--sp-3); margin-bottom: var(--sp-3); }
        .dc-input-field-wrap { flex: 1; display: flex; align-items: center; border: 1.5px solid var(--border); border-radius: var(--r-tight); overflow: hidden; background: var(--parchment); transition: border-color 0.2s; }
        .dc-input-field-wrap:focus-within { border-color: var(--navy); }
        .dc-input-prefix { font-family: var(--font-body); font-size: 14px; color: var(--text-muted); padding: 0 0 0 14px; user-select: none; }
        .dc-input-field { flex: 1; font-family: var(--font-body); font-size: 15px; color: var(--text); padding: 14px 14px 14px 4px; border: none; outline: none; background: transparent; }
        .dc-input-field::placeholder { color: var(--text-muted); opacity: 0.5; }
        .dc-scan-btn { font-family: var(--font-display); font-size: 12px; font-weight: 700; letter-spacing: var(--ls-button); text-transform: uppercase; color: var(--white); background: var(--navy); border: none; padding: 14px 28px; border-radius: var(--r-tight); cursor: pointer; white-space: nowrap; transition: background 0.2s; }
        .dc-scan-btn:hover { background: var(--navy-deep); }
        .dc-error { font-size: 13px; color: var(--danger); margin: var(--sp-2) 0 0; }
        .dc-input-hint { font-size: 12.5px; color: var(--text-muted); margin: var(--sp-3) 0 0; line-height: 1.55; }

        .dc-scanning { max-width: 640px; margin: 0 auto; }
        .dc-scanning-card { background: var(--white); border: 1px solid var(--border); border-radius: var(--r-card); padding: var(--sp-7); text-align: center; }
        .dc-spinner { width: 40px; height: 40px; border: 3px solid var(--border); border-top-color: var(--navy); border-radius: 50%; margin: 0 auto var(--sp-5); animation: dc-spin 0.9s linear infinite; }
        @keyframes dc-spin { to { transform: rotate(360deg); } }
        .dc-scanning-domain { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--navy); margin: 0 0 var(--sp-6); }
        .dc-phases { display: flex; flex-direction: column; gap: var(--sp-3); text-align: left; max-width: 380px; margin: 0 auto; }
        .dc-phase { display: flex; align-items: center; gap: var(--sp-3); }
        .dc-phase-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--border); }
        .dc-phase-done .dc-phase-dot { background: var(--navy); }
        .dc-phase-active .dc-phase-dot { background: var(--stone-on-light); animation: dc-pulse 1s ease-in-out infinite; }
        @keyframes dc-pulse { 50% { opacity: 0.4; } }
        .dc-phase-label { font-size: 13px; color: var(--text-muted); }
        .dc-phase-done .dc-phase-label { color: var(--text); }
        .dc-phase-active .dc-phase-label { color: var(--navy); font-weight: 600; }

        .dc-email-gate { max-width: 640px; margin: 0 auto; }
        .dc-email-card { background: var(--white); border: 1px solid var(--border); border-radius: var(--r-card); padding: var(--sp-7); text-align: center; }
        .dc-email-preview { margin-bottom: var(--sp-6); padding-bottom: var(--sp-6); border-bottom: 1px solid var(--border); }
        .dc-email-grade-peek { display: flex; align-items: baseline; justify-content: center; gap: var(--sp-2); margin-bottom: var(--sp-3); }
        .dc-email-grade-letter { font-family: var(--font-display); font-size: 40px; font-weight: 800; }
        .dc-email-grade-score { font-size: 14px; color: var(--text-muted); }
        .dc-email-preview-text { font-size: 14px; color: var(--text); margin: 0; }
        .dc-email-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--navy); margin: 0 0 var(--sp-3); }
        .dc-email-sub { font-size: 13px; color: var(--text-muted); line-height: 1.6; margin: 0 0 var(--sp-5); max-width: 440px; margin-left: auto; margin-right: auto; }
        .dc-email-row { display: flex; gap: var(--sp-3); max-width: 400px; margin: 0 auto; }
        .dc-email-input { flex: 1; font-family: var(--font-body); font-size: 14px; padding: 12px 14px; border: 1.5px solid var(--border); border-radius: var(--r-tight); outline: none; background: var(--parchment); }
        .dc-email-input:focus { border-color: var(--navy); }
        .dc-email-btn { font-family: var(--font-display); font-size: 12px; font-weight: 700; letter-spacing: var(--ls-button); text-transform: uppercase; color: var(--white); background: var(--navy); border: none; padding: 0 20px; border-radius: var(--r-tight); cursor: pointer; white-space: nowrap; }
        .dc-email-btn:hover { background: var(--navy-deep); }
        .dc-skip-link { display: block; margin: var(--sp-4) auto 0; font-size: 12.5px; color: var(--text-muted); background: none; border: none; cursor: pointer; text-decoration: underline; }
        .dc-skip-link:hover { color: var(--navy); }

        @media (max-width: 640px) {
          .dc-input-row, .dc-email-row { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}
