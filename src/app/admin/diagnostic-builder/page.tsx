"use client";

/**
 * Operator-console launcher for the CaseLoad Select Diagnostic builder.
 *
 * The builder is a LOCAL tool (Python + Playwright + Gemini) that lives at
 * 00_System/02_Skills/caseload-select-diagnostic/builder/ on the operator's
 * machine. This page is the discovery surface inside the operator console:
 * it probes localhost:8765 and either opens the builder in a new tab or
 * shows the start command. The engine itself stays local by design.
 */

import { useEffect, useState } from "react";

const LOCAL_URL = "http://localhost:8765";

type Status = "detecting" | "running" | "not-running";

export default function DiagnosticBuilderPage() {
  const [status, setStatus] = useState<Status>("detecting");

  async function probe() {
    setStatus("detecting");
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);
    try {
      // Real CORS fetch: the local server returns Access-Control-Allow-Origin
      // for this host plus Access-Control-Allow-Private-Network so Chrome's
      // PNA preflight passes. r.ok confirms it actually responded.
      const r = await fetch(`${LOCAL_URL}/schema.json`, {
        signal: controller.signal,
        cache: "no-store",
      });
      setStatus(r.ok ? "running" : "not-running");
    } catch {
      setStatus("not-running");
    } finally {
      clearTimeout(t);
    }
  }

  useEffect(() => {
    void probe();
  }, []);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-navy">Diagnostic builder</h1>
        <p className="text-sm text-black/60">
          Local tool that turns a firm URL into a branded 8-page diagnostic PDF.
          Autonomous research, AI draft, locked template, brand-and-LSO QA gate.
        </p>
      </header>

      <section className="bg-white border border-black/8 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          <div className="text-sm">
            <div className="font-semibold text-navy">
              {status === "detecting" && "Probing local builder..."}
              {status === "running" && "Local builder is running."}
              {status === "not-running" && "Local builder is not running."}
            </div>
            <div className="text-xs text-black/55 font-mono">{LOCAL_URL}</div>
          </div>
          <button
            type="button"
            onClick={() => void probe()}
            className="ml-auto text-xs uppercase tracking-wider text-black/55 hover:text-navy border border-black/15 hover:border-navy px-3 py-1.5 transition"
          >
            Re-probe
          </button>
        </div>

        {status === "running" && (
          <a
            href={LOCAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-gold text-[#0D1520] font-mono text-xs uppercase tracking-wider px-6 py-3 hover:opacity-90 transition"
          >
            Open builder in a new tab
          </a>
        )}

        {status === "not-running" && (
          <div className="space-y-3">
            <p className="text-sm text-black/70">
              The builder normally auto-starts at Windows login (a shortcut to{" "}
              <code className="font-mono bg-black/5 px-1.5 py-0.5">start-builder.vbs</code>{" "}
              lives in your Startup folder). If the dot is red, it crashed or
              has not started yet. Two ways to restart:
            </p>
            <ul className="text-sm text-black/70 list-disc pl-5 space-y-1.5">
              <li>
                Double-click{" "}
                <code className="font-mono bg-black/5 px-1.5 py-0.5">start-builder.vbs</code>{" "}
                in the builder folder. Silent restart. Re-probe after ~3 seconds.
              </li>
              <li>
                For visible logs, double-click{" "}
                <code className="font-mono bg-black/5 px-1.5 py-0.5">start-builder.bat</code>{" "}
                instead. A terminal opens and stays open; close it to stop the server.
              </li>
            </ul>
            <p className="text-xs text-black/50">
              Folder:{" "}
              <code className="font-mono bg-black/5 px-1.5 py-0.5">
                D:\00_Work\01_CaseLoad_Select\00_System\02_Skills\caseload-select-diagnostic\builder
              </code>
            </p>
            <p className="text-xs text-black/50">
              Recovery: if a stuck process is holding port 8765, double-click{" "}
              <code className="font-mono bg-black/5 px-1.5 py-0.5">stop-builder.bat</code>,
              then start it again.
            </p>
          </div>
        )}

        <div className="pt-2 border-t border-black/8 space-y-2">
          <div>
            <a
              href={LOCAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs uppercase tracking-wider text-black/55 hover:text-navy underline underline-offset-4"
            >
              Open {LOCAL_URL} directly
            </a>
            <span className="text-xs text-black/40 ml-2">
              (fallback if the probe stays red but you just started the server)
            </span>
          </div>
          <p className="text-[11px] text-black/40 leading-relaxed">
            The probe is a best-effort indicator. It tells your browser whether a
            local service answers on port 8765 from the operator console origin.
            It can show red on a working server when a browser blocks the
            cross-port preflight, and green on any other service that happens to
            listen on that port. Trust the new-tab open more than the dot.
          </p>
        </div>
      </section>

      <section className="bg-white border border-black/8 p-6 space-y-4">
        <h2 className="text-sm font-mono uppercase tracking-[0.18em] text-navy">
          What the tool does
        </h2>
        <ol className="text-sm text-black/75 space-y-3 list-decimal pl-5">
          <li>
            <strong>Research:</strong> paste a firm URL. Roughly 17 seconds.
            Captures site, JSON-LD schema, Canadian Law List, Yellow Pages
            Canada, Google Ads Transparency Center, and screenshots. Writes a
            research-notes.md and a manual-capture checklist for the items
            Google blocks (GBP rating and review count, map-pack position).
          </li>
          <li>
            <strong>Notes:</strong> review the auto-captured notes and paste
            in the manual items.
          </li>
          <li>
            <strong>Draft with AI:</strong> Gemini turns the notes into a
            field-by-field draft. It refuses to invent anything the notes do
            not support, so missing data surfaces as required-field gaps.
          </li>
          <li>
            <strong>Render PDF:</strong> the QA gate runs (em dash, italics,
            score, banned vocab, LSO-sensitive terms, character overage). Any
            violation blocks the PDF and surfaces the exact rule.
          </li>
        </ol>
        <p className="text-xs text-black/50">
          Output lands in{" "}
          <code className="font-mono bg-black/5 px-1.5 py-0.5">
            07_Prospects/&lt;FirmSlug&gt;_&lt;YYYY-MM-DD&gt;/
          </code>
          . Full docs:{" "}
          <code className="font-mono bg-black/5 px-1.5 py-0.5">
            00_System/02_Skills/caseload-select-diagnostic/builder/README.md
          </code>
        </p>
      </section>

      <section className="bg-white border border-black/8 p-6 space-y-2">
        <h2 className="text-sm font-mono uppercase tracking-[0.18em] text-navy">
          Why local
        </h2>
        <p className="text-sm text-black/70">
          The engine runs on the operator&apos;s machine because (a) headless
          Chrome and Playwright are heavy on Vercel serverless, (b) PageSpeed
          Insights and Google directory probes work better from a residential
          IP than a datacentre, and (c) the deliverable is operator-supervised
          by design. The Console is the entry point; the work happens on disk.
        </p>
      </section>
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  const color =
    status === "running"
      ? "bg-emerald-500"
      : status === "not-running"
      ? "bg-red-500"
      : "bg-amber-400 animate-pulse";
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} aria-hidden />
  );
}
