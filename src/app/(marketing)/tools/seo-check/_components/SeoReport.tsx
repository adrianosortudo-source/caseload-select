"use client";

import { useState } from "react";

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
  topFixes?: TopFix[];
  checkedAt: string;
}

const STATUS_ICON: Record<string, string> = {
  pass: "✓",
  warn: "▲",
  fail: "✗",
};

function GradeRing({
  score,
  grade,
  label,
  size = 140,
}: {
  score: number;
  grade: string;
  label: string;
  size?: number;
}) {
  const radius = (size / 2) - 16;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? "var(--navy)" : score >= 40 ? "var(--stone)" : "var(--danger)";

  return (
    <div className="seo-gauge" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth="8"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 1.2s ease-out" }}
        />
      </svg>
      <div className="seo-gauge-inner" style={{ width: size, height: size }}>
        <span className="seo-gauge-letter" style={{ color }}>{grade}</span>
        <span className="seo-gauge-num">{score}/100</span>
      </div>
      <span className="seo-gauge-label">{label}</span>
    </div>
  );
}

function AiBotPanel({ bots }: { bots: AiBotStatus[] }) {
  const searchBots = bots.filter((b) => b.category === "search");
  const trainingBots = bots.filter((b) => b.category === "training");
  const blockedSearch = searchBots.filter((b) => b.blocked).length;

  return (
    <div className="seo-bots-panel">
      <div className="seo-bots-header">
        <h3 className="seo-bots-title">AI Bot Access</h3>
        {blockedSearch > 0 ? (
          <span className="seo-bots-badge seo-bots-badge-warn">
            {blockedSearch} search bot{blockedSearch > 1 ? "s" : ""} blocked
          </span>
        ) : (
          <span className="seo-bots-badge seo-bots-badge-ok">All search bots allowed</span>
        )}
      </div>
      <div className="seo-bots-section">
        <span className="seo-bots-section-label">Search bots (blocking hurts visibility)</span>
        <div className="seo-bots-grid">
          {searchBots.map((bot) => (
            <div key={bot.name} className={`seo-bot-row ${bot.blocked ? "seo-bot-blocked" : ""}`}>
              <span className={`seo-bot-dot ${bot.blocked ? "seo-bot-dot-blocked" : "seo-bot-dot-ok"}`} />
              <span className="seo-bot-name">{bot.name}</span>
              <span className={`seo-bot-status ${bot.blocked ? "seo-bot-status-blocked" : "seo-bot-status-ok"}`}>
                {bot.blocked ? "Blocked" : "Allowed"}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="seo-bots-section">
        <span className="seo-bots-section-label">Training bots (blocking protects content)</span>
        <div className="seo-bots-grid">
          {trainingBots.map((bot) => (
            <div key={bot.name} className={`seo-bot-row ${!bot.blocked ? "seo-bot-unblocked-train" : ""}`}>
              <span className={`seo-bot-dot ${bot.blocked ? "seo-bot-dot-ok" : "seo-bot-dot-warn"}`} />
              <span className="seo-bot-name">{bot.name}</span>
              <span className={`seo-bot-status ${bot.blocked ? "seo-bot-status-ok" : "seo-bot-status-warn"}`}>
                {bot.blocked ? "Blocked" : "Allowed"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TopFixesPanel({ topFixes }: { topFixes: TopFix[] }) {
  if (!topFixes || topFixes.length === 0) return null;
  return (
    <div className="seo-topfixes-panel">
      <div className="seo-topfixes-header">
        <h3 className="seo-topfixes-title">Top fixes</h3>
        <span className="seo-bots-badge seo-bots-badge-warn">{topFixes.length} priority issues</span>
      </div>
      <ul className="seo-topfixes-list">
        {topFixes.map((fix, i) => (
          <li key={i} className="seo-topfix-row">
            <span className={`seo-item-icon seo-icon-${fix.status}`}>
              {STATUS_ICON[fix.status]}
            </span>
            <div className="seo-topfix-body">
              <div className="seo-topfix-top">
                <span className="seo-issue-cat-badge">{fix.category}</span>
                <span className="seo-issue-label">{fix.label}</span>
                {fix.totalPages > 1 && (
                  <span className="seo-topfix-pages">
                    {fix.pagesAffected}/{fix.totalPages} pages
                  </span>
                )}
              </div>
              {fix.fix && (
                <span className="seo-item-fix">
                  <strong>How to fix:</strong> {fix.fix}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PagesScannedPanel({ pages }: { pages: PageResult[] }) {
  if (!pages || pages.length <= 1) return null;
  return (
    <div className="seo-pages-panel">
      <h3 className="seo-pages-title">Pages scanned ({pages.length})</h3>
      <div className="seo-pages-list">
        {pages.map((page, i) => {
          let pathname = "/";
          try { pathname = new URL(page.url).pathname || "/"; } catch { /* keep default */ }
          const gradeColor = page.pageScore >= 70 ? "var(--navy)" : page.pageScore >= 40 ? "var(--stone-on-light)" : "var(--danger)";
          return (
            <div key={i} className="seo-page-row">
              <span className="seo-page-grade" style={{ color: gradeColor }}>{page.pageGrade}</span>
              <div className="seo-page-info">
                <span className="seo-page-pathname">{pathname}</span>
                {page.title && <span className="seo-page-title-text">{page.title}</span>}
              </div>
              <div className="seo-page-counts">
                {page.failCount > 0 && (
                  <span className="seo-page-badge seo-page-badge-fail">{page.failCount} failed</span>
                )}
                {page.warnCount > 0 && (
                  <span className="seo-page-badge seo-page-badge-warn">{page.warnCount} warn</span>
                )}
                {page.failCount === 0 && page.warnCount === 0 && (
                  <span className="seo-page-badge seo-page-badge-pass">All pass</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CategoryCard({ cat }: { cat: CategoryResult }) {
  const [expanded, setExpanded] = useState(true);
  const pct = cat.maxScore > 0 ? Math.round((cat.score / cat.maxScore) * 100) : 0;
  const passCount = cat.items.filter((i) => i.status === "pass").length;
  const warnCount = cat.items.filter((i) => i.status === "warn").length;
  const failCount = cat.items.filter((i) => i.status === "fail").length;

  return (
    <div className="seo-cat-card">
      <button
        className="seo-cat-header"
        onClick={() => setExpanded(!expanded)}
        type="button"
        aria-expanded={expanded}
      >
        <div className="seo-cat-header-top">
          <h3 className="seo-cat-name">{cat.name}</h3>
          <span className="seo-cat-toggle">{expanded ? "▴" : "▾"}</span>
        </div>
        <div className="seo-cat-score-row">
          <div className="seo-cat-bar-track">
            <div
              className="seo-cat-bar-fill"
              style={{
                width: `${pct}%`,
                background: pct >= 70 ? "var(--navy)" : pct >= 40 ? "var(--stone)" : "var(--danger)",
              }}
            />
          </div>
          <span className="seo-cat-pct">{pct}%</span>
        </div>
        <div className="seo-cat-counts">
          {passCount > 0 && <span className="seo-count seo-count-pass">{passCount} passed</span>}
          {warnCount > 0 && <span className="seo-count seo-count-warn">{warnCount} warning{warnCount > 1 ? "s" : ""}</span>}
          {failCount > 0 && <span className="seo-count seo-count-fail">{failCount} failed</span>}
        </div>
      </button>
      {expanded && (
        <ul className="seo-cat-items">
          {cat.items.map((item, i) => (
            <li key={i} className={`seo-item seo-item-${item.status}`}>
              <span className={`seo-item-icon seo-icon-${item.status}`}>
                {STATUS_ICON[item.status]}
              </span>
              <div className="seo-item-body">
                <span className="seo-item-label">{item.label}</span>
                <span className="seo-item-detail">{item.detail}</span>
                {item.fix && item.status !== "pass" && (
                  <span className="seo-item-fix">
                    <strong>How to fix:</strong> {item.fix}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SeoReport({
  result,
  onReset,
  hideCta = false,
}: {
  result: SeoCheckResult;
  onReset: () => void;
  hideCta?: boolean;
}) {
  const [tab, setTab] = useState<"overview" | "issues">("overview");

  const allIssues = result.categories.flatMap((c) =>
    c.items
      .filter((i) => i.status !== "pass")
      .map((i) => ({ ...i, category: c.name }))
  );
  const failItems = allIssues.filter((i) => i.status === "fail");
  const warnItems = allIssues.filter((i) => i.status === "warn");
  const totalChecks = result.categories.reduce((sum, c) => sum + c.items.length, 0);
  const passedChecks = totalChecks - allIssues.length;
  const pagesScanned = result.pagesScanned ?? 1;

  return (
    <div className="seo-report">
      {/* ── Header ──────────────────────────────────── */}
      <div className="seo-report-header">
        <div className="seo-report-hero">
          <div className="seo-gauges">
            <GradeRing score={result.overallScore} grade={result.grade} label="SEO Health" />
            <GradeRing score={result.aiSearchScore} grade={result.aiSearchGrade} label="AI Search" />
            {result.aiPolicyScore !== undefined && (
              <GradeRing score={result.aiPolicyScore} grade={result.aiPolicyGrade ?? "?"} label="Content Policy" size={120} />
            )}
          </div>
          <div className="seo-report-hero-text">
            <div className="seo-report-eyebrow">
              Multi-page diagnostic &middot; {pagesScanned} page{pagesScanned > 1 ? "s" : ""} scanned
            </div>
            <h2 className="seo-report-domain">{result.domain}</h2>
            <p className="seo-report-summary">
              {passedChecks} of {totalChecks} checks passed.{" "}
              {failItems.length > 0 && `${failItems.length} failed check${failItems.length > 1 ? "s" : ""}. `}
              {warnItems.length > 0 && `${warnItems.length} warning${warnItems.length > 1 ? "s" : ""}.`}
            </p>
          </div>
        </div>

        {/* ── Top Fixes ─────────────────────────────── */}
        {result.topFixes && result.topFixes.length > 0 && (
          <div className="seo-header-section">
            <TopFixesPanel topFixes={result.topFixes} />
          </div>
        )}

        {/* ── AI Bot Panel ──────────────────────────── */}
        {result.aiBots && result.aiBots.length > 0 && (
          <div className="seo-header-section">
            <AiBotPanel bots={result.aiBots} />
          </div>
        )}
      </div>

      {/* ── Tab Bar ─────────────────────────────────── */}
      <div className="seo-tabs">
        <button
          className={`seo-tab ${tab === "overview" ? "seo-tab-active" : ""}`}
          onClick={() => setTab("overview")}
          type="button"
        >
          Overview
        </button>
        <button
          className={`seo-tab ${tab === "issues" ? "seo-tab-active" : ""}`}
          onClick={() => setTab("issues")}
          type="button"
        >
          Issues ({allIssues.length})
        </button>
      </div>

      {/* ── Overview Tab ────────────────────────────── */}
      {tab === "overview" && (
        <div>
          {result.pages && result.pages.length > 1 && (
            <div className="seo-overview-pages">
              <PagesScannedPanel pages={result.pages} />
            </div>
          )}
          <div className="seo-categories">
            {result.categories.map((cat, i) => (
              <CategoryCard key={i} cat={cat} />
            ))}
          </div>
        </div>
      )}

      {/* ── Issues Tab ──────────────────────────────── */}
      {tab === "issues" && (
        <div className="seo-issues-tab">
          {failItems.length > 0 && (
            <div className="seo-issues-group">
              <h3 className="seo-issues-group-title seo-issues-fail-title">
                Failed checks ({failItems.length})
              </h3>
              <ul className="seo-issues-list">
                {failItems.map((issue, i) => (
                  <li key={i} className="seo-issue-row">
                    <span className="seo-item-icon seo-icon-fail">{STATUS_ICON.fail}</span>
                    <div className="seo-issue-body">
                      <div className="seo-issue-top">
                        <span className="seo-issue-cat-badge">{issue.category}</span>
                        <span className="seo-issue-label">{issue.label}</span>
                      </div>
                      <span className="seo-item-detail">{issue.detail}</span>
                      {issue.fix && (
                        <span className="seo-item-fix">
                          <strong>How to fix:</strong> {issue.fix}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {warnItems.length > 0 && (
            <div className="seo-issues-group">
              <h3 className="seo-issues-group-title seo-issues-warn-title">
                Warnings ({warnItems.length})
              </h3>
              <ul className="seo-issues-list">
                {warnItems.map((issue, i) => (
                  <li key={i} className="seo-issue-row">
                    <span className="seo-item-icon seo-icon-warn">{STATUS_ICON.warn}</span>
                    <div className="seo-issue-body">
                      <div className="seo-issue-top">
                        <span className="seo-issue-cat-badge">{issue.category}</span>
                        <span className="seo-issue-label">{issue.label}</span>
                      </div>
                      <span className="seo-item-detail">{issue.detail}</span>
                      {issue.fix && (
                        <span className="seo-item-fix">
                          <strong>How to fix:</strong> {issue.fix}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {allIssues.length === 0 && (
            <p className="seo-no-issues">No issues found. All checks passed.</p>
          )}
        </div>
      )}

      {/* ── CTA (prospect-facing; hidden for operator use) ── */}
      {!hideCta && (
        <div className="seo-report-cta">
          <div className="seo-cta-card">
            <h3 className="seo-cta-title">Want these issues fixed?</h3>
            <p className="seo-cta-sub">
              CaseLoad Select builds the SEO and AI visibility infrastructure that puts your firm
              in front of the right clients. We fix these issues as part of the system.
            </p>
            <a href="/home#final-cta" className="seo-cta-btn">
              Learn how it works
            </a>
          </div>
        </div>
      )}

      <div className="seo-report-footer">
        <button onClick={onReset} className="seo-reset-btn">Check another site</button>
        <p className="seo-report-ts">
          Checked {new Date(result.checkedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      <style>{`
        .seo-report { max-width: 860px; margin: 0 auto; }

        /* ── Header ──────────────────────────────────── */
        .seo-report-header {
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          padding: var(--sp-7) var(--sp-6);
          margin-bottom: var(--sp-5);
        }
        .seo-report-hero {
          display: flex;
          gap: var(--sp-6);
          align-items: flex-start;
          margin-bottom: var(--sp-5);
        }
        .seo-gauges {
          display: flex;
          gap: var(--sp-4);
          flex-shrink: 0;
          align-items: flex-end;
        }
        .seo-gauge {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .seo-gauge-inner {
          position: absolute;
          top: 0;
          left: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .seo-gauge-letter {
          font-family: var(--font-display);
          font-size: 28px;
          font-weight: 800;
          line-height: 1;
        }
        .seo-gauge-num {
          font-family: var(--font-display);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
          color: var(--text-muted);
          margin-top: 4px;
        }
        .seo-gauge-label {
          font-family: var(--font-display);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: var(--ls-eyebrow);
          text-transform: uppercase;
          color: var(--text-muted);
          margin-top: var(--sp-2);
          white-space: nowrap;
        }
        .seo-report-hero-text { flex: 1; padding-top: var(--sp-3); }
        .seo-report-eyebrow {
          font-family: var(--font-display);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: var(--ls-eyebrow);
          text-transform: uppercase;
          color: var(--stone-on-light);
          margin-bottom: var(--sp-2);
        }
        .seo-report-domain {
          font-family: var(--font-display);
          font-size: var(--fs-h3);
          font-weight: 800;
          color: var(--navy);
          margin: 0 0 var(--sp-3);
        }
        .seo-report-summary {
          font-size: 14.5px;
          color: var(--text-muted);
          line-height: 1.65;
          margin: 0;
        }

        /* ── Divider sections in header ──────────────── */
        .seo-header-section {
          border-top: 1px solid var(--border);
          padding-top: var(--sp-5);
          margin-top: var(--sp-5);
        }

        /* ── Top Fixes ───────────────────────────────── */
        .seo-topfixes-header {
          display: flex;
          align-items: center;
          gap: var(--sp-3);
          margin-bottom: var(--sp-4);
        }
        .seo-topfixes-title {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 700;
          color: var(--navy);
          margin: 0;
        }
        .seo-topfixes-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: var(--sp-2);
        }
        .seo-topfix-row {
          display: flex;
          gap: var(--sp-3);
          align-items: flex-start;
          padding: var(--sp-2) 0;
        }
        .seo-topfix-body { flex: 1; }
        .seo-topfix-top {
          display: flex;
          align-items: center;
          gap: var(--sp-2);
          flex-wrap: wrap;
          margin-bottom: 2px;
        }
        .seo-topfix-pages {
          font-family: var(--font-display);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: var(--stone-on-light);
          background: var(--parchment);
          padding: 2px 7px;
          border-radius: 3px;
          white-space: nowrap;
        }

        /* ── AI Bot Panel ────────────────────────────── */
        .seo-bots-header {
          display: flex;
          align-items: center;
          gap: var(--sp-3);
          margin-bottom: var(--sp-4);
        }
        .seo-bots-title {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 700;
          color: var(--navy);
          margin: 0;
        }
        .seo-bots-badge {
          font-family: var(--font-display);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          padding: 3px 10px;
          border-radius: 20px;
        }
        .seo-bots-badge-ok { background: rgba(30,47,88,0.08); color: var(--navy); }
        .seo-bots-badge-warn { background: rgba(192,57,43,0.08); color: var(--danger); }
        .seo-bots-section { margin-bottom: var(--sp-3); }
        .seo-bots-section:last-child { margin-bottom: 0; }
        .seo-bots-section-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          display: block;
          margin-bottom: var(--sp-2);
        }
        .seo-bots-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: var(--sp-1) var(--sp-4);
        }
        .seo-bot-row {
          display: flex;
          align-items: center;
          gap: var(--sp-2);
          padding: 4px 0;
        }
        .seo-bot-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .seo-bot-dot-ok { background: var(--navy); }
        .seo-bot-dot-blocked { background: var(--danger); }
        .seo-bot-dot-warn { background: var(--stone); }
        .seo-bot-name {
          font-size: 12.5px;
          color: var(--text);
          flex: 1;
        }
        .seo-bot-status {
          font-family: var(--font-display);
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .seo-bot-status-ok { color: var(--navy); }
        .seo-bot-status-blocked { color: var(--danger); }
        .seo-bot-status-warn { color: var(--stone-on-light); }

        /* ── Pages Scanned ───────────────────────────── */
        .seo-overview-pages { margin-bottom: var(--sp-5); }
        .seo-pages-panel {
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          padding: var(--sp-5);
        }
        .seo-pages-title {
          font-family: var(--font-display);
          font-size: 14px;
          font-weight: 700;
          color: var(--navy);
          margin: 0 0 var(--sp-4);
        }
        .seo-pages-list {
          display: flex;
          flex-direction: column;
          gap: var(--sp-2);
        }
        .seo-page-row {
          display: flex;
          align-items: center;
          gap: var(--sp-3);
          padding: var(--sp-2) 0;
          border-bottom: 1px solid var(--border-soft);
        }
        .seo-page-row:last-child { border-bottom: none; }
        .seo-page-grade {
          font-family: var(--font-display);
          font-size: 18px;
          font-weight: 800;
          width: 28px;
          text-align: center;
          flex-shrink: 0;
        }
        .seo-page-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .seo-page-pathname {
          font-size: 13px;
          font-weight: 600;
          color: var(--navy);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .seo-page-title-text {
          font-size: 11.5px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .seo-page-counts {
          display: flex;
          gap: var(--sp-2);
          flex-shrink: 0;
        }
        .seo-page-badge {
          font-family: var(--font-display);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 10px;
          white-space: nowrap;
        }
        .seo-page-badge-fail { background: rgba(192,57,43,0.08); color: var(--danger); }
        .seo-page-badge-warn { background: rgba(196,180,154,0.18); color: var(--stone-on-light); }
        .seo-page-badge-pass { background: rgba(30,47,88,0.08); color: var(--navy); }

        /* ── Tabs ────────────────────────────────────── */
        .seo-tabs {
          display: flex;
          gap: 0;
          margin-bottom: var(--sp-5);
          border-bottom: 2px solid var(--border);
        }
        .seo-tab {
          font-family: var(--font-display);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: var(--ls-button);
          text-transform: uppercase;
          color: var(--text-muted);
          background: none;
          border: none;
          padding: var(--sp-3) var(--sp-5);
          cursor: pointer;
          border-bottom: 2px solid transparent;
          margin-bottom: -2px;
          transition: color 0.2s, border-color 0.2s;
        }
        .seo-tab:hover { color: var(--navy); }
        .seo-tab-active {
          color: var(--navy);
          border-bottom-color: var(--navy);
        }

        /* ── Category Cards ──────────────────────────── */
        .seo-categories {
          display: flex;
          flex-direction: column;
          gap: var(--sp-4);
          margin-bottom: var(--sp-7);
        }
        .seo-cat-card {
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          overflow: hidden;
        }
        .seo-cat-header {
          display: block;
          width: 100%;
          text-align: left;
          padding: var(--sp-5) var(--sp-5) var(--sp-4);
          border: none;
          border-bottom: 1px solid var(--border);
          background: none;
          cursor: pointer;
        }
        .seo-cat-header:hover { background: var(--parchment); }
        .seo-cat-header-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--sp-3);
        }
        .seo-cat-name {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 700;
          color: var(--navy);
          margin: 0;
        }
        .seo-cat-toggle {
          font-size: 14px;
          color: var(--text-muted);
        }
        .seo-cat-score-row {
          display: flex;
          align-items: center;
          gap: var(--sp-3);
          margin-bottom: var(--sp-2);
        }
        .seo-cat-bar-track {
          flex: 1;
          height: 6px;
          background: var(--parchment);
          border-radius: 3px;
          overflow: hidden;
        }
        .seo-cat-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.8s ease-out;
        }
        .seo-cat-pct {
          font-family: var(--font-display);
          font-size: 13px;
          font-weight: 700;
          color: var(--navy);
          min-width: 36px;
          text-align: right;
        }
        .seo-cat-counts {
          display: flex;
          gap: var(--sp-3);
        }
        .seo-count {
          font-family: var(--font-display);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .seo-count-pass { color: var(--navy); }
        .seo-count-warn { color: var(--stone-on-light); }
        .seo-count-fail { color: var(--danger); }

        /* ── Item Rows ───────────────────────────────── */
        .seo-cat-items {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .seo-item {
          display: flex;
          gap: var(--sp-3);
          padding: var(--sp-3) var(--sp-5);
          border-bottom: 1px solid var(--border-soft);
          align-items: flex-start;
        }
        .seo-item:last-child { border-bottom: none; }
        .seo-item-icon {
          font-size: 13px;
          font-weight: 700;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .seo-icon-pass { color: var(--navy); background: rgba(30,47,88,0.08); }
        .seo-icon-warn { color: var(--stone-on-light); background: rgba(196,180,154,0.18); font-size: 9px; }
        .seo-icon-fail { color: var(--danger); background: rgba(192,57,43,0.08); }
        .seo-item-body { flex: 1; }
        .seo-item-label {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text);
          display: block;
          margin-bottom: 2px;
        }
        .seo-item-detail {
          font-size: 12.5px;
          color: var(--text-muted);
          line-height: 1.55;
          display: block;
        }
        .seo-item-fix {
          font-size: 12px;
          color: var(--navy);
          line-height: 1.55;
          display: block;
          margin-top: 4px;
          padding: 6px 10px;
          background: rgba(30,47,88,0.04);
          border-radius: 4px;
          border-left: 2px solid var(--navy);
        }
        .seo-item-fix strong {
          font-weight: 700;
          font-size: 10px;
          letter-spacing: 0.6px;
          text-transform: uppercase;
        }

        /* ── Issues Tab ──────────────────────────────── */
        .seo-issues-tab { margin-bottom: var(--sp-7); }
        .seo-issues-group {
          background: var(--white);
          border: 1px solid var(--border);
          border-radius: var(--r-card);
          overflow: hidden;
          margin-bottom: var(--sp-4);
        }
        .seo-issues-group-title {
          font-family: var(--font-display);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: var(--ls-label);
          text-transform: uppercase;
          padding: var(--sp-4) var(--sp-5) var(--sp-3);
          margin: 0;
        }
        .seo-issues-fail-title { color: var(--danger); }
        .seo-issues-warn-title { color: var(--stone-on-light); }
        .seo-issues-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .seo-issue-row {
          display: flex;
          gap: var(--sp-3);
          padding: var(--sp-3) var(--sp-5);
          border-top: 1px solid var(--border-soft);
          align-items: flex-start;
        }
        .seo-issue-body { flex: 1; }
        .seo-issue-top {
          display: flex;
          align-items: center;
          gap: var(--sp-2);
          margin-bottom: 2px;
          flex-wrap: wrap;
        }
        .seo-issue-cat-badge {
          font-family: var(--font-display);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: var(--stone-on-light);
          background: var(--parchment);
          padding: 2px 7px;
          border-radius: 3px;
          white-space: nowrap;
        }
        .seo-issue-label {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text);
        }
        .seo-no-issues {
          text-align: center;
          color: var(--text-muted);
          font-size: 14px;
          padding: var(--sp-7) 0;
        }

        /* ── CTA ─────────────────────────────────────── */
        .seo-report-cta { margin-bottom: var(--sp-6); }
        .seo-cta-card {
          background: var(--navy);
          border-radius: var(--r-card);
          padding: var(--sp-7) var(--sp-6);
          text-align: center;
        }
        .seo-cta-title {
          font-family: var(--font-display);
          font-size: var(--fs-h3);
          font-weight: 800;
          color: var(--white);
          margin: 0 0 var(--sp-3);
        }
        .seo-cta-sub {
          font-size: 14.5px;
          color: var(--slate);
          line-height: 1.65;
          max-width: 520px;
          margin: 0 auto var(--sp-5);
        }
        .seo-cta-btn {
          display: inline-block;
          font-family: var(--font-display);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: var(--ls-button);
          text-transform: uppercase;
          color: var(--navy);
          background: var(--stone);
          padding: 14px 36px;
          border-radius: var(--r-tight);
          text-decoration: none;
          transition: background 0.2s;
        }
        .seo-cta-btn:hover { background: var(--stone-light); }

        .seo-report-footer {
          text-align: center;
          padding: var(--sp-5) 0;
        }
        .seo-reset-btn {
          font-family: var(--font-body);
          font-size: 13px;
          color: var(--text-muted);
          background: none;
          border: 1px solid var(--border);
          padding: 10px 24px;
          border-radius: var(--r-tight);
          cursor: pointer;
          transition: border-color 0.2s, color 0.2s;
          margin-bottom: var(--sp-3);
        }
        .seo-reset-btn:hover { border-color: var(--navy); color: var(--navy); }
        .seo-report-ts {
          font-size: 11px;
          color: var(--text-muted);
          margin: 0;
        }

        @media (max-width: 768px) {
          .seo-report-hero { flex-direction: column; }
          .seo-gauges { justify-content: center; }
          .seo-report-hero-text { text-align: center; }
          .seo-bots-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .seo-report-header { padding: var(--sp-5) var(--sp-4); }
          .seo-gauges { gap: var(--sp-3); }
          .seo-cat-header { padding: var(--sp-4); }
          .seo-item { padding: var(--sp-3) var(--sp-4); }
          .seo-issue-row { padding: var(--sp-3) var(--sp-4); }
          .seo-cta-card { padding: var(--sp-6) var(--sp-4); }
          .seo-pages-panel { padding: var(--sp-4); }
        }
      `}</style>
    </div>
  );
}
