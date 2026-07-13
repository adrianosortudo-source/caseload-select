"use client";

import { useState } from "react";

/* ────────────────────────────────────────────────────────
   Types (mirror the API response; new fields optional for
   backward compatibility with older single-page results)
   ──────────────────────────────────────────────────────── */

type Severity = "critical" | "high" | "medium" | "low" | "info";

interface CheckItem {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  fix?: string;
  // Trust-fix pass WI-1/WI-8: false means this check is displayed and still
  // generates a finding, but contributes to no grade.
  scored?: boolean;
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

interface IntentSignal {
  signal: string;
  status: "pass" | "warn" | "fail";
  weight: number;
  detail: string;
  evidence?: string;
}

interface IntentAlignment {
  score: number;
  grade: string;
  confidence: "high" | "medium" | "low";
  targetKeyword?: string;
  targetMatter?: string;
  targetLocation?: string;
  bestMatchingPage?: string;
  matchedSignals?: number;
  totalSignals?: number;
  evidence: IntentSignal[];
  missingSignals?: string[];
}

interface PageAuditSnapshot {
  metaDescription: string | null;
  h1s: string[];
  h2s: string[];
  imageCount: number;
  imagesMissingAlt: number;
  internalLinksOut: number;
  ctaEvidence: string[];
  phoneEvidence: string[];
}

interface RenderingSnapshot {
  risk: "low" | "medium" | "high";
  wordCount: number;
  scriptCount: number;
  externalScriptCount: number;
  appShellLikely: boolean;
  emptyAppRoot: boolean;
  hasNoscriptFallback: boolean;
  evidence: string[];
  recommendation?: string;
}

interface RenderingSummary {
  risk: "low" | "medium" | "high";
  highRiskPages: number;
  mediumRiskPages: number;
  totalPages: number;
  evidence: string[];
}

interface PageResult {
  url: string;
  title?: string | null;
  metaDescription?: string | null;
  pageType?: string;
  pageScore: number;
  pageGrade: string;
  aiVisibilityScore?: number;
  categories: CategoryResult[];
  failCount: number;
  warnCount: number;
  httpStatus?: number;
  indexable?: boolean;
  wordCount?: number;
  rendering?: RenderingSnapshot;
  pageAudit?: PageAuditSnapshot;
  intentAlignment?: IntentAlignment;
  keyWarnings?: string[];
}

interface Issue {
  id: string;
  category: string;
  severity: Severity;
  status: "pass" | "warn" | "fail";
  title: string;
  detail: string;
  fix?: string;
  evidence?: string;
  affectedUrls: string[];
  affectedCount: number;
  totalPages: number;
  pageTypeImpact?: string[];
  confidence: "high" | "medium" | "low";
  effort: "low" | "medium" | "high";
  priority: number;
  internalNote?: string;
  prospectingAngle?: string;
}

interface InternalSummary {
  prospectFitScore: number;
  websiteMaturity: "poor" | "basic" | "decent" | "strong";
  urgencyLevel: "low" | "medium" | "high" | "urgent";
  likelyPainPoints: string[];
  strongestOutreachHooks: string[];
  recommendedOpeningAngle: string;
  topRevenueOpportunities: string[];
  technicalBlockers: string[];
  aiVisibilityBlockers: string[];
  localSeoOpportunities: string[];
  trustAndConversionGaps: string[];
}

interface SeverityBreakdown {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

interface TopFix {
  label: string;
  category: string;
  status: "warn" | "fail";
  fix?: string;
  pagesAffected: number;
  totalPages: number;
}

export interface SeoCheckResult {
  domain: string;
  scanMode?: string;
  pagesScanned?: number;
  pages?: PageResult[];
  categories: CategoryResult[];
  overallScore: number;
  grade: string;
  aiSearchScore: number;
  aiSearchGrade: string;
  aiPolicyScore?: number;
  aiPolicyGrade?: string;
  aiBots: AiBotStatus[];
  intentAlignment?: IntentAlignment;
  renderingSummary?: RenderingSummary;
  topFixes?: TopFix[];
  issues?: Issue[];
  internalSummary?: InternalSummary;
  severityBreakdown?: SeverityBreakdown;
  partial?: boolean;
  checkedAt: string;
}

const STATUS_ICON: Record<string, string> = { pass: "✓", warn: "▲", fail: "✗" };
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Info",
};
const PAGE_TYPE_LABEL: Record<string, string> = {
  homepage: "Homepage", contact: "Contact", about: "About", attorney: "Attorney / team",
  practice: "Practice area", location: "Location", faq: "FAQ", blog: "Blog / guide",
  policy: "Policy", other: "Other",
};
const EMPTY = "n/a";

function sevClass(s: Severity): string {
  return `sev-${s}`;
}

/* ────────────────────────────────────────────────────────
   Audit notes (operator only): a deterministic read on how safe an issue
   is to cite in outreach, derived from category/severity/confidence/evidence.
   Not a new signal, just a classification of signals the engine already
   produced, so it applies to saved historical runs without a re-scan.
   ──────────────────────────────────────────────────────── */

type AuditNoteKind = "safe" | "verify" | "hygiene" | "crawler_limitation";

const AUDIT_NOTE_LABEL: Record<AuditNoteKind, string> = {
  safe: "Safe to mention",
  verify: "Verify manually",
  hygiene: "Low-priority hygiene",
  crawler_limitation: "Crawler limitation",
};

// Content-extraction findings depend on parsing raw server HTML for meaning
// (definitions, Q&A patterns, authorship). A JS-rendered page can read as a
// false negative here even when the content exists after hydration.
const CONTENT_EXTRACTION_LABELS = new Set([
  "Semantic HTML structure", "Direct-answer sentences", "Question-format headings",
  "Author / reviewer signals", "Entity description",
]);

// Rendering and structure findings are prone to the same class of false
// negative the SEO tool itself has been calibrated against: CTA text, contact
// widgets, and team bios that render client-side are invisible to a raw-HTML
// crawl even though a visitor sees them. "No practice-area pages found" is
// deliberately NOT here: it is a URL/page-type inventory fact (hardened
// against the same client-render class of false positive already), so it
// falls through to the safe-to-mention default below.
const VERIFY_MANUALLY_LABELS = new Set([
  "Server-rendered content", "JavaScript app-shell dependency", "Noscript fallback",
  "Consultation call to action", "Contact form / direct contact",
  "No clear contact path", "No attorney / team page found",
]);

const HYGIENE_LABELS = new Set([
  "Image alt text", "Meta description", "H1 heading", "H2 subheadings",
  "Content-to-HTML ratio", "HTML document size", "Anchor text quality",
  "Open Graph tags", "Word count", "Heading hierarchy", "Internal links",
  "External links",
]);

function classifyAuditNote(issue: Issue): AuditNoteKind {
  const policyOnly = issue.pageTypeImpact && issue.pageTypeImpact.length > 0
    && issue.pageTypeImpact.every((t) => t === "policy");

  if (issue.confidence === "low" || policyOnly || CONTENT_EXTRACTION_LABELS.has(issue.title)) {
    return "crawler_limitation";
  }
  if (VERIFY_MANUALLY_LABELS.has(issue.title)) {
    return "verify";
  }
  if (HYGIENE_LABELS.has(issue.title) || issue.severity === "low" || issue.severity === "info") {
    return "hygiene";
  }
  return "safe";
}

/* ────────────────────────────────────────────────────────
   Gauge
   ──────────────────────────────────────────────────────── */

function GradeRing({ score, grade, label, size = 132 }: { score: number; grade: string; label: string; size?: number }) {
  const radius = (size / 2) - 15;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (Math.max(0, Math.min(100, score)) / 100) * circ;
  const color = score >= 70 ? "var(--navy)" : score >= 40 ? "var(--stone-on-light)" : "var(--danger)";
  return (
    <div className="seo-gauge" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth="8" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 1.1s ease-out" }} />
      </svg>
      <div className="seo-gauge-inner" style={{ width: size, height: size }}>
        <span className="seo-gauge-letter" style={{ color }}>{grade}</span>
        <span className="seo-gauge-num">{score}/100</span>
      </div>
      <span className="seo-gauge-label">{label}</span>
    </div>
  );
}

function copyText(text: string, done: () => void) {
  if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, done);
}

