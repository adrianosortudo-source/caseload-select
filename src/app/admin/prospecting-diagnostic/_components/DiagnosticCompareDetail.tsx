"use client";

import { useState } from "react";
import type { DiagnosticComparison, IssueMovement, ScoreDelta } from "../_lib/compare";

function pathOrUrl(url: string | null): string {
  if (!url) return "n/a";
  try {
    const u = new URL(url);
    return u.pathname + (u.search || "");
  } catch {
    return url;
  }
}

function formatDate(s: string): string {
  return new Date(s).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function deltaText(delta: number | null): string {
  if (delta === null) return "n/a";
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function deltaClass(delta: number | null): string {
  if (delta === null || delta === 0) return "text-black/45";
  return delta > 0 ? "text-emerald-700" : "text-red-700";
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

function summaryText(c: DiagnosticComparison): string {
  const lines: string[] = [];
  lines.push(`Diagnostic comparison: ${c.after.primary_domain}`);
  lines.push(`Before: ${formatDate(c.before.created_at)} (${c.before.id})`);
  lines.push(`After: ${formatDate(c.after.created_at)} (${c.after.id})`);
  lines.push("");
  lines.push("Score movement:");
  c.scoreDeltas.forEach((s) => lines.push(`- ${s.label}: ${s.before ?? "n/a"} to ${s.after ?? "n/a"} (${deltaText(s.delta)})`));
  lines.push("");
  lines.push(`New issues: ${c.newIssues.length}`);
  c.newIssues.slice(0, 8).forEach((i) => lines.push(`- ${i.title} (${i.category})`));
  lines.push(`Resolved issues: ${c.resolvedIssues.length}`);
  c.resolvedIssues.slice(0, 8).forEach((i) => lines.push(`- ${i.title} (${i.category})`));
  lines.push(`Persistent issues: ${c.persistentIssues.length}`);
  c.persistentIssues.slice(0, 8).forEach((i) => lines.push(`- ${i.title} (${i.category})`));
  lines.push("");
  lines.push(`Recommended next action: ${c.recommendedNextAction}`);
  return lines.join("\n");
}

export default function DiagnosticCompareDetail({ comparison }: { comparison: DiagnosticComparison }) {
  const [copied, setCopied] = useState("");

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryText(comparison));
      setCopied("summary");
      setTimeout(() => setCopied((c) => (c === "summary" ? "" : c)), 1600);
    } catch {
      setCopied("");
    }
  }

  function exportJson() {
    downloadText(
      `diagnostic-comparison-${comparison.after.primary_domain}-${comparison.after.id}.json`,
      JSON.stringify(comparison, null, 2),
      "application/json"
    );
  }

  return (
    <div className="diagnostic-compare-print grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="print-cover hidden">
        <div className="text-[10px] uppercase tracking-[0.2em] text-black/45 font-semibold">CaseLoad Select</div>
        <h1 className="font-display text-3xl font-extrabold text-navy mt-2">Diagnostic comparison</h1>
        <p className="text-sm text-black/60 mt-1">{comparison.after.primary_domain}</p>
        <p className="text-xs text-black/45 mt-3">
          {formatDate(comparison.before.created_at)} to {formatDate(comparison.after.created_at)}
        </p>
      </div>
      <div className="lg:col-span-2 space-y-6">
        <section className="bg-white border border-black/8 p-5 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <RunCard label="Before" id={comparison.before.id} date={comparison.before.created_at} run={comparison.before} />
            <RunCard label="After" id={comparison.after.id} date={comparison.after.created_at} run={comparison.after} />
          </div>
        </section>

        <section className="bg-white border border-black/8 p-5 sm:p-6">
          <h2 className="text-base font-bold text-navy mb-3">Score movement</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {comparison.scoreDeltas.map((score) => <ScoreDeltaCard key={score.label} score={score} />)}
          </div>
        </section>

        <section className="bg-white border border-black/8 p-5 sm:p-6">
          <h2 className="text-base font-bold text-navy mb-3">Recommended next action</h2>
          <p className="text-sm text-black/75 leading-relaxed">{comparison.recommendedNextAction}</p>
        </section>

        <section className="bg-white border border-black/8 p-5 sm:p-6">
          <h2 className="text-base font-bold text-navy mb-3">Target intent page</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Meta label="Before" value={pathOrUrl(comparison.bestIntentPageBefore)} mono />
            <Meta label="After" value={pathOrUrl(comparison.bestIntentPageAfter)} mono />
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <IssuePanel title="New issues" tone="red" issues={comparison.newIssues} empty="No new issues." />
          <IssuePanel title="Resolved issues" tone="green" issues={comparison.resolvedIssues} empty="No resolved issues." />
          <IssuePanel title="Persistent issues" tone="navy" issues={comparison.persistentIssues} empty="No persistent issues." />
        </section>

        {comparison.competitorChanges.length > 0 && (
          <section className="bg-white border border-black/8 p-5 sm:p-6">
            <h2 className="text-base font-bold text-navy mb-3">Competitor movement</h2>
            <ul className="space-y-2">
              {comparison.competitorChanges.map((change, i) => (
                <li key={i} className="text-sm text-black/75">{change}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="lg:col-span-1 space-y-6 lg:sticky lg:top-6 self-start">
        <section className="bg-navy text-white p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold mb-2">Comparison</h2>
          <p className="text-sm leading-relaxed text-white/90">
            {comparison.before.prospect_firm_name} from {formatDate(comparison.before.created_at)} to {formatDate(comparison.after.created_at)}.
          </p>
        </section>

        <section className="print-actions bg-white border border-black/8 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-navy mb-3">Actions</h2>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={copySummary}
              className={`w-full text-center text-[11px] font-display font-bold uppercase tracking-wider px-4 py-2 border transition ${
                copied === "summary" ? "bg-navy text-white border-navy" : "border-black/15 text-navy hover:border-navy"
              }`}
            >
              {copied === "summary" ? "Copied" : "Copy comparison summary"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="w-full text-center bg-navy text-white font-display text-[11px] font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-navy/90 transition"
            >
              Print / PDF
            </button>
            <button
              type="button"
              onClick={exportJson}
              className="w-full text-center bg-gold text-deep-black font-display text-[11px] font-bold uppercase tracking-wider px-4 py-2.5 hover:opacity-90 transition"
            >
              Download JSON
            </button>
            <a
              href={`/admin/prospecting-diagnostic/runs/${comparison.before.id}`}
              className="w-full text-center text-[11px] font-display font-bold uppercase tracking-wider px-4 py-2 border border-black/15 text-navy hover:border-navy transition"
            >
              Open before
            </a>
            <a
              href={`/admin/prospecting-diagnostic/runs/${comparison.after.id}`}
              className="w-full text-center text-[11px] font-display font-bold uppercase tracking-wider px-4 py-2 border border-black/15 text-navy hover:border-navy transition"
            >
              Open after
            </a>
          </div>
        </section>
      </aside>
      <div className="print-footer hidden">
        CaseLoad Select - Internal before/after diagnostic comparison - adriano@caseloadselect.ca
      </div>
      <style>{`
        @media print {
          @page { margin: 0.55in; }
          html, body { background: #fff !important; }
          main { max-width: none !important; padding: 0 !important; }
          .diagnostic-compare-print {
            display: block !important;
            color: #111 !important;
          }
          .diagnostic-compare-print .print-cover,
          .diagnostic-compare-print .print-footer {
            display: block !important;
          }
          .diagnostic-compare-print .print-cover {
            border-bottom: 2px solid #1e2f58;
            padding-bottom: 16px;
            margin-bottom: 18px;
          }
          .diagnostic-compare-print .print-footer {
            border-top: 1px solid #ddd;
            margin-top: 18px;
            padding-top: 8px;
            font-size: 10px;
            color: #666;
          }
          .diagnostic-compare-print .print-actions,
          .diagnostic-compare-print button,
          .diagnostic-compare-print a[href*="/admin/prospecting-diagnostic/runs"] {
            display: none !important;
          }
          .diagnostic-compare-print aside {
            position: static !important;
            display: block !important;
            margin-top: 18px;
          }
          .diagnostic-compare-print section,
          .diagnostic-compare-print table,
          .diagnostic-compare-print li {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .diagnostic-compare-print section {
            border: 1px solid #ddd !important;
            background: #fff !important;
            margin-bottom: 14px !important;
            padding: 14px !important;
          }
          .diagnostic-compare-print .bg-navy {
            background: #1e2f58 !important;
            color: #fff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .diagnostic-compare-print .bg-parchment {
            background: #f7f4ee !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
}

function RunCard({ label, id, date, run }: { label: string; id: string; date: string; run: DiagnosticComparison["before"] }) {
  return (
    <div className="border border-black/8 bg-parchment p-4">
      <div className="text-[10px] uppercase tracking-wider text-black/45 font-semibold">{label}</div>
      <div className="font-semibold text-navy mt-1">{formatDate(date)}</div>
      <div className="font-mono text-xs text-black/55 mt-1">{id}</div>
      <div className="text-xs text-black/55 mt-2">
        SEO {run.overall_score ?? "n/a"} · AI {run.ai_search_score ?? "n/a"} · Intent {run.intent_score ?? "n/a"}
      </div>
    </div>
  );
}

function ScoreDeltaCard({ score }: { score: ScoreDelta }) {
  return (
    <div className="border border-black/8 bg-parchment p-3">
      <div className="text-[10px] uppercase tracking-wider text-black/45 font-semibold">{score.label}</div>
      <div className="text-xs text-black/50 mt-1">{score.before ?? "n/a"} to {score.after ?? "n/a"}</div>
      <div className={`font-display text-2xl font-extrabold mt-1 ${deltaClass(score.delta)}`}>{deltaText(score.delta)}</div>
    </div>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border border-black/8 bg-parchment p-3">
      <span className="block text-[10px] uppercase tracking-wider text-black/40 font-semibold">{label}</span>
      <span className={mono ? "font-mono text-navy" : "text-black/75"}>{value}</span>
    </div>
  );
}

function IssuePanel({ title, tone, issues, empty }: { title: string; tone: "red" | "green" | "navy"; issues: IssueMovement[]; empty: string }) {
  const color = tone === "red" ? "text-red-700" : tone === "green" ? "text-emerald-700" : "text-navy";
  return (
    <section className="bg-white border border-black/8 p-5">
      <h2 className={`text-sm font-bold mb-3 ${color}`}>{title}</h2>
      {issues.length === 0 ? (
        <p className="text-sm text-black/45">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {issues.slice(0, 12).map((issue) => (
            <li key={issue.id} className="border-l-2 border-black/10 pl-3">
              <div className="text-sm font-semibold text-navy">{issue.title}</div>
              <div className="text-[11px] uppercase tracking-wider text-black/40">{issue.category}</div>
              {(issue.beforeSeverity || issue.afterSeverity || issue.severity) && (
                <div className="text-xs text-black/55 mt-1">
                  {issue.beforeSeverity && issue.afterSeverity
                    ? `${issue.beforeSeverity} to ${issue.afterSeverity}`
                    : issue.severity}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
