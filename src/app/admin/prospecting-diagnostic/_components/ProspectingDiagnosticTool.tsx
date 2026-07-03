"use client";

/**
 * ProspectingDiagnosticTool
 *
 * Operator workspace for the prospecting diagnostic. Collects prospect inputs,
 * runs the existing /api/tools/seo-check engine for the primary domain (and any
 * alternates, in quick mode), then maps the results into the ACTS framework via
 * the pure buildProspectingDiagnostic helper. Renders the four ACTS sections,
 * outreach hooks, strategic call questions, a 30/60/90 plan, an optional domain
 * comparison, and output tools (copy cold email / call agenda / report summary,
 * download JSON). Raw SEO scores stay in a collapsible internal panel.
 */

import { useEffect, useRef, useState } from "react";
import {
  buildProspectingDiagnostic,
  buildScanPlan,
  runScans,
  formatCallAgenda,
  formatReportText,
  PILLAR_LABEL,
  type ActsPillar,
  type ScanMode,
  type DomainScan,
  type DiagnosticFinding,
  type ProspectingDiagnostic,
} from "../_lib/prospecting";
import type { SeoCheckResult } from "../_lib/seo-types";
import { buildResearchPacket, type ProspectEnrichment } from "../_lib/enrich";

type ProgressStatus = "pending" | "scanning" | "done" | "error";

interface ProgressRow {
  domain: string;
  role: "primary" | "alternate" | "competitor";
  status: ProgressStatus;
  error?: string;
}

interface ScanIntentPayload {
  targetKeyword?: string;
  targetMatter?: string;
  targetLocation?: string;
  targetAudience?: string;
}

interface SavedDiagnosticRun {
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
  created_at: string;
}

const SCAN_MODE_PAGES: Record<ScanMode, number> = { quick: 10, standard: 25, deep: 50 };

// Each alternate is a full crawl against the rate-limited SEO route, run
// sequentially. Cap the fan-out so a pasted list cannot tie up the operator UI
// (and the route) indefinitely. Anything past the cap is reported, not silent.
const MAX_ALTERNATES = 4;
const MAX_COMPETITORS = 3;

const PILLAR_BLURB: Record<ActsPillar, string> = {
  authority: "Trust, entity clarity, reviews, schema, AI confidence.",
  capture: "Technical SEO, indexability, local search, metadata, speed.",
  target: "Practice-area coverage, matter-intent pages, content gaps.",
  screen: "Intake path, CTA clarity, qualification, lead-fit routing.",
};

const PILLAR_ORDER: ActsPillar[] = ["authority", "capture", "target", "screen"];

function cleanDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.replace(/\/.*$/, "");
  return d;
}