/* ────────────────────────────────────────────────────────
   Category card
   ──────────────────────────────────────────────────────── */

function CategoryCard({ cat }: { cat: CategoryResult }) {
  const [open, setOpen] = useState(false);
  const pct = cat.maxScore > 0 ? Math.round((cat.score / cat.maxScore) * 100) : 0;
  const pass = cat.items.filter((i) => i.status === "pass").length;
  const warn = cat.items.filter((i) => i.status === "warn").length;
  const fail = cat.items.filter((i) => i.status === "fail").length;
  return (
    <div className="seo-cat-card">
      <button className="seo-cat-header" onClick={() => setOpen(!open)} type="button" aria-expanded={open}>
        <div className="seo-cat-header-top">
          <h3 className="seo-cat-name">{cat.name}</h3>
          <span className="seo-cat-toggle">{open ? "▴" : "▾"}</span>
        </div>
        <div className="seo-cat-score-row">
          <div className="seo-cat-bar-track">
            <div className="seo-cat-bar-fill" style={{ width: `${pct}%`, background: pct >= 70 ? "var(--navy)" : pct >= 40 ? "var(--stone)" : "var(--danger)" }} />
          </div>
          <span className="seo-cat-pct">{pct}%</span>
        </div>
        <div className="seo-cat-counts">
          {pass > 0 && <span className="seo-count seo-count-pass">{pass} passed</span>}
          {warn > 0 && <span className="seo-count seo-count-warn">{warn} warning{warn > 1 ? "s" : ""}</span>}
          {fail > 0 && <span className="seo-count seo-count-fail">{fail} failed</span>}
        </div>
      </button>
      {open && (
        <ul className="seo-cat-items">
          {cat.items.map((item, i) => (
            <li key={i} className="seo-item">
              <span className={`seo-item-icon seo-icon-${item.status}`}>{STATUS_ICON[item.status]}</span>
              <div className="seo-item-body">
                <span className="seo-item-label">
                  {item.label}
                  {item.scored === false && <span className="seo-item-unscored">Unscored</span>}
                </span>
                <span className="seo-item-detail">{item.detail}</span>
                {item.fix && item.status !== "pass" && (
                  <span className="seo-item-fix"><strong>How to fix:</strong> {item.fix}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────
   Report
   ──────────────────────────────────────────────────────── */

export default function SeoReport({
  result,
  onReset,
  hideCta = false,
  showInternal = false,
}: {
  result: SeoCheckResult;
  onReset: () => void;
  hideCta?: boolean;
  showInternal?: boolean;
}) {
  const [tab, setTab] = useState<"summary" | "issues" | "pages" | "categories">("summary");
  const [copied, setCopied] = useState<string | null>(null);

  const pages = result.pages ?? [];
  const pagesScanned = result.pagesScanned ?? pages.length ?? 1;
  const issues = result.issues ?? [];
  const summary = result.internalSummary;
  const breakdown = result.severityBreakdown;
  const intent = result.intentAlignment;
  const rendering = result.renderingSummary;

  const allIssues: Issue[] = issues.length > 0
    ? issues
    : result.categories.flatMap((c) =>
        c.items.filter((i) => i.status !== "pass").map((i) => ({
          id: `${c.name}-${i.label}`, category: c.name, severity: (i.status === "fail" ? "high" : "low") as Severity,
          status: i.status, title: i.label, detail: i.detail, fix: i.fix, affectedUrls: [], affectedCount: 0,
          totalPages: pagesScanned, confidence: "high" as const, effort: "medium" as const, priority: 0,
        }))
      );

  const totalChecks = result.categories.reduce((s, c) => s + c.items.length, 0);
  const failChecks = result.categories.flatMap((c) => c.items).filter((i) => i.status === "fail").length;
  const warnChecks = result.categories.flatMap((c) => c.items).filter((i) => i.status === "warn").length;
  const passedChecks = totalChecks - failChecks - warnChecks;

  const topFixes = allIssues.slice(0, 5);
  const quickWins = allIssues.filter((i) => i.effort === "low" && (i.severity === "critical" || i.severity === "high" || i.severity === "medium")).slice(0, 6);

  const execText = [
    `SEO & AI Visibility diagnostic: ${result.domain}`,
    `Pages scanned: ${pagesScanned} (${result.scanMode ?? "scan"})`,
    `SEO Health: ${result.overallScore}/100 (${result.grade}). AEO Readiness: ${result.aiSearchScore}/100. AI Policy: ${result.aiPolicyScore ?? EMPTY}/100.`,
    `Checks: ${passedChecks} passed, ${warnChecks} warnings, ${failChecks} failed.`,
    breakdown ? `Issues: ${breakdown.critical} critical, ${breakdown.high} high, ${breakdown.medium} medium, ${breakdown.low} low.` : "",
    "",
    "Top priority fixes:",
    ...topFixes.map((f, i) => `${i + 1}. [${SEVERITY_LABEL[f.severity]}] ${f.title} (${f.category}), ${f.affectedCount || 1} page(s)`),
  ].filter(Boolean).join("\n");

  const hooksText = summary
    ? [`Outreach angles for ${result.domain}:`, `Opening: ${summary.recommendedOpeningAngle}`, "", ...summary.strongestOutreachHooks.map((h, i) => `${i + 1}. ${h}`)].join("\n")
    : "";

  const fixesText = topFixes.map((f, i) => `${i + 1}. ${f.title} (${f.category}, ${SEVERITY_LABEL[f.severity]})\n   ${f.fix ?? f.detail}`).join("\n\n");

  function doCopy(key: string, text: string) {
    copyText(text, () => { setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600); });
  }

  // Operator PDF export goes through the server so the file has a real text
  // layer (selectable / searchable / greppable). A browser window.print() to a
  // print-to-PDF driver rasterizes on some machines, which is what the operator
  // kept hitting. Public (lead-magnet) users have no operator session, so they
  // keep window.print(); the operator endpoint is gated and never called by them.
  const [pdfState, setPdfState] = useState<"idle" | "working" | "error">("idle");
  async function handleServerPdf() {
    setPdfState("working");
    try {
      const res = await fetch("/api/admin/seo-check/report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      if (!res.ok) { setPdfState("error"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `seo-audit-${result.domain}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPdfState("idle");
    } catch {
      setPdfState("error");
    }
  }

  // Panes are always rendered; the active one shows on screen, and print
  // reveals all of them so the exported PDF is the complete report.
  const paneClass = (name: typeof tab) => `seo-pane ${tab === name ? "seo-pane-active" : ""}`;

  return (
    <div className="seo-report">
      {/* Header */}
      <div className="seo-report-header">
        <div className="seo-report-hero">
          <div className="seo-gauges">
            <GradeRing score={result.overallScore} grade={result.grade} label="SEO Health" />
            <GradeRing score={result.aiSearchScore} grade={result.aiSearchGrade} label="AEO Readiness" />
            {result.aiPolicyScore !== undefined && (
              <GradeRing score={result.aiPolicyScore} grade={result.aiPolicyGrade ?? "?"} label="Content Policy" size={116} />
            )}
          </div>
          <div className="seo-report-hero-text">
            <div className="seo-report-eyebrow">
              Multi-page diagnostic &middot; {pagesScanned} page{pagesScanned > 1 ? "s" : ""}{result.scanMode ? ` · ${result.scanMode}` : ""}
              {result.partial ? " · partial (time limit reached)" : ""}
            </div>
            <h2 className="seo-report-domain">{result.domain}</h2>
            <p className="seo-report-summary">
              {passedChecks} of {totalChecks} checks passed.{" "}
              {failChecks > 0 && `${failChecks} failed. `}
              {warnChecks > 0 && `${warnChecks} warnings.`}
            </p>
            <div className="seo-report-actions">
              <button className="seo-mini-btn" onClick={() => doCopy("exec", execText)} type="button">
                {copied === "exec" ? "Copied" : "Copy summary"}
              </button>
              <button className="seo-mini-btn" onClick={() => doCopy("fixes", fixesText)} type="button">
                {copied === "fixes" ? "Copied" : "Copy top fixes"}
              </button>
              {showInternal ? (
                <button className="seo-mini-btn" onClick={handleServerPdf} type="button" disabled={pdfState === "working"}>
                  {pdfState === "working" ? "Building PDF..." : pdfState === "error" ? "Retry PDF" : "Download PDF"}
                </button>
              ) : (
                <button className="seo-mini-btn" onClick={() => window.print()} type="button">Print / PDF</button>
              )}
            </div>
          </div>
        </div>

        <p className="seo-aeo-note">
          AEO Readiness measures on-site answer-engine readiness signals. It does not measure whether AI assistants actually cite this site.
        </p>

        {breakdown && (
          <div className="seo-sev-strip">
            {(["critical", "high", "medium", "low"] as Severity[]).map((s) => (
              <div key={s} className={`seo-sev-pill ${sevClass(s)}`}>
                <span className="seo-sev-n">{breakdown[s]}</span>
                <span className="seo-sev-l">{SEVERITY_LABEL[s]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="seo-tabs">
        <button className={`seo-tab ${tab === "summary" ? "seo-tab-active" : ""}`} onClick={() => setTab("summary")} type="button">Summary</button>
        <button className={`seo-tab ${tab === "issues" ? "seo-tab-active" : ""}`} onClick={() => setTab("issues")} type="button">Issues ({allIssues.length})</button>
        {pages.length > 1 && <button className={`seo-tab ${tab === "pages" ? "seo-tab-active" : ""}`} onClick={() => setTab("pages")} type="button">Pages ({pages.length})</button>}
        <button className={`seo-tab ${tab === "categories" ? "seo-tab-active" : ""}`} onClick={() => setTab("categories")} type="button">Categories</button>
      </div>

      {/* Summary section */}
      <div className={paneClass("summary")}>
          <section className="seo-block">
            <h3 className="seo-block-title">Top priority fixes</h3>
            <ul className="seo-fix-list">
              {topFixes.map((f, i) => (
                <li key={f.id} className="seo-fix-row">
                  <span className={`seo-sev-tag ${sevClass(f.severity)}`}>{SEVERITY_LABEL[f.severity]}</span>
                  <div className="seo-fix-body">
                    <div className="seo-fix-top">
                      <span className="seo-fix-rank">{i + 1}</span>
                      <span className="seo-fix-title">{f.title}</span>
                      <span className="seo-fix-cat">{f.category}</span>
                      {f.affectedCount > 1 && <span className="seo-fix-pages">{f.affectedCount}/{f.totalPages} pages</span>}
                      <span className="seo-fix-effort">{f.effort} effort</span>
                    </div>
                    {f.fix && <span className="seo-item-fix"><strong>How to fix:</strong> {f.fix}</span>}
                  </div>
                </li>
              ))}
              {topFixes.length === 0 && <li className="seo-empty">No issues found. The site is in strong shape.</li>}
            </ul>
          </section>

          {quickWins.length > 0 && (
            <section className="seo-block">
              <h3 className="seo-block-title">Quick wins (low effort)</h3>
              <div className="seo-chip-wrap">
                {quickWins.map((q) => (<span key={q.id} className={`seo-chip ${sevClass(q.severity)}`}>{q.title}</span>))}
              </div>
            </section>
          )}

          {intent && <IntentPanel intent={intent} />}

          {rendering && <RenderingPanel summary={rendering} />}

          <AiBotPanel bots={result.aiBots} />

          {showInternal && summary && (
            <section className="seo-block seo-internal">
              <div className="seo-internal-head">
                <h3 className="seo-block-title">Internal prospecting summary</h3>
                <span className="seo-internal-badge">Internal use</span>
              </div>
              <div className="seo-internal-grid">
                <div className="seo-internal-stat">
                  <span className="seo-internal-stat-n">{summary.prospectFitScore}</span>
                  <span className="seo-internal-stat-l">Prospect fit</span>
                </div>
                <div className="seo-internal-stat">
                  <span className="seo-internal-stat-n seo-cap">{summary.websiteMaturity}</span>
                  <span className="seo-internal-stat-l">Website maturity</span>
                </div>
                <div className="seo-internal-stat">
                  <span className="seo-internal-stat-n seo-cap">{summary.urgencyLevel}</span>
                  <span className="seo-internal-stat-l">Urgency</span>
                </div>
              </div>

              <div className="seo-internal-angle">
                <span className="seo-internal-sub">Recommended opening angle</span>
                <p>{summary.recommendedOpeningAngle}</p>
              </div>

              <div className="seo-internal-cols">
                <InternalList title="Strongest outreach hooks" items={summary.strongestOutreachHooks} />
                <InternalList title="Likely pain points" items={summary.likelyPainPoints} />
                <InternalList title="Top revenue opportunities" items={summary.topRevenueOpportunities} />
                <InternalList title="Technical blockers" items={summary.technicalBlockers} />
                <InternalList title="AI visibility blockers" items={summary.aiVisibilityBlockers} />
                <InternalList title="Local SEO opportunities" items={summary.localSeoOpportunities} />
                <InternalList title="Trust and conversion gaps" items={summary.trustAndConversionGaps} />
              </div>

              {hooksText && (
                <button className="seo-mini-btn" onClick={() => doCopy("hooks", hooksText)} type="button">
                  {copied === "hooks" ? "Copied" : "Copy outreach hooks"}
                </button>
              )}
            </section>
          )}
      </div>

      {/* Issues section */}
      <div className={paneClass("issues")}>
          {allIssues.length === 0 && <p className="seo-empty">No issues found. All checks passed.</p>}
          {showInternal && allIssues.length > 0 && (
            <p className="seo-audit-legend">
              <strong>Audit note</strong> reads how safe each finding is to cite before a re-check: schema, NAP,
              and security-header findings are hard facts; contact/team/rendering findings can be client-side false
              negatives worth a manual look; hygiene items are low-stakes polish; crawler-limitation items depend on
              raw HTML the engine could not fully evaluate.
            </p>
          )}
          <ul className="seo-issue-list">
            {allIssues.map((it) => {
              const note = showInternal ? classifyAuditNote(it) : null;
              return (
                <li key={it.id} className="seo-issue-card">
                  <div className="seo-issue-head">
                    <span className={`seo-sev-tag ${sevClass(it.severity)}`}>{SEVERITY_LABEL[it.severity]}</span>
                    <span className="seo-issue-title">{it.title}</span>
                    <span className="seo-fix-cat">{it.category}</span>
                    {it.affectedCount > 0 && (
                      <span className="seo-fix-pages">{it.affectedCount}{it.totalPages ? `/${it.totalPages}` : ""} page{it.affectedCount > 1 ? "s" : ""}</span>
                    )}
                    <span className="seo-fix-effort">{it.effort} effort, {it.confidence} confidence</span>
                    {note && <span className={`seo-audit-tag seo-audit-${note}`}>{AUDIT_NOTE_LABEL[note]}</span>}
                  </div>
                  <p className="seo-issue-detail">{it.detail}</p>
                  {it.fix && <p className="seo-item-fix"><strong>How to fix:</strong> {it.fix}</p>}
                  {it.evidence && <p className="seo-issue-evidence">Evidence: {it.evidence}</p>}
                  {showInternal && it.internalNote && (<p className="seo-issue-internal"><strong>Internal:</strong> {it.internalNote}</p>)}
                  {showInternal && it.prospectingAngle && (<p className="seo-issue-angle"><strong>Angle:</strong> {it.prospectingAngle}</p>)}
                </li>
              );
            })}
          </ul>
      </div>

      {/* Pages section */}
      {pages.length > 0 && (
        <div className={paneClass("pages")}>
          <div className="seo-table-wrap">
            <table className="seo-table">
              <thead>
                <tr><th>Page</th><th>Type</th><th>Score</th><th>Index</th><th>Intent</th><th>Rendering</th><th>Page evidence</th><th>Key warnings</th></tr>
              </thead>
              <tbody>
                {pages.map((p, i) => {
                  let path = "/";
                  try { path = new URL(p.url).pathname || "/"; } catch { /* keep */ }
                  return (
                    <tr key={i}>
                      <td>
                        <span className="seo-td-path">{path}</span>
                        {p.title && <span className="seo-td-title">{p.title}</span>}
                      </td>
                      <td>{p.pageType ? (PAGE_TYPE_LABEL[p.pageType] ?? p.pageType) : EMPTY}</td>
                      <td><span className="seo-td-grade" style={{ color: p.pageScore >= 70 ? "var(--navy)" : p.pageScore >= 40 ? "var(--stone-on-light)" : "var(--danger)" }}>{p.pageGrade}</span> {p.pageScore}</td>
                      <td>{p.indexable === false ? <span className="seo-noindex">noindex</span> : "ok"}</td>
                      <td>{p.intentAlignment ? <span className="seo-td-grade">{p.intentAlignment.grade} {p.intentAlignment.score}</span> : EMPTY}</td>
                      <td>
                        {p.rendering
                          ? <span className={`seo-render-risk seo-render-${p.rendering.risk}`}>{p.rendering.risk}</span>
                          : EMPTY}
                      </td>
                      <td className="seo-td-warnings">
                        {[
                          p.pageAudit?.h1s?.[0] ? `H1: ${p.pageAudit.h1s[0]}` : "",
                          p.wordCount ? `${p.wordCount} words` : "",
                          p.pageAudit ? `${p.pageAudit.internalLinksOut} internal links` : "",
                        ].filter(Boolean).join(" · ") || EMPTY}
                      </td>
                      <td className="seo-td-warnings">{p.keyWarnings && p.keyWarnings.length > 0 ? p.keyWarnings.join(", ") : EMPTY}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Categories section */}
      <div className={paneClass("categories")}>
          <div className="seo-categories">
            {result.categories.map((c, i) => <CategoryCard key={i} cat={c} />)}
          </div>
      </div>

      {!hideCta && (
        <div className="seo-report-cta">
          <div className="seo-cta-card">
            <h3 className="seo-cta-title">Want these issues fixed?</h3>
            <p className="seo-cta-sub">
              CaseLoad Select builds the SEO and AI visibility infrastructure that puts your firm
              in front of the right clients. We fix these issues as part of the system.
            </p>
            <a href="/home#final-cta" className="seo-cta-btn">Learn how it works</a>
          </div>
        </div>
      )}

      <div className="seo-report-footer">
        <button onClick={onReset} className="seo-reset-btn">Run another scan</button>
        <p className="seo-report-ts">
          Checked {new Date(result.checkedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      <style>{reportStyles}</style>
    </div>
  );
}

function InternalList({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="seo-internal-list">
      <span className="seo-internal-sub">{title}</span>
      <ul>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
    </div>
  );
}

function IntentPanel({ intent }: { intent: IntentAlignment }) {
  const target = intent.targetKeyword || intent.targetMatter || "Target intent";
  const bestPath = (() => {
    if (!intent.bestMatchingPage) return EMPTY;
    try { return new URL(intent.bestMatchingPage).pathname || "/"; } catch { return intent.bestMatchingPage; }
  })();
  const topSignals = (intent.evidence ?? []).slice(0, 8);
  return (
    <section className="seo-block seo-intent-panel">
      <div className="seo-intent-head">
        <div>
          <h3 className="seo-block-title">Intent alignment</h3>
          <p className="seo-intent-target">
            {target}{intent.targetLocation ? ` · ${intent.targetLocation}` : ""}
          </p>
        </div>
        <div className="seo-intent-score">
          <span className="seo-intent-grade">{intent.grade}</span>
          <span>{intent.score}/100</span>
          <small>{intent.confidence} confidence</small>
        </div>
      </div>

      <div className="seo-intent-meta">
        <span>Best page: {bestPath}</span>
        {intent.missingSignals && intent.missingSignals.length > 0 && (
          <span>Missing: {intent.missingSignals.slice(0, 4).join(", ")}</span>
        )}
      </div>

      <ul className="seo-intent-signals">
        {topSignals.map((s) => (
          <li key={s.signal} className={`seo-intent-signal seo-icon-${s.status}`}>
            <span className={`seo-item-icon seo-icon-${s.status}`}>{STATUS_ICON[s.status]}</span>
            <div>
              <strong>{s.signal}</strong>
              <span>{s.detail}</span>
              {s.evidence && <em>{s.evidence}</em>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RenderingPanel({ summary }: { summary: RenderingSummary }) {
  const label = summary.risk === "high"
    ? "High rendering risk"
    : summary.risk === "medium"
      ? "Some rendering risk"
      : "Server HTML looks crawlable";
  return (
    <section className={`seo-block seo-render-panel seo-render-panel-${summary.risk}`}>
      <div className="seo-render-head">
        <h3 className="seo-block-title">Rendering & crawlability</h3>
        <span className={`seo-render-badge seo-render-${summary.risk}`}>{label}</span>
      </div>
      <p className="seo-render-copy">
        This scan reads the server HTML first. Pages with thin server HTML or app-shell patterns should be verified in a rendered browser before using missing-content findings in outreach.
      </p>
      <div className="seo-render-stats">
        <span>{summary.highRiskPages} high-risk</span>
        <span>{summary.mediumRiskPages} medium-risk</span>
        <span>{summary.totalPages} scanned</span>
      </div>
      <ul className="seo-render-evidence">
        {summary.evidence.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}
      </ul>
    </section>
  );
}

function AiBotPanel({ bots }: { bots: AiBotStatus[] }) {
  if (!bots || bots.length === 0) return null;
  const search = bots.filter((b) => b.category === "search");
  const training = bots.filter((b) => b.category === "training");
  const blockedSearch = search.filter((b) => b.blocked).length;
  return (
    <section className="seo-block">
      <div className="seo-bots-header">
        <h3 className="seo-block-title">AI crawler access</h3>
        {blockedSearch > 0
          ? <span className="seo-bots-badge seo-bots-badge-warn">{blockedSearch} search bot{blockedSearch > 1 ? "s" : ""} blocked</span>
          : <span className="seo-bots-badge seo-bots-badge-ok">All search bots allowed</span>}
      </div>
      <div className="seo-bots-section">
        <span className="seo-bots-section-label">AI search crawlers (blocking hurts visibility)</span>
        <div className="seo-bots-grid">
          {search.map((b) => (
            <div key={b.name} className="seo-bot-row">
              <span className={`seo-bot-dot ${b.blocked ? "seo-bot-dot-blocked" : "seo-bot-dot-ok"}`} />
              <span className="seo-bot-name">{b.name}</span>
              <span className={`seo-bot-status ${b.blocked ? "seo-bot-status-blocked" : "seo-bot-status-ok"}`}>{b.blocked ? "Blocked" : "Allowed"}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="seo-bots-section">
        <span className="seo-bots-section-label">Training / content-use crawlers (blocking protects content)</span>
        <div className="seo-bots-grid">
          {training.map((b) => (
            <div key={b.name} className="seo-bot-row">
              <span className={`seo-bot-dot ${b.blocked ? "seo-bot-dot-ok" : "seo-bot-dot-warn"}`} />
              <span className="seo-bot-name">{b.name}</span>
              <span className={`seo-bot-status ${b.blocked ? "seo-bot-status-ok" : "seo-bot-status-warn"}`}>{b.blocked ? "Blocked" : "Allowed"}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const reportStyles = `
  .seo-report { max-width: 880px; margin: 0 auto; }
  .seo-report-header { background: var(--white); border: 1px solid var(--border); border-radius: var(--r-card); padding: var(--sp-6); margin-bottom: var(--sp-4); }
  .seo-report-hero { display: flex; gap: var(--sp-6); align-items: flex-start; }
  .seo-gauges { display: flex; gap: var(--sp-4); flex-shrink: 0; align-items: flex-end; }
  .seo-gauge { position: relative; display: flex; flex-direction: column; align-items: center; }
  .seo-gauge-inner { position: absolute; top: 0; left: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .seo-gauge-letter { font-family: var(--font-display); font-size: 26px; font-weight: 800; line-height: 1; }
  .seo-gauge-num { font-family: var(--font-display); font-size: 10px; font-weight: 700; letter-spacing: 1px; color: var(--text-muted); margin-top: 4px; }
  .seo-gauge-label { font-family: var(--font-display); font-size: 9.5px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: var(--text-muted); margin-top: var(--sp-2); white-space: nowrap; }
  .seo-report-hero-text { flex: 1; padding-top: var(--sp-2); min-width: 0; }
  .seo-report-eyebrow { font-family: var(--font-display); font-size: 10px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: var(--stone-on-light); margin-bottom: var(--sp-2); }
  .seo-report-domain { font-family: var(--font-display); font-size: var(--fs-h3); font-weight: 800; color: var(--navy); margin: 0 0 var(--sp-2); word-break: break-word; }
  .seo-report-summary { font-size: 14px; color: var(--text-muted); line-height: 1.6; margin: 0 0 var(--sp-3); }
  .seo-aeo-note { font-size: 11.5px; color: var(--text-muted); line-height: 1.5; margin: var(--sp-3) 0 0; padding-top: var(--sp-3); border-top: 1px solid var(--border); }
  .seo-report-actions { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
  .seo-mini-btn { font-family: var(--font-display); font-size: 10.5px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--navy); background: var(--parchment); border: 1px solid var(--border); padding: 7px 14px; border-radius: var(--r-tight); cursor: pointer; transition: background 0.15s, border-color 0.15s; }
  .seo-mini-btn:hover { border-color: var(--navy); }

  .seo-sev-strip { display: flex; gap: var(--sp-2); margin-top: var(--sp-5); border-top: 1px solid var(--border); padding-top: var(--sp-4); }
  .seo-sev-pill { display: flex; flex-direction: column; align-items: center; flex: 1; padding: var(--sp-2); border-radius: var(--r-tight); background: var(--parchment); }
  .seo-sev-n { font-family: var(--font-display); font-size: 22px; font-weight: 800; line-height: 1; }
  .seo-sev-l { font-family: var(--font-display); font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); margin-top: 3px; }
  .sev-critical .seo-sev-n, .seo-sev-tag.sev-critical, .seo-chip.sev-critical { color: var(--danger); }
  .sev-high .seo-sev-n { color: var(--danger); }
  .sev-medium .seo-sev-n { color: var(--stone-on-light); }
  .sev-low .seo-sev-n { color: var(--text-muted); }

  .seo-tabs { display: flex; gap: 0; margin-bottom: var(--sp-5); border-bottom: 2px solid var(--border); overflow-x: auto; }
  .seo-tab { font-family: var(--font-display); font-size: 11.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); background: none; border: none; padding: var(--sp-3) var(--sp-4); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; white-space: nowrap; }
  .seo-tab:hover { color: var(--navy); }
  .seo-tab-active { color: var(--navy); border-bottom-color: var(--navy); }

  .seo-pane { margin-bottom: var(--sp-6); display: none; }
  .seo-pane-active { display: block; }
  .seo-block { background: var(--white); border: 1px solid var(--border); border-radius: var(--r-card); padding: var(--sp-5); margin-bottom: var(--sp-4); }
  .seo-block-title { font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--navy); margin: 0 0 var(--sp-4); }
  .seo-empty { color: var(--text-muted); font-size: 14px; text-align: center; padding: var(--sp-5) 0; }

  .seo-fix-list, .seo-issue-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
  .seo-fix-row { display: flex; gap: var(--sp-3); align-items: flex-start; }
  .seo-fix-body { flex: 1; min-width: 0; }
  .seo-fix-top { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; margin-bottom: 3px; }
  .seo-fix-rank { font-family: var(--font-display); font-weight: 800; color: var(--navy); font-size: 13px; }
  .seo-fix-title { font-size: 13.5px; font-weight: 600; color: var(--text); }
  .seo-fix-cat, .seo-fix-pages, .seo-fix-effort { font-family: var(--font-display); font-size: 9px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; background: var(--parchment); color: var(--stone-on-light); white-space: nowrap; }
  .seo-sev-tag { font-family: var(--font-display); font-size: 9.5px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; padding: 3px 9px; border-radius: 3px; background: var(--parchment); white-space: nowrap; align-self: flex-start; }
  .seo-sev-tag.sev-medium { color: var(--stone-on-light); }
  .seo-sev-tag.sev-low, .seo-sev-tag.sev-info { color: var(--text-muted); }

  .seo-item-fix { font-size: 12px; color: var(--navy); line-height: 1.55; display: block; margin-top: 4px; padding: 6px 10px; background: rgba(30,47,88,0.04); border-radius: 4px; border-left: 2px solid var(--navy); }
  .seo-item-fix strong { font-weight: 700; font-size: 10px; letter-spacing: 0.5px; text-transform: uppercase; }

  .seo-chip-wrap { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
  .seo-chip { font-size: 12px; padding: 5px 11px; border-radius: 20px; background: var(--parchment); color: var(--text); border: 1px solid var(--border); }

  .seo-intent-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-4); margin-bottom: var(--sp-3); }
  .seo-intent-target { margin: -8px 0 0; font-size: 13px; color: var(--text-muted); }
  .seo-intent-score { min-width: 96px; text-align: right; font-family: var(--font-display); color: var(--navy); }
  .seo-intent-grade { display: block; font-size: 28px; line-height: 1; font-weight: 700; }
  .seo-intent-score small { display: block; margin-top: 2px; font-size: 9px; letter-spacing: 0.8px; text-transform: uppercase; color: var(--text-muted); }
  .seo-intent-meta { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: var(--sp-3); }
  .seo-intent-meta span { font-size: 11.5px; color: var(--text-muted); background: var(--parchment); border: 1px solid var(--border); border-radius: 3px; padding: 4px 8px; }
  .seo-intent-signals { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2); }
  .seo-intent-signal { display: flex; gap: var(--sp-2); padding: var(--sp-2); border: 1px solid var(--border-soft); background: var(--white); }
  .seo-intent-signal strong { display: block; font-family: var(--font-display); font-size: 11px; color: var(--navy); }
  .seo-intent-signal span { display: block; font-size: 12px; color: var(--text); line-height: 1.45; }
  .seo-intent-signal em { display: block; margin-top: 3px; font-size: 11px; font-style: normal; color: var(--text-muted); overflow-wrap: anywhere; }

  .seo-render-panel { border-color: var(--border); }
  .seo-render-panel-high { border-color: rgba(192,57,43,0.35); }
  .seo-render-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-2); }
  .seo-render-head .seo-block-title { margin: 0; }
  .seo-render-badge, .seo-render-risk { font-family: var(--font-display); font-size: 9.5px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; padding: 3px 9px; border-radius: 3px; background: var(--parchment); white-space: nowrap; }
  .seo-render-low { color: var(--navy); }
  .seo-render-medium { color: var(--stone-on-light); }
  .seo-render-high { color: var(--danger); }
  .seo-render-copy { margin: 0 0 var(--sp-3); font-size: 12.5px; color: var(--text-muted); line-height: 1.6; }
  .seo-render-stats { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: var(--sp-3); }
  .seo-render-stats span { font-size: 11.5px; color: var(--text-muted); background: var(--parchment); border: 1px solid var(--border); border-radius: 3px; padding: 4px 8px; }
  .seo-render-evidence { margin: 0; padding-left: 18px; }
  .seo-render-evidence li { font-size: 12px; color: var(--text); line-height: 1.5; margin-bottom: 3px; }

  .seo-issue-card { border: 1px solid var(--border); border-radius: var(--r-card); padding: var(--sp-4); background: var(--white); }
  .seo-issue-head { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; margin-bottom: var(--sp-2); }
  .seo-issue-title { font-size: 14px; font-weight: 700; color: var(--navy); }
  .seo-issue-detail { font-size: 13px; color: var(--text-muted); line-height: 1.6; margin: 0 0 var(--sp-2); }
  .seo-issue-evidence { font-size: 11.5px; color: var(--text-muted); margin: var(--sp-2) 0 0; }
  .seo-issue-internal { font-size: 12px; color: var(--text); margin: var(--sp-2) 0 0; padding: 7px 10px; background: rgba(196,180,154,0.14); border-radius: 4px; }
  .seo-issue-angle { font-size: 12px; color: var(--navy); margin: var(--sp-2) 0 0; padding: 7px 10px; background: rgba(30,47,88,0.05); border-radius: 4px; }
  .seo-issue-internal strong, .seo-issue-angle strong { text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.6px; }

  .seo-audit-legend { font-size: 11.5px; color: var(--text-muted); line-height: 1.55; margin: 0 0 var(--sp-3); padding: var(--sp-3); background: var(--parchment); border-radius: var(--r-tight); }
  .seo-audit-legend strong { color: var(--text); text-transform: uppercase; font-family: var(--font-display); font-size: 9.5px; letter-spacing: 0.6px; }
  .seo-audit-tag { font-family: var(--font-display); font-size: 8.5px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; padding: 2px 7px; border-radius: 3px; white-space: nowrap; margin-left: auto; }
  .seo-audit-safe { background: rgba(30,47,88,0.08); color: var(--navy); }
  .seo-audit-verify { background: rgba(196,180,154,0.22); color: var(--stone-on-light); }
  .seo-audit-hygiene { background: var(--parchment); color: var(--text-muted); }
  .seo-audit-crawler_limitation { background: rgba(192,57,43,0.08); color: var(--danger); }

  .seo-internal { border-color: var(--stone); }
  .seo-internal-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-4); }
  .seo-internal-head .seo-block-title { margin: 0; }
  .seo-internal-badge { font-family: var(--font-display); font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--white); background: var(--stone-on-light); padding: 3px 9px; border-radius: 20px; }
  .seo-internal-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-3); margin-bottom: var(--sp-4); }
  .seo-internal-stat { text-align: center; padding: var(--sp-3); background: var(--parchment); border-radius: var(--r-tight); }
  .seo-internal-stat-n { font-family: var(--font-display); font-size: 26px; font-weight: 800; color: var(--navy); display: block; line-height: 1; }
  .seo-internal-stat-n.seo-cap { font-size: 17px; text-transform: capitalize; }
  .seo-internal-stat-l { font-family: var(--font-display); font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--text-muted); margin-top: 5px; display: block; }
  .seo-internal-angle { background: rgba(30,47,88,0.04); border-left: 2px solid var(--navy); padding: var(--sp-3); border-radius: 4px; margin-bottom: var(--sp-4); }
  .seo-internal-angle p { margin: 4px 0 0; font-size: 13.5px; color: var(--text); line-height: 1.6; }
  .seo-internal-sub { font-family: var(--font-display); font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--stone-on-light); }
  .seo-internal-cols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-4); margin-bottom: var(--sp-4); }
  .seo-internal-list ul { margin: var(--sp-2) 0 0; padding-left: 18px; }
  .seo-internal-list li { font-size: 12.5px; color: var(--text); line-height: 1.5; margin-bottom: 3px; }

  .seo-bots-header { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-4); }
  .seo-bots-header .seo-block-title { margin: 0; }
  .seo-bots-badge { font-family: var(--font-display); font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 3px 10px; border-radius: 20px; }
  .seo-bots-badge-ok { background: rgba(30,47,88,0.08); color: var(--navy); }
  .seo-bots-badge-warn { background: rgba(192,57,43,0.08); color: var(--danger); }
  .seo-bots-section { margin-bottom: var(--sp-3); }
  .seo-bots-section:last-child { margin-bottom: 0; }
  .seo-bots-section-label { font-size: 11px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: var(--sp-2); }
  .seo-bots-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 4px var(--sp-4); }
  .seo-bot-row { display: flex; align-items: center; gap: var(--sp-2); padding: 3px 0; }
  .seo-bot-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .seo-bot-dot-ok { background: var(--navy); } .seo-bot-dot-blocked { background: var(--danger); } .seo-bot-dot-warn { background: var(--stone); }
  .seo-bot-name { font-size: 12px; color: var(--text); flex: 1; }
  .seo-bot-status { font-family: var(--font-display); font-size: 9px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; }
  .seo-bot-status-ok { color: var(--navy); } .seo-bot-status-blocked { color: var(--danger); } .seo-bot-status-warn { color: var(--stone-on-light); }

  .seo-table-wrap { overflow-x: auto; background: var(--white); border: 1px solid var(--border); border-radius: var(--r-card); }
  .seo-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .seo-table th { text-align: left; font-family: var(--font-display); font-size: 9.5px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--text-muted); padding: var(--sp-3); border-bottom: 2px solid var(--border); white-space: nowrap; }
  .seo-table td { padding: var(--sp-3); border-bottom: 1px solid var(--border-soft); vertical-align: top; }
  .seo-td-path { display: block; font-weight: 600; color: var(--navy); }
  .seo-td-title { display: block; color: var(--text-muted); font-size: 11px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .seo-td-grade { font-family: var(--font-display); font-weight: 800; }
  .seo-td-fail { color: var(--danger); font-weight: 600; } .seo-td-warn { color: var(--stone-on-light); }
  .seo-td-warnings { color: var(--text-muted); max-width: 240px; }
  .seo-noindex { color: var(--danger); font-weight: 700; }

  .seo-categories { display: flex; flex-direction: column; gap: var(--sp-3); }
  .seo-cat-card { background: var(--white); border: 1px solid var(--border); border-radius: var(--r-card); overflow: hidden; }
  .seo-cat-header { display: block; width: 100%; text-align: left; padding: var(--sp-4) var(--sp-5); border: none; border-bottom: 1px solid var(--border); background: none; cursor: pointer; }
  .seo-cat-header:hover { background: var(--parchment); }
  .seo-cat-header-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--sp-3); }
  .seo-cat-name { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--navy); margin: 0; }
  .seo-cat-toggle { font-size: 13px; color: var(--text-muted); }
  .seo-cat-score-row { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-2); }
  .seo-cat-bar-track { flex: 1; height: 6px; background: var(--parchment); border-radius: 3px; overflow: hidden; }
  .seo-cat-bar-fill { height: 100%; border-radius: 3px; }
  .seo-cat-pct { font-family: var(--font-display); font-size: 13px; font-weight: 700; color: var(--navy); min-width: 36px; text-align: right; }
  .seo-cat-counts { display: flex; gap: var(--sp-3); }
  .seo-count { font-family: var(--font-display); font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  .seo-count-pass { color: var(--navy); } .seo-count-warn { color: var(--stone-on-light); } .seo-count-fail { color: var(--danger); }
  .seo-cat-items { list-style: none; padding: 0; margin: 0; }
  .seo-item { display: flex; gap: var(--sp-3); padding: var(--sp-3) var(--sp-5); border-bottom: 1px solid var(--border-soft); align-items: flex-start; }
  .seo-item:last-child { border-bottom: none; }
  .seo-item-icon { font-size: 12px; font-weight: 700; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 50%; flex-shrink: 0; margin-top: 1px; }
  .seo-icon-pass { color: var(--navy); background: rgba(30,47,88,0.08); }
  .seo-icon-warn { color: var(--stone-on-light); background: rgba(196,180,154,0.18); font-size: 9px; }
  .seo-icon-fail { color: var(--danger); background: rgba(192,57,43,0.08); }
  .seo-item-body { flex: 1; }
  .seo-item-label { font-size: 13px; font-weight: 600; color: var(--text); display: block; margin-bottom: 2px; }
  .seo-item-unscored { font-size: 9.5px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--text-muted); background: var(--parchment); border: 1px solid var(--border); border-radius: 3px; padding: 1px 5px; margin-left: 6px; vertical-align: middle; }
  .seo-item-detail { font-size: 12.5px; color: var(--text-muted); line-height: 1.55; display: block; }

  .seo-report-cta { margin-bottom: var(--sp-6); }
  .seo-cta-card { background: var(--navy); border-radius: var(--r-card); padding: var(--sp-7) var(--sp-6); text-align: center; }
  .seo-cta-title { font-family: var(--font-display); font-size: var(--fs-h3); font-weight: 800; color: var(--white); margin: 0 0 var(--sp-3); }
  .seo-cta-sub { font-size: 14px; color: var(--slate); line-height: 1.6; max-width: 520px; margin: 0 auto var(--sp-5); }
  .seo-cta-btn { display: inline-block; font-family: var(--font-display); font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--navy); background: var(--stone); padding: 14px 36px; border-radius: var(--r-tight); text-decoration: none; }
  .seo-cta-btn:hover { background: var(--stone-light); }

  .seo-report-footer { text-align: center; padding: var(--sp-5) 0; }
  .seo-reset-btn { font-family: var(--font-body); font-size: 13px; color: var(--text-muted); background: none; border: 1px solid var(--border); padding: 10px 24px; border-radius: var(--r-tight); cursor: pointer; margin-bottom: var(--sp-3); }
  .seo-reset-btn:hover { border-color: var(--navy); color: var(--navy); }
  .seo-report-ts { font-size: 11px; color: var(--text-muted); margin: 0; }

  @media (max-width: 768px) {
    .seo-report-hero { flex-direction: column; }
    .seo-gauges { justify-content: center; }
    .seo-internal-cols { grid-template-columns: 1fr; }
    .seo-bots-grid { grid-template-columns: 1fr; }
    .seo-intent-head { flex-direction: column; }
    .seo-intent-score { text-align: left; }
    .seo-intent-signals { grid-template-columns: 1fr; }
  }
  @media print {
    .seo-tabs, .seo-report-actions, .seo-report-cta, .seo-report-footer, .seo-mini-btn { display: none !important; }
    /* Hide any surrounding app shell (sidebar nav) so the PDF is report-only. */
    aside { display: none !important; }
    .seo-report { max-width: none; }
    /* Reveal every section so the exported PDF is the complete report. */
    .seo-pane { display: block !important; margin-bottom: 12px; }
    .seo-block, .seo-issue-card, .seo-cat-card, .seo-report-header, .seo-table-wrap, .seo-fix-row, .seo-bot-row, .seo-internal-stat { break-inside: avoid; box-shadow: none; }
    /* Expand collapsed category items so the print is not truncated. */
    .seo-cat-items { display: block !important; }
  }
`;
