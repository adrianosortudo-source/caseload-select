"use client";

import { useState } from "react";
import {
  formatCallAgenda,
  formatReportText,
  PILLAR_LABEL,
  type ActsPillar,
  type DiagnosticFinding,
  type DomainScan,
  type ProspectingDiagnostic,
} from "../_lib/prospecting";

export interface SavedDiagnosticRunPayload {
  id: string;
  prospect_firm_name: string;
  primary_domain: string;
  market: string | null;
  practice_focus: string | null;
  target_keyword: string | null;
  scan_mode: string;
  pages_scanned: number;
  total_pages_scanned: number;
  overall_score: number | null;
  ai_search_score: number | null;
  intent_score: number | null;
  prospect_fit_score: number | null;
  website_maturity: string | null;
  urgency_level: string | null;
  diagnostic: ProspectingDiagnostic;
  scans: DomainScan[];
  created_at: string;
}

const PILLAR_ORDER: ActsPillar[] = ["authority", "capture", "target", "screen"];

function safePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || "");
  } catch {
    return url;
  }
}

function downloadText(filename: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "diagnostic";
}

export default function SavedDiagnosticDetail({ run, priorRunId }: { run: SavedDiagnosticRunPayload; priorRunId?: string }) {
  const [copied, setCopied] = useState("");
  const diag = run.diagnostic;

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? "" : c)), 1600);
    } catch {
      setCopied("");
    }
  }

  function exportJson() {
    const date = (run.created_at || "").slice(0, 10) || "saved";
    downloadText(
      `saved-prospecting-diagnostic-${slugify(run.prospect_firm_name)}-${date}.json`,
      JSON.stringify({ run, diagnostic: diag, scans: run.scans }, null, 2),
      "application/json"
    );
  }

  return (
    <div className="saved-diagnostic-print grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="print-cover hidden">
        <div className="text-[10px] uppercase tracking-[0.2em] text-black/45 font-semibold">CaseLoad Select</div>
        <h1 className="font-display text-3xl font-extrabold text-navy mt-2">{run.prospect_firm_name}</h1>
        <p className="text-sm text-black/60 mt-1">SEO and AI visibility diagnostic for {run.primary_domain}</p>
        <p className="text-xs text-black/45 mt-3">
          Saved {new Date(run.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </div>
      <div className="lg:col-span-2 space-y-6">
        <section className="bg-white border border-black/8 p-5 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <ScoreBox label="SEO" value={run.overall_score} suffix="/100" />
            <ScoreBox label="AI Search" value={run.ai_search_score} suffix="/100" />
            <ScoreBox label="Intent" value={run.intent_score} suffix="/100" />
            <ScoreBox label="Fit" value={run.prospect_fit_score} suffix="/100" />
            <ScoreBox label="Pages" value={run.total_pages_scanned || run.pages_scanned} />
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-black/65">
            <Meta label="Domain" value={run.primary_domain} mono />
            <Meta label="Saved" value={new Date(run.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })} />
            <Meta label="Market" value={run.market || diag.prospect.market || "n/a"} />
            <Meta label="Practice focus" value={run.practice_focus || diag.prospect.practiceFocus || "n/a"} />
            <Meta label="Target intent" value={run.target_keyword || "n/a"} />
            <Meta label="Scan mode" value={run.scan_mode} />
          </div>
        </section>

        <section className="bg-white border border-black/8 p-5 sm:p-6">
          <h2 className="text-base font-bold text-navy mb-3">Report-ready summary</h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-black/75">{diag.reportReadySummary}</p>
        </section>

        {PILLAR_ORDER.map((pillar) => (
          <PillarSection key={pillar} pillar={pillar} findings={diag.actsFindings[pillar]} />
        ))}

        {diag.domainComparison && (
          <section className="bg-white border border-black/8 p-5 sm:p-6">
            <h2 className="text-base font-bold text-navy">Domain comparison</h2>
            <SimpleRows
              headers={["Domain", "Role", "Pages", "Score", "Signal"]}
              rows={diag.domainComparison.rows.map((r) => [
                r.domain,
                r.role,
                r.reachable ? String(r.pagesScanned) : "n/a",
                r.overallScore === null ? "n/a" : String(r.overallScore),
                r.note,
              ])}
            />
            <p className="text-sm text-black/70 mt-3">
              <span className="font-semibold text-navy">Recommendation: </span>
              {diag.domainComparison.canonicalRecommendation}
            </p>
          </section>
        )}

        {diag.competitorComparison && (
          <section className="bg-white border border-black/8 p-5 sm:p-6">
            <h2 className="text-base font-bold text-navy">Competitor comparison</h2>
            <SimpleRows
              headers={["Competitor", "Pages", "SEO", "AI", "Intent", "Signal"]}
              rows={diag.competitorComparison.rows.map((r) => [
                r.domain,
                r.reachable ? String(r.pagesScanned) : "n/a",
                r.overallScore === null ? "n/a" : String(r.overallScore),
                r.aiSearchScore === null ? "n/a" : String(r.aiSearchScore),
                r.intentScore === null ? "n/a" : String(r.intentScore),
                r.note,
              ])}
            />
            {diag.competitorComparison.gaps.length > 0 && (
              <p className="text-sm text-black/75 mt-3"><span className="font-semibold text-navy">Gaps: </span>{diag.competitorComparison.gaps.join(" ")}</p>
            )}
            {diag.competitorComparison.advantages.length > 0 && (
              <p className="text-sm text-black/75 mt-2"><span className="font-semibold text-navy">Advantages: </span>{diag.competitorComparison.advantages.join(" ")}</p>
            )}
          </section>
        )}

        <section className="bg-white border border-black/8 p-5 sm:p-6">
          <h2 className="text-base font-bold text-navy mb-3">30 / 60 / 90 day plan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <PlanColumn title="First 30 days" items={diag.thirtySixtyNinetyPlan.day30} />
            <PlanColumn title="Days 30 to 60" items={diag.thirtySixtyNinetyPlan.day60} />
            <PlanColumn title="Days 60 to 90" items={diag.thirtySixtyNinetyPlan.day90} />
          </div>
        </section>

        <section className="bg-white border border-black/8 p-5 sm:p-6">
          <h2 className="text-base font-bold text-navy mb-3">Strategic call questions</h2>
          <ol className="space-y-2 list-decimal pl-5">
            {diag.strategicCallQuestions.map((q, i) => (
              <li key={i} className="text-sm text-black/75">{q}</li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="lg:col-span-1 space-y-6 lg:sticky lg:top-6 self-start">
        <section className="bg-navy text-white p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold mb-2">Opening angle</h2>
          <p className="text-sm leading-relaxed text-white/90">{diag.recommendedOpeningAngle}</p>
        </section>

        <section className="bg-white border border-black/8 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-navy mb-3">Top outreach hooks</h2>
          <ul className="space-y-2.5">
            {diag.topOutreachHooks.map((h, i) => (
              <li key={i} className="text-sm text-black/75 flex gap-2">
                <span className="text-gold font-bold shrink-0">{i + 1}.</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="print-actions bg-white border border-black/8 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-navy mb-3">Actions</h2>
          <div className="flex flex-col gap-2">
            <ActionButton label="Copy report summary" active={copied === "report"} onClick={() => copy("report", formatReportText(diag))} />
            <ActionButton label="Copy call agenda" active={copied === "agenda"} onClick={() => copy("agenda", formatCallAgenda(diag))} />
            <ActionButton label="Copy cold email" active={copied === "email"} onClick={() => copy("email", diag.coldEmailDraft)} />
            <button
              type="button"
              onClick={() => window.print()}
              className="w-full text-center bg-navy text-white font-display text-[11px] font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-navy/90 transition"
            >
              Print / PDF
            </button>
            {priorRunId && (
              <a
                href={`/admin/prospecting-diagnostic/compare?before=${priorRunId}&after=${run.id}`}
                className="w-full text-center text-[11px] font-display font-bold uppercase tracking-wider px-4 py-2 border border-black/15 text-navy hover:border-navy transition"
              >
                Compare to previous
              </a>
            )}
            <button
              type="button"
              onClick={exportJson}
              className="w-full text-center bg-gold text-deep-black font-display text-[11px] font-bold uppercase tracking-wider px-4 py-2.5 hover:opacity-90 transition"
            >
              Download JSON
            </button>
          </div>
        </section>

        <section className="bg-white border border-black/8 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-navy mb-3">Cold email draft</h2>
          <pre className="text-xs text-black/75 whitespace-pre-wrap font-sans leading-relaxed bg-parchment border border-black/8 p-3 max-h-96 overflow-y-auto">
            {diag.coldEmailDraft}
          </pre>
        </section>

        <InternalScores scans={run.scans} />
      </aside>
      <div className="print-footer hidden">
        CaseLoad Select - Internal prospecting diagnostic - adriano@caseloadselect.ca
      </div>
      <style>{`
        @media print {
          @page { margin: 0.55in; }
          html, body { background: #fff !important; }
          main { max-width: none !important; padding: 0 !important; }
          .saved-diagnostic-print {
            display: block !important;
            color: #111 !important;
          }
          .saved-diagnostic-print .print-cover,
          .saved-diagnostic-print .print-footer {
            display: block !important;
          }
          .saved-diagnostic-print .print-cover {
            border-bottom: 2px solid #1e2f58;
            padding-bottom: 16px;
            margin-bottom: 18px;
          }
          .saved-diagnostic-print .print-footer {
            border-top: 1px solid #ddd;
            margin-top: 18px;
            padding-top: 8px;
            font-size: 10px;
            color: #666;
          }
          .saved-diagnostic-print .print-actions,
          .saved-diagnostic-print button,
          .saved-diagnostic-print a[href*="/admin/prospecting-diagnostic/compare"],
          .saved-diagnostic-print a[href*="/admin/prospecting-diagnostic/runs"] {
            display: none !important;
          }
          .saved-diagnostic-print aside {
            position: static !important;
            display: block !important;
            margin-top: 18px;
          }
          .saved-diagnostic-print section,
          .saved-diagnostic-print details,
          .saved-diagnostic-print table,
          .saved-diagnostic-print li {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .saved-diagnostic-print section,
          .saved-diagnostic-print details {
            border: 1px solid #ddd !important;
            background: #fff !important;
            margin-bottom: 14px !important;
            padding: 14px !important;
          }
          .saved-diagnostic-print .bg-navy {
            background: #1e2f58 !important;
            color: #fff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .saved-diagnostic-print .bg-parchment {
            background: #f7f4ee !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .saved-diagnostic-print pre {
            max-height: none !important;
            overflow: visible !important;
            white-space: pre-wrap !important;
          }
        }
      `}</style>
    </div>
  );
}

function ScoreBox({ label, value, suffix = "" }: { label: string; value: number | null | undefined; suffix?: string }) {
  return (
    <div className="border border-black/8 bg-parchment p-3">
      <div className="text-[10px] uppercase tracking-wider text-black/45 font-semibold">{label}</div>
      <div className="font-display text-2xl font-extrabold text-navy mt-1">{value ?? "n/a"}{value !== null && value !== undefined ? suffix : ""}</div>
    </div>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="block text-[10px] uppercase tracking-wider text-black/40 font-semibold">{label}</span>
      <span className={mono ? "font-mono text-navy" : "text-black/75"}>{value}</span>
    </div>
  );
}

function PillarSection({ pillar, findings }: { pillar: ActsPillar; findings: DiagnosticFinding[] }) {
  return (
    <section className="bg-white border border-black/8 p-5 sm:p-6">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="font-display text-2xl font-extrabold text-gold leading-none">{PILLAR_LABEL[pillar].charAt(0)}</span>
        <h2 className="text-base font-bold text-navy">{PILLAR_LABEL[pillar]}</h2>
      </div>
      <div className="space-y-4">
        {findings.map((finding, i) => (
          <div key={i} className="border-l-2 border-black/10 pl-4">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-navy">{finding.title}</h3>
              <span className="text-[10px] uppercase tracking-wider text-black/35">{finding.sourceCategory}</span>
            </div>
            <p className="text-sm text-black/75 leading-relaxed">{finding.businessConsequence}</p>
            <p className="text-xs text-black/45 mt-1.5"><span className="font-semibold uppercase tracking-wider">Evidence: </span>{finding.evidence}</p>
            <p className="text-xs text-black/60 mt-1"><span className="font-semibold uppercase tracking-wider text-black/45">Fix: </span>{finding.recommendedFix}</p>
            {finding.affectedUrls && finding.affectedUrls.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {finding.affectedUrls.map((u) => (
                  <li key={u} className="text-[11px] font-mono text-black/40 truncate max-w-full">{safePath(u)}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function SimpleRows({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-black/45 border-b border-black/10">
            {headers.map((h) => <th key={h} className="py-2 pr-3 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-black/5">
              {row.map((cell, j) => (
                <td key={j} className={`${j === 0 ? "font-mono text-navy" : "text-black/65"} py-2 pr-3`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlanColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gold mb-2">{title}</h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-black/75 leading-snug">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ActionButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-center text-[11px] font-display font-bold uppercase tracking-wider px-4 py-2 border transition ${
        active ? "bg-navy text-white border-navy" : "border-black/15 text-navy hover:border-navy"
      }`}
    >
      {active ? "Copied" : label}
    </button>
  );
}

function InternalScores({ scans }: { scans: DomainScan[] }) {
  const withResults = scans.filter((s) => s.result);
  if (withResults.length === 0) return null;
  return (
    <details className="bg-white border border-black/8 p-5">
      <summary className="text-xs font-semibold uppercase tracking-[0.15em] text-black/50 cursor-pointer select-none">
        Raw scan scores
      </summary>
      <div className="mt-3 space-y-3">
        {withResults.map((s) => {
          const r = s.result!;
          return (
            <div key={`${s.role}-${s.domain}`} className="text-xs border-t border-black/8 pt-3 first:border-t-0 first:pt-0">
              <div className="font-mono text-navy mb-1">{s.domain}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-black/60">
                <span>Role</span><span className="text-right">{s.role}</span>
                <span>Overall</span><span className="text-right font-semibold text-navy">{r.overallScore}/100 ({r.grade})</span>
                <span>AI search</span><span className="text-right font-semibold text-navy">{r.aiSearchScore}/100</span>
                <span>AI policy</span><span className="text-right font-semibold text-navy">{r.aiPolicyScore}/100</span>
                {r.intentAlignment && (
                  <>
                    <span>Intent</span><span className="text-right font-semibold text-navy">{r.intentAlignment.score}/100</span>
                  </>
                )}
                <span>Pages</span><span className="text-right">{r.pagesScanned}{r.partial ? " (partial)" : ""}</span>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
