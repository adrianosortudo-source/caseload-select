"use client";

import { useState, useRef, useEffect } from "react";
import SeoReport from "./SeoReport";

interface CheckItem {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
}

interface CategoryResult {
  name: string;
  score: number;
  maxScore: number;
  items: CheckItem[];
}

interface AiBotStatus {
  name: string;
  blocked: boolean;
  category: "search" | "training";
}

interface PageResult {
  url: string;
  title: string | null;
  pageScore: number;
  pageGrade: string;
  aiVisibilityScore: number;
  categories: CategoryResult[];
  failCount: number;
  warnCount: number;
}

interface TopFix {
  label: string;
  category: string;
  status: "warn" | "fail";
  fix?: string;
  pagesAffected: number;
  totalPages: number;
}

interface SeoCheckResult {
  domain: string;
  pagesScanned: number;
  pages: PageResult[];
  categories: CategoryResult[];
  overallScore: number;
  grade: string;
  aiSearchScore: number;
  aiSearchGrade: string;
  aiPolicyScore: number;
  aiPolicyGrade: string;
  aiBots: AiBotStatus[];
  topFixes: TopFix[];
  checkedAt: string;
}

type Step = "input" | "scanning" | "email" | "report";

const SCAN_PHASES = [
  "Connecting to site",
  "Fetching robots.txt and llms.txt",
  "Scanning homepage",
  "Discovering internal links and sitemaps",
  "Selecting pages to scan",
  "Scanning additional pages",
  "Analyzing AI visibility signals",
  "Checking schema and local SEO",
  "Calculating scores",
];

export default function SeoCheckTool() {
  const [step, setStep] = useState<Step>("input");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SeoCheckResult | null>(null);
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
    }, 1000);

    try {
      const res = await fetch("/api/tools/seo-check", {
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
      await new Promise((r) => setTimeout(r, 600));
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
    <div className="seo-tool">
      {step === "input" && (
        <div className="seo-input-card">
          <div className="seo-input-row">
            <div className="seo-input-field-wrap">
              <span className="seo-input-prefix">https://</span>
              <input
                type="text"
                className="seo-input-field"
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
            <button className="seo-scan-btn" onClick={handleScan}>
              Check my site
            </button>
          </div>
          {error && <p className="seo-error">{error}</p>}
          <p className="seo-input-hint">
            Enter any law firm website. We run a mini-crawl of up to 5 pages and check
            49 signals per page across SEO, AI visibility, schema, local search, performance, and security.
          </p>
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
                Get the detailed breakdown with all 49 check results, AI bot access status,
                and recommended fixes for every issue.
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

      {step === "report" && result && <SeoReport result={result} onReset={handleReset} />}

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