/** Split a textarea (newlines and/or commas) into a cleaned, deduped list. */
function parseList(raw: string, normalize: (s: string) => string): string[] {
  const parts = raw
    .split(/[\n,]+/)
    .map((s) => normalize(s))
    .filter(Boolean);
  return [...new Set(parts)];
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "firm";
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

export default function ProspectingDiagnosticTool() {
  // Form state
  const [firmName, setFirmName] = useState("");
  const [primaryDomain, setPrimaryDomain] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [alternateDomains, setAlternateDomains] = useState("");
  const [market, setMarket] = useState("");
  const [practiceFocus, setPracticeFocus] = useState("");
  const [targetKeyword, setTargetKeyword] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [notes, setNotes] = useState("");
  const [scanMode, setScanMode] = useState<ScanMode>("quick");

  // Run state
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [error, setError] = useState("");
  const [diag, setDiag] = useState<ProspectingDiagnostic | null>(null);
  const [scans, setScans] = useState<DomainScan[]>([]);
  const [copied, setCopied] = useState<string>("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedRunId, setSavedRunId] = useState("");
  const [savedRuns, setSavedRuns] = useState<SavedDiagnosticRun[]>([]);
  const [loadingSavedRuns, setLoadingSavedRuns] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Enrichment state (Phase 1: market + practice focus + alternate-domain hints).
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState("");
  const [enrichment, setEnrichment] = useState<ProspectEnrichment | null>(null);
  // The quick scan captured during enrichment, reused as the primary scan when
  // the operator then runs the diagnostic at quick depth (no double crawl).
  const enrichScanRef = useRef<{ domain: string; result: SeoCheckResult } | null>(null);

  useEffect(() => {
    loadSavedRuns();
  }, []);

  function cancelRun() {
    abortRef.current?.abort();
  }

  function flashCopied(key: string) {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? "" : c)), 1600);
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(key);
    } catch {
      setError("Could not copy to clipboard. Your browser may block it on this origin.");
    }
  }

  async function loadSavedRuns() {
    setLoadingSavedRuns(true);
    try {
      const res = await fetch("/api/admin/prospecting-diagnostic/runs?limit=8");
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray((data as { items?: unknown }).items)) {
        setSavedRuns((data as { items: SavedDiagnosticRun[] }).items);
      }
    } finally {
      setLoadingSavedRuns(false);
    }
  }

  async function loadSavedRun(id: string) {
    setError("");
    try {
      const res = await fetch(`/api/admin/prospecting-diagnostic/runs?id=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.run) {
        setError((data as { error?: string }).error || `Could not load diagnostic (HTTP ${res.status}).`);
        return;
      }
      const run = (data as { run: { diagnostic?: ProspectingDiagnostic; scans?: DomainScan[] } }).run;
      if (!run.diagnostic) {
        setError("Saved diagnostic is missing its diagnostic payload.");
        return;
      }
      setDiag(run.diagnostic);
      setScans(Array.isArray(run.scans) ? run.scans : []);
      setProgress([]);
      setSavedRunId(id);
      setNotice("Loaded saved diagnostic.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load saved diagnostic.");
    }
  }

  function previousRunFor(run: SavedDiagnosticRun): SavedDiagnosticRun | undefined {
    return savedRuns.find((candidate) => candidate.primary_domain === run.primary_domain && candidate.id !== run.id);
  }

  async function scanDomain(
    domain: string,
    mode: ScanMode,
    signal: AbortSignal,
    intentPayload?: ScanIntentPayload
  ): Promise<{ result: SeoCheckResult | null; error?: string }> {
    try {
      const body = {
        domain,
        scanMode: mode,
        ...(intentPayload?.targetKeyword ? { targetKeyword: intentPayload.targetKeyword } : {}),
        ...(intentPayload?.targetMatter ? { targetMatter: intentPayload.targetMatter } : {}),
        ...(intentPayload?.targetLocation ? { targetLocation: intentPayload.targetLocation } : {}),
        ...(intentPayload?.targetAudience ? { targetAudience: intentPayload.targetAudience } : {}),
      };
      const res = await fetch("/api/tools/seo-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { result: null, error: (data as { error?: string }).error || `HTTP ${res.status}` };
      return { result: data as SeoCheckResult };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return { result: null, error: "cancelled" };
      return { result: null, error: e instanceof Error ? e.message : "Network error" };
    }
  }

  function buildIntentPayload(): ScanIntentPayload | undefined {
    const matter = practiceFocus.trim();
    const location = market.trim();
    const explicitKeyword = targetKeyword.trim();
    const derivedKeyword = matter && location ? `${matter} lawyer ${location}` : matter;
    const payload: ScanIntentPayload = {
      targetKeyword: explicitKeyword || derivedKeyword || undefined,
      targetMatter: matter || undefined,
      targetLocation: location || undefined,
      targetAudience: "Legal clients searching for help with this matter",
    };
    return payload.targetKeyword || payload.targetMatter || payload.targetLocation ? payload : undefined;
  }

  async function handleEnrich() {
    const name = firmName.trim();
    const primary = cleanDomain(primaryDomain);
    if (!name) {
      setEnrichError("Enter the firm name first.");
      return;
    }
    if (!primary) {
      setEnrichError("Enter the primary domain first.");
      return;
    }

    setEnrichError("");
    setEnrichment(null);
    setEnriching(true);
    const controller = new AbortController();

    try {
      const { result, error: scanErr } = await scanDomain(primary, "quick", controller.signal, buildIntentPayload());
      if (!result) {
        setEnrichError(`Could not scan ${primary}: ${scanErr || "unknown error"}.`);
        return;
      }
      enrichScanRef.current = { domain: primary, result };

      const packet = buildResearchPacket(
        { firmName: name, primaryDomain: primary, linkedinUrl: linkedinUrl.trim() || undefined },
        result
      );

      const res = await fetch("/api/admin/prospecting-diagnostic/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packet }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setEnrichError((data as { error?: string }).error || `Enrichment failed (HTTP ${res.status}).`);
        return;
      }
      setEnrichment(data.enrichment as ProspectEnrichment);
    } catch (e) {
      setEnrichError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setEnriching(false);
    }
  }

  function applyEnrichment() {
    if (!enrichment) return;
    if (enrichment.market.value) setMarket(enrichment.market.value);
    const pa = enrichment.practiceAreaFocus;
    if (pa.summary) setPracticeFocus(pa.summary);
    else if (pa.practiceAreas.length) setPracticeFocus(pa.practiceAreas.join(", "));
    if (enrichment.alternateDomains.length) {
      const existing = parseList(alternateDomains, cleanDomain);
      const merged = [...new Set([...existing, ...enrichment.alternateDomains.map((a) => a.domain)])];
      setAlternateDomains(merged.join("\n"));
    }
  }

  async function runDiagnostic() {
    const name = firmName.trim();
    const primary = cleanDomain(primaryDomain);
    if (!name) {
      setError("Enter the prospect firm name.");
      return;
    }
    if (!primary) {
      setError("Enter the primary domain.");
      return;
    }

    const plan = buildScanPlan(primary, parseList(alternateDomains, cleanDomain), scanMode, MAX_ALTERNATES);
    const competitorList = parseList(competitors, cleanDomain).filter((d) => d && d !== primary).slice(0, MAX_COMPETITORS);
    const droppedCompetitors = Math.max(0, parseList(competitors, cleanDomain).filter((d) => d && d !== primary).length - competitorList.length);
    const intentPayload = buildIntentPayload();
    const queue = [
      ...plan.queue,
      ...competitorList.map((domain) => ({ domain, role: "competitor" as const, mode: "quick" as ScanMode })),
    ];

    const prospect = {
      firmName: name,
      primaryDomain: primary,
      alternateDomains: plan.capped,
      market: market.trim(),
      practiceFocus: practiceFocus.trim(),
      competitors: competitorList,
      notes: notes.trim(),
    };

    setError("");
    setNotice([
      plan.dropped > 0
        ? `Scanned the first ${MAX_ALTERNATES} alternate domains. ${plan.dropped} more were not scanned.`
        : "",
      droppedCompetitors > 0
        ? `Scanned the first ${MAX_COMPETITORS} competitor domains. ${droppedCompetitors} more were not scanned.`
        : "",
    ].filter(Boolean).join(" "));
    setDiag(null);
    setScans([]);
    setSavedRunId("");
    setRunning(true);
    setProgress(queue.map((q) => ({ domain: q.domain, role: q.role, status: "pending" as ProgressStatus })));

    const controller = new AbortController();
    abortRef.current = controller;

    // Reuse the quick scan captured during enrichment for the primary domain,
    // so enrich-then-run at quick depth does not crawl the same site twice.
    const cachedPrimary = enrichScanRef.current;
    const scan: typeof scanDomain = (domain, mode, signal) =>
      cachedPrimary && !intentPayload && domain === cachedPrimary.domain && mode === "quick"
        ? Promise.resolve({ result: cachedPrimary.result })
        : scanDomain(domain, mode, signal, intentPayload);

    const outcome = await runScans(queue, {
      scan,
      signal: controller.signal,
      onProgress: (i, status, error) =>
        setProgress((prev) => prev.map((p, idx) => (idx === i ? { ...p, status, error } : p))),
    });

    if (outcome.kind === "cancelled") {
      setNotice("Scan cancelled.");
      setRunning(false);
      return;
    }
    if (outcome.kind === "primary_failed") {
      setError(`Could not scan the primary domain (${outcome.domain}): ${outcome.error || "unknown error"}. Fix the domain and run again.`);
      setRunning(false);
      return;
    }

    setScans(outcome.scans);
    setDiag(buildProspectingDiagnostic(prospect, outcome.scans));
    setRunning(false);
  }

  function exportJson() {
    if (!diag) return;
    const date = (diag.scanSummary.checkedAt || "").slice(0, 10) || "scan";
    downloadText(
      `prospecting-diagnostic-${slugify(diag.prospect.firmName)}-${date}.json`,
      JSON.stringify(diag, null, 2),
      "application/json"
    );
  }

  async function saveDiagnostic() {
    if (!diag || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/prospecting-diagnostic/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diagnostic: diag,
          scans,
          targetKeyword: targetKeyword.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError((data as { error?: string }).error || `Could not save diagnostic (HTTP ${res.status}).`);
        return;
      }
      setSavedRunId((data as { run?: { id?: string } }).run?.id || "saved");
      setNotice("Diagnostic saved to internal history.");
      void loadSavedRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save diagnostic.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {savedRuns.length > 0 && (
        <section className="bg-white border border-black/8 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-navy">Recent saved diagnostics</h2>
            <button
              type="button"
              onClick={loadSavedRuns}
              disabled={loadingSavedRuns}
              className="text-[11px] font-display font-bold uppercase tracking-wider px-3 py-1.5 border border-black/15 text-navy hover:border-navy disabled:opacity-50 transition"
            >
              {loadingSavedRuns ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-black/45 border-b border-black/10">
                  <th className="py-2 pr-3 font-semibold">Firm</th>
                  <th className="py-2 pr-3 font-semibold">Domain</th>
                  <th className="py-2 pr-3 font-semibold">Intent</th>
                  <th className="py-2 pr-3 font-semibold">Scores</th>
                  <th className="py-2 pr-3 font-semibold">Saved</th>
                  <th className="py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {savedRuns.map((run) => {
                  const previous = previousRunFor(run);
                  return (
                    <tr key={run.id} className="border-b border-black/5">
                      <td className="py-2 pr-3 text-navy font-semibold">{run.prospect_firm_name}</td>
                      <td className="py-2 pr-3 font-mono text-black/70">{run.primary_domain}</td>
                      <td className="py-2 pr-3 text-black/60">{run.target_keyword || run.practice_focus || run.market || "n/a"}</td>
                      <td className="py-2 pr-3 text-black/60">
                        SEO {run.overall_score ?? "n/a"} · AI {run.ai_search_score ?? "n/a"} · Intent {run.intent_score ?? "n/a"}
                      </td>
                      <td className="py-2 pr-3 text-black/50">
                        {new Date(run.created_at).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => loadSavedRun(run.id)}
                          className="text-[11px] font-display font-bold uppercase tracking-wider px-3 py-1.5 border border-black/15 text-navy hover:border-navy transition mr-2"
                        >
                          Load
                        </button>
                        <a
                          href={`/admin/prospecting-diagnostic/runs/${run.id}`}
                          className="inline-block text-[11px] font-display font-bold uppercase tracking-wider px-3 py-1.5 border border-black/15 text-navy hover:border-navy transition"
                        >
                          Open
                        </a>
                        {previous && (
                          <a
                            href={`/admin/prospecting-diagnostic/compare?before=${previous.id}&after=${run.id}`}
                            className="inline-block text-[11px] font-display font-bold uppercase tracking-wider px-3 py-1.5 border border-black/15 text-navy hover:border-navy transition ml-2"
                          >
                            Compare
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── Input section ─────────────────────────────── */}
      <section className="bg-white border border-black/8 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-navy">Prospect inputs</h2>
          <button
            type="button"
            onClick={handleEnrich}
            disabled={enriching || running}
            title="Scan the site and let AI suggest market, practice focus, and alternate domains"
            className="text-[11px] font-display font-bold uppercase tracking-wider px-4 py-2 border border-gold text-navy hover:bg-gold/10 disabled:opacity-50 transition"
          >
            {enriching ? "Researching prospect…" : "Enrich prospect"}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Prospect firm name" required>
            <input
              className={inputClass}
              value={firmName}
              onChange={(e) => setFirmName(e.target.value)}
              placeholder="Sakuraba Law Professional Corporation"
            />
          </Field>
          <Field label="Primary domain" required>
            <input
              className={inputClass}
              value={primaryDomain}
              onChange={(e) => setPrimaryDomain(e.target.value)}
              placeholder="firmname.ca"
              onKeyDown={(e) => e.key === "Enter" && !running && runDiagnostic()}
            />
          </Field>
          <Field label="LinkedIn URL" hint="Stored as a reference. Not scraped.">
            <input
              className={inputClass}
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="linkedin.com/company/firmname"
            />
          </Field>
          <Field label="Market / location">
            <input
              className={inputClass}
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              placeholder="Toronto, Ontario"
            />
          </Field>
          <Field label="Practice area focus">
            <input
              className={inputClass}
              value={practiceFocus}
              onChange={(e) => setPracticeFocus(e.target.value)}
              placeholder="Immigration and litigation"
            />
          </Field>
          <Field label="Target search intent" hint="Optional. If blank, derived from practice focus + market.">
            <input
              className={inputClass}
              value={targetKeyword}
              onChange={(e) => setTargetKeyword(e.target.value)}
              placeholder="estate litigation lawyer Toronto"
            />
          </Field>
          <Field label="Alternate / legacy domains" hint={`One per line. Up to ${MAX_ALTERNATES} scanned in quick mode for comparison.`}>
            <textarea
              className={`${inputClass} h-20 resize-y`}
              value={alternateDomains}
              onChange={(e) => setAlternateDomains(e.target.value)}
              placeholder={"oldfirmname.com\nfirmname.lawyer"}
            />
          </Field>
          <Field label="Competitors" hint={`Optional. One per line. Up to ${MAX_COMPETITORS} scanned in quick mode for comparison.`}>
            <textarea
              className={`${inputClass} h-20 resize-y`}
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              placeholder={"competitorfirm.ca\nanotherfirm.com"}
            />
          </Field>
          <Field label="Internal notes" className="sm:col-span-2">
            <textarea
              className={`${inputClass} h-20 resize-y`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Referral source, prior contact, why this firm, anything the diagnostic should not infer."
            />
          </Field>
        </div>

        {enrichError && <p className="text-sm text-red-700 mt-4">{enrichError}</p>}

        {enrichment && (
          <div className="mt-5 pt-4 border-t border-black/8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-navy">AI suggestions</h3>
              <button
                type="button"
                onClick={applyEnrichment}
                className="text-[11px] font-display font-bold uppercase tracking-wider px-4 py-2 bg-navy text-white hover:bg-navy/90 transition"
              >
                Apply suggestions
              </button>
            </div>
            <div className="space-y-3">
              <SuggestionRow
                label="Market / location"
                value={enrichment.market.value || "No suggestion from the scan"}
                confidence={enrichment.market.confidence}
                evidence={enrichment.market.evidence}
              />
              <SuggestionRow
                label="Practice area focus"
                value={
                  enrichment.practiceAreaFocus.summary ||
                  enrichment.practiceAreaFocus.practiceAreas.join(", ") ||
                  "No suggestion from the scan"
                }
                confidence={enrichment.practiceAreaFocus.confidence}
                evidence={enrichment.practiceAreaFocus.evidence}
                chips={enrichment.practiceAreaFocus.practiceAreas}
              />
              {enrichment.alternateDomains.length > 0 && (
                <SuggestionRow
                  label="Alternate domains"
                  value={enrichment.alternateDomains.map((a) => a.domain).join(", ")}
                  confidence={enrichment.alternateDomains[0].confidence}
                  evidence={enrichment.alternateDomains.map((a) => a.reason).filter(Boolean)}
                />
              )}
              <div className="text-xs text-black/45 border border-dashed border-black/15 px-3 py-2">
                Competitors: source not configured. Planned for Phase 2 (owned Toronto firm database).
              </div>
            </div>
            <p className="text-[11px] text-black/45 mt-2">
              Suggestions are AI-generated from the site scan. Review and edit before running the diagnostic.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 mt-5 pt-4 border-t border-black/8">
          <label className="flex items-center gap-2 text-xs">
            <span className="font-semibold uppercase tracking-wider text-black/55">Scan depth</span>
            <select
              className="text-sm border border-black/15 px-2 py-1.5 bg-white text-navy focus:outline-none focus:border-navy"
              value={scanMode}
              onChange={(e) => setScanMode(e.target.value as ScanMode)}
            >
              <option value="quick">Quick ({SCAN_MODE_PAGES.quick} pages)</option>
              <option value="standard">Standard ({SCAN_MODE_PAGES.standard} pages)</option>
              <option value="deep">Deep ({SCAN_MODE_PAGES.deep} pages)</option>
            </select>
          </label>
          <span className="text-xs text-black/45">Applies to the primary domain. Deeper scans take longer.</span>
          <button
            type="button"
            onClick={runDiagnostic}
            disabled={running}
            className="ml-auto bg-navy text-white font-display text-xs font-bold uppercase tracking-wider px-6 py-3 hover:bg-navy/90 disabled:opacity-50 transition"
          >
            {running ? "Running diagnostic…" : "Run diagnostic"}
          </button>
        </div>

        {error && <p className="text-sm text-red-700 mt-3">{error}</p>}
        {notice && <p className="text-sm text-amber-800 mt-2">{notice}</p>}
      </section>

      {/* ── Scan progress ─────────────────────────────── */}
      {progress.length > 0 && (running || !diag) && (
        <section className="bg-white border border-black/8 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-navy">Scanning</h2>
            {running && (
              <button
                type="button"
                onClick={cancelRun}
                className="text-[11px] font-display font-bold uppercase tracking-wider px-3 py-1.5 border border-black/15 text-navy hover:border-navy transition"
              >
                Cancel
              </button>
            )}
          </div>
          <ul className="space-y-2">
            {progress.map((p) => (
              <li key={`${p.role}-${p.domain}`} className="flex items-center gap-3 text-sm">
                <ProgressDot status={p.status} />
                <span className="font-mono text-navy">{p.domain}</span>
                <span className="text-[11px] uppercase tracking-wider text-black/40">{p.role}</span>
                <span className="text-xs text-black/50 ml-auto">
                  {p.status === "pending" && "Queued"}
                  {p.status === "scanning" && "Scanning…"}
                  {p.status === "done" && "Done"}
                  {p.status === "error" && (p.error || "Failed")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Results ───────────────────────────────────── */}
      {diag && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main column: findings */}
          <div className="lg:col-span-2 space-y-6">
            {PILLAR_ORDER.map((pillar) => (
              <PillarSection key={pillar} pillar={pillar} findings={diag.actsFindings[pillar]} />
            ))}

            {diag.domainComparison && (
              <section className="bg-white border border-black/8 p-5 sm:p-6">
                <h2 className="text-base font-bold text-navy">Domain comparison</h2>
                {diag.domainComparison.fragmentationFlagged && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 mt-2">
                    Authority fragmentation: more than one live domain is carrying the firm.
                  </p>
                )}
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-black/45 border-b border-black/10">
                        <th className="py-2 pr-3 font-semibold">Domain</th>
                        <th className="py-2 pr-3 font-semibold">Role</th>
                        <th className="py-2 pr-3 font-semibold">Pages</th>
                        <th className="py-2 pr-3 font-semibold">Maturity</th>
                        <th className="py-2 font-semibold">Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diag.domainComparison.rows.map((r) => (
                        <tr key={r.domain} className="border-b border-black/5">
                          <td className="py-2 pr-3 font-mono text-navy">
                            {r.domain}
                            {diag.domainComparison!.strongestDomain === r.domain && (
                              <span className="ml-2 text-[10px] uppercase tracking-wider text-gold">cleanest</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-black/55">{r.role}</td>
                          <td className="py-2 pr-3 text-black/70">{r.reachable ? r.pagesScanned : "n/a"}</td>
                          <td className="py-2 pr-3 text-black/70">{r.maturity ?? "n/a"}</td>
                          <td className="py-2 text-black/60">{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-sm text-black/70 mt-3">
                  <span className="font-semibold text-navy">Recommendation: </span>
                  {diag.domainComparison.canonicalRecommendation}
                </p>
              </section>
            )}

            {diag.competitorComparison && (
              <section className="bg-white border border-black/8 p-5 sm:p-6">
                <h2 className="text-base font-bold text-navy">Competitor comparison</h2>
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-black/45 border-b border-black/10">
                        <th className="py-2 pr-3 font-semibold">Competitor</th>
                        <th className="py-2 pr-3 font-semibold">Pages</th>
                        <th className="py-2 pr-3 font-semibold">SEO</th>
                        <th className="py-2 pr-3 font-semibold">AI</th>
                        <th className="py-2 pr-3 font-semibold">Intent</th>
                        <th className="py-2 font-semibold">Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diag.competitorComparison.rows.map((r) => (
                        <tr key={r.domain} className="border-b border-black/5">
                          <td className="py-2 pr-3 font-mono text-navy">
                            {r.domain}
                            {diag.competitorComparison!.strongestCompetitor === r.domain && (
                              <span className="ml-2 text-[10px] uppercase tracking-wider text-gold">strongest</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-black/70">{r.reachable ? r.pagesScanned : "n/a"}</td>
                          <td className="py-2 pr-3 text-black/70">{r.overallScore ?? "n/a"}</td>
                          <td className="py-2 pr-3 text-black/70">{r.aiSearchScore ?? "n/a"}</td>
                          <td className="py-2 pr-3 text-black/70">{r.intentScore ?? "n/a"}</td>
                          <td className="py-2 text-black/60">{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {diag.competitorComparison.gaps.length > 0 && (
                  <div className="mt-3 text-sm text-black/75">
                    <span className="font-semibold text-navy">Gaps: </span>
                    {diag.competitorComparison.gaps.join(" ")}
                  </div>
                )}
                {diag.competitorComparison.advantages.length > 0 && (
                  <div className="mt-2 text-sm text-black/75">
                    <span className="font-semibold text-navy">Advantages: </span>
                    {diag.competitorComparison.advantages.join(" ")}
                  </div>
                )}
              </section>
            )}

            {/* 30/60/90 plan */}
            <section className="bg-white border border-black/8 p-5 sm:p-6">
              <h2 className="text-base font-bold text-navy mb-3">30 / 60 / 90 day plan</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <PlanColumn title="First 30 days" items={diag.thirtySixtyNinetyPlan.day30} />
                <PlanColumn title="Days 30 to 60" items={diag.thirtySixtyNinetyPlan.day60} />
                <PlanColumn title="Days 60 to 90" items={diag.thirtySixtyNinetyPlan.day90} />
              </div>
            </section>

            {/* Strategic call questions */}
            <section className="bg-white border border-black/8 p-5 sm:p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-navy">Strategic call questions</h2>
                <CopyButton
                  label="Copy agenda"
                  active={copied === "agenda"}
                  onClick={() => copy("agenda", formatCallAgenda(diag))}
                />
              </div>
              <ol className="space-y-2 list-decimal pl-5">
                {diag.strategicCallQuestions.map((q, i) => (
                  <li key={i} className="text-sm text-black/75">{q}</li>
                ))}
              </ol>
            </section>
          </div>

          {/* Right rail: outreach + export */}
          <aside className="lg:col-span-1 space-y-6 lg:sticky lg:top-6 self-start">
            <section className="bg-navy text-white p-5">
              <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold mb-2">Recommended opening angle</h2>
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

            <section className="bg-white border border-black/8 p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-navy">Cold email draft</h2>
                <CopyButton
                  label="Copy email"
                  active={copied === "email"}
                  onClick={() => copy("email", diag.coldEmailDraft)}
                />
              </div>
              <pre className="text-xs text-black/75 whitespace-pre-wrap font-sans leading-relaxed bg-parchment border border-black/8 p-3 max-h-72 overflow-y-auto">
                {diag.coldEmailDraft}
              </pre>
            </section>

            <section className="bg-white border border-black/8 p-5">
              <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-navy mb-3">Export</h2>
              <div className="flex flex-col gap-2">
                <CopyButton
                  label="Copy report-ready summary"
                  block
                  active={copied === "report"}
                  onClick={() => copy("report", formatReportText(diag))}
                />
                <button
                  type="button"
                  onClick={exportJson}
                  className="w-full text-center bg-gold text-deep-black font-display text-[11px] font-bold uppercase tracking-wider px-4 py-2.5 hover:opacity-90 transition"
                >
                  Download JSON export
                </button>
                <button
                  type="button"
                  onClick={saveDiagnostic}
                  disabled={saving || !!savedRunId}
                  className="w-full text-center bg-navy text-white font-display text-[11px] font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-navy/90 disabled:opacity-55 transition"
                >
                  {saving ? "Saving..." : savedRunId ? "Saved to history" : "Save diagnostic"}
                </button>
              </div>
              <p className="text-[11px] text-black/45 mt-2 leading-relaxed">
                The JSON carries the full diagnostic object for the PDF diagnostic builder. Saved diagnostics are stored internally for later follow-up.
              </p>
            </section>

            <InternalScoresPanel scans={scans} />
          </aside>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────
   Subcomponents
   ──────────────────────────────────────────────────────── */

const inputClass =
  "w-full text-sm border border-black/15 px-3 py-2 bg-white text-navy placeholder:text-black/30 focus:outline-none focus:border-navy";

function Field({
  label,
  children,
  hint,
  required,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-semibold uppercase tracking-wider text-black/55 mb-1.5">
        {label}
        {required && <span className="text-red-600 ml-1">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-black/40 mt-1">{hint}</span>}
    </label>
  );
}

function ProgressDot({ status }: { status: ProgressStatus }) {
  const color =
    status === "done"
      ? "bg-emerald-500"
      : status === "error"
      ? "bg-red-500"
      : status === "scanning"
      ? "bg-amber-400 animate-pulse"
      : "bg-black/20";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${color}`} aria-hidden />;
}

function PillarSection({ pillar, findings }: { pillar: ActsPillar; findings: DiagnosticFinding[] }) {
  return (
    <section className="bg-white border border-black/8 p-5 sm:p-6">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="font-display text-2xl font-extrabold text-gold leading-none">{PILLAR_LABEL[pillar].charAt(0)}</span>
        <h2 className="text-base font-bold text-navy">{PILLAR_LABEL[pillar]}</h2>
      </div>
      <p className="text-[11px] uppercase tracking-wider text-black/40 mb-4">{PILLAR_BLURB[pillar]}</p>
      <div className="space-y-4">
        {findings.map((f, i) => (
          <FindingCard key={i} finding={f} />
        ))}
      </div>
    </section>
  );
}

function FindingCard({ finding }: { finding: DiagnosticFinding }) {
  return (
    <div className="border-l-2 border-black/10 pl-4">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h3 className="text-sm font-semibold text-navy">{finding.title}</h3>
        <ConfidenceChip confidence={finding.confidence} />
        <span className="text-[10px] uppercase tracking-wider text-black/35">{finding.sourceCategory}</span>
      </div>
      <p className="text-sm text-black/75 leading-relaxed">{finding.businessConsequence}</p>
      <p className="text-xs text-black/45 mt-1.5">
        <span className="font-semibold uppercase tracking-wider">Evidence: </span>
        {finding.evidence}
      </p>
      <p className="text-xs text-black/60 mt-1">
        <span className="font-semibold uppercase tracking-wider text-black/45">Fix: </span>
        {finding.recommendedFix}
      </p>
      {finding.affectedUrls && finding.affectedUrls.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {finding.affectedUrls.map((u) => (
            <li key={u} className="text-[11px] font-mono text-black/40 truncate max-w-full">{safePath(u)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function safePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || "");
  } catch {
    return url;
  }
}

function ConfidenceChip({ confidence }: { confidence: "low" | "medium" | "high" }) {
  const cls =
    confidence === "high"
      ? "bg-navy/10 text-navy"
      : confidence === "medium"
      ? "bg-gold/20 text-[#7a6a45]"
      : "bg-black/5 text-black/45";
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 ${cls}`}>
      {confidence}
    </span>
  );
}

function SuggestionRow({
  label,
  value,
  confidence,
  evidence,
  chips,
}: {
  label: string;
  value: string;
  confidence: "low" | "medium" | "high";
  evidence?: string[];
  chips?: string[];
}) {
  return (
    <div className="text-sm">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-black/45">{label}</span>
        <ConfidenceChip confidence={confidence} />
      </div>
      <div className="text-black/80">{value}</div>
      {chips && chips.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {chips.map((c) => (
            <span key={c} className="text-[10px] bg-black/5 text-black/60 px-1.5 py-0.5">{c}</span>
          ))}
        </div>
      )}
      {evidence && evidence.length > 0 && (
        <div className="text-[11px] text-black/40 mt-1">Evidence: {evidence.join("; ")}</div>
      )}
    </div>
  );
}

function PlanColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gold mb-2">{title}</h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-black/75 flex gap-2">
            <span className="text-navy shrink-0">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyButton({
  label,
  onClick,
  active,
  block,
}: {
  label: string;
  onClick: () => void;
  active: boolean;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${block ? "w-full text-center " : ""}text-[11px] font-display font-bold uppercase tracking-wider px-4 py-2 border transition ${
        active ? "bg-navy text-white border-navy" : "border-black/15 text-navy hover:border-navy"
      }`}
    >
      {active ? "Copied" : label}
    </button>
  );
}

function InternalScoresPanel({ scans }: { scans: DomainScan[] }) {
  const withResults = scans.filter((s) => s.result);
  if (withResults.length === 0) return null;
  return (
    <details className="bg-white border border-black/8 p-5">
      <summary className="text-xs font-semibold uppercase tracking-[0.15em] text-black/50 cursor-pointer select-none">
        Internal scores (operator only)
      </summary>
      <div className="mt-3 space-y-3">
        {withResults.map((s) => {
          const r = s.result!;
          return (
            <div key={s.domain} className="text-xs border-t border-black/8 pt-3 first:border-t-0 first:pt-0">
              <div className="font-mono text-navy mb-1">{s.domain}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-black/60">
                <span>Overall</span>
                <span className="text-right font-semibold text-navy">{r.overallScore}/100 ({r.grade})</span>
                <span>AI search</span>
                <span className="text-right font-semibold text-navy">{r.aiSearchScore}/100</span>
                <span>AI policy</span>
                <span className="text-right font-semibold text-navy">{r.aiPolicyScore}/100</span>
                {r.intentAlignment && (
                  <>
                    <span>Intent alignment</span>
                    <span className="text-right font-semibold text-navy">
                      {r.intentAlignment.score}/100 ({r.intentAlignment.grade})
                    </span>
                    <span>Best intent page</span>
                    <span className="text-right truncate">
                      {(() => {
                        if (!r.intentAlignment?.bestMatchingPage) return "n/a";
                        try { return new URL(r.intentAlignment.bestMatchingPage).pathname || "/"; } catch { return r.intentAlignment.bestMatchingPage; }
                      })()}
                    </span>
                  </>
                )}
                <span>Pages scanned</span>
                <span className="text-right">{r.pagesScanned}{r.partial ? " (partial)" : ""}</span>
                {r.internalSummary && (
                  <>
                    <span>Prospect fit</span>
                    <span className="text-right">{r.internalSummary.prospectFitScore}/100</span>
                    <span>Maturity</span>
                    <span className="text-right">{r.internalSummary.websiteMaturity}</span>
                    <span>Urgency</span>
                    <span className="text-right">{r.internalSummary.urgencyLevel}</span>
                  </>
                )}
              </div>
              <div className="flex gap-2 mt-2 text-[10px] uppercase tracking-wider text-black/45">
                <span>C {r.severityBreakdown.critical}</span>
                <span>H {r.severityBreakdown.high}</span>
                <span>M {r.severityBreakdown.medium}</span>
                <span>L {r.severityBreakdown.low}</span>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
