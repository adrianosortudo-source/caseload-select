'use client';

/**
 * Operator console for Firm Assist (DR-100, DR-101). Three sections:
 * reindex trigger (with optional sitemap seed), the curated page list
 * with include toggles, and a read-only query log (latest 100).
 *
 * Explicit actions only, no autosave, mirrors RoutingConfigPanel's
 * dirty/saving/success/error pattern.
 */

import { useState } from 'react';

export interface AssistPage {
  id: string;
  url: string;
  title: string | null;
  include: boolean;
  exclude_reason: string | null;
  last_crawled_at: string | null;
  last_crawl_status: string | null;
}

export interface AssistQueryLogRow {
  id: string;
  question: string;
  intent: string | null;
  exit_type: string | null;
  latency_ms: number | null;
  created_at: string;
}

interface ReindexSummary {
  seed: { total_found: number; inserted: number; skipped_existing: number; errors: string[] } | null;
  reindex: { pages_processed: number; pages_ok: number; pages_unchanged: number; pages_errored: number; pages_disabled: number };
}

interface Status {
  kind: 'idle' | 'success' | 'error';
  message?: string;
}

function orNone(value: string | null | undefined): string {
  return value && value.trim() ? value : 'None';
}

export default function AssistConsolePanel({
  firmId,
  customDomain,
  initialPages,
  recentQueries,
}: {
  firmId: string;
  customDomain: string | null;
  initialPages: AssistPage[];
  recentQueries: AssistQueryLogRow[];
}) {
  const [pages, setPages] = useState<AssistPage[]>(initialPages);
  const [siteUrl, setSiteUrl] = useState<string>(customDomain ? `https://${customDomain}` : '');
  const [seedOnReindex, setSeedOnReindex] = useState(pages.length === 0);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [summary, setSummary] = useState<ReindexSummary | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function runReindex() {
    setRunning(true);
    setStatus({ kind: 'idle' });
    try {
      const body: { seed?: boolean; siteUrl?: string } = {};
      if (seedOnReindex) {
        body.seed = true;
        if (siteUrl.trim()) body.siteUrl = siteUrl.trim();
      }
      const res = await fetch(`/api/admin/assist/${firmId}/reindex`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setStatus({ kind: 'error', message: json.error ?? `HTTP ${res.status}` });
        return;
      }
      setSummary({ seed: json.seed ?? null, reindex: json.reindex });
      setStatus({ kind: 'success', message: 'Reindex complete.' });

      const listRes = await fetch(`/api/admin/assist/${firmId}/pages`);
      const listJson = await listRes.json().catch(() => ({}));
      if (listRes.ok && listJson.ok) {
        setPages(listJson.pages ?? []);
        setSeedOnReindex(false);
      }
    } catch (e) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Network error.' });
    } finally {
      setRunning(false);
    }
  }

  async function toggleInclude(pageId: string, nextInclude: boolean) {
    setTogglingId(pageId);
    setStatus({ kind: 'idle' });
    const prev = pages;
    setPages((cur) => cur.map((p) => (p.id === pageId ? { ...p, include: nextInclude } : p)));
    try {
      const res = await fetch(`/api/admin/assist/${firmId}/pages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, include: nextInclude }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setPages(prev);
        setStatus({ kind: 'error', message: json.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setPages(prev);
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Network error.' });
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="bg-white border border-black/10 px-6 py-6 space-y-4">
        <h2 className="text-lg font-bold text-navy">Corpus</h2>
        <p className="text-sm text-black/60">
          {pages.length === 0
            ? "No pages curated yet. Seed from the firm's sitemap to get started."
            : `${pages.length} page${pages.length === 1 ? '' : 's'} curated, ${pages.filter((p) => p.include).length} included.`}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-black/80">
            <input
              type="checkbox"
              checked={seedOnReindex}
              onChange={(e) => setSeedOnReindex(e.target.checked)}
            />
            Seed from sitemap first
          </label>
          {seedOnReindex && (
            <input
              type="text"
              className="border border-black/20 px-3 py-1.5 text-sm flex-1 min-w-[240px]"
              placeholder="https://drglaw.ca (optional, defaults to custom_domain)"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
            />
          )}
        </div>

        <button
          type="button"
          onClick={runReindex}
          disabled={running}
          className="bg-navy text-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {running ? 'Working...' : 'Reindex now'}
        </button>

        {status.kind === 'success' && (
          <p className="text-sm text-green-700">{status.message}</p>
        )}
        {status.kind === 'error' && (
          <p className="text-sm text-red-700">{status.message}</p>
        )}
        {summary && (
          <div className="text-xs text-black/60 space-y-1">
            {summary.seed && (
              <p>
                Seed: {summary.seed.total_found} URLs found, {summary.seed.inserted} new,{' '}
                {summary.seed.skipped_existing} already known.
                {summary.seed.errors.length > 0 ? ` Errors: ${summary.seed.errors.join('; ')}` : ''}
              </p>
            )}
            <p>
              Reindex: {summary.reindex.pages_processed} processed, {summary.reindex.pages_ok} updated,{' '}
              {summary.reindex.pages_unchanged} unchanged, {summary.reindex.pages_errored} errored
              {summary.reindex.pages_disabled > 0 ? `, ${summary.reindex.pages_disabled} disabled (no Gemini key)` : ''}.
            </p>
          </div>
        )}
      </section>

      <section className="bg-white border border-black/10 px-6 py-6">
        <h2 className="text-lg font-bold text-navy mb-4">Curated pages</h2>
        {pages.length === 0 ? (
          <p className="text-sm text-black/60">Nothing curated yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-black/50 border-b border-black/10">
                <th className="py-2 pr-3">Include</th>
                <th className="py-2 pr-3">URL</th>
                <th className="py-2 pr-3">Title</th>
                <th className="py-2 pr-3">Last crawl</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.id} className="border-b border-black/5">
                  <td className="py-2 pr-3">
                    <input
                      type="checkbox"
                      checked={page.include}
                      disabled={togglingId === page.id}
                      onChange={(e) => toggleInclude(page.id, e.target.checked)}
                    />
                  </td>
                  <td className="py-2 pr-3 max-w-[320px] truncate">
                    <a href={page.url} target="_blank" rel="noreferrer" className="text-navy underline">
                      {page.url}
                    </a>
                    {page.exclude_reason && !page.include && (
                      <span className="block text-xs text-black/40">{page.exclude_reason}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-black/70">{orNone(page.title)}</td>
                  <td className="py-2 pr-3 text-black/50 text-xs">
                    {page.last_crawled_at ? new Date(page.last_crawled_at).toLocaleString() : 'never'}
                    {page.last_crawl_status ? ` (${page.last_crawl_status})` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-white border border-black/10 px-6 py-6">
        <h2 className="text-lg font-bold text-navy mb-4">Recent questions</h2>
        {recentQueries.length === 0 ? (
          <p className="text-sm text-black/60">No questions logged yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-black/50 border-b border-black/10">
                <th className="py-2 pr-3">Question</th>
                <th className="py-2 pr-3">Intent</th>
                <th className="py-2 pr-3">Exit</th>
                <th className="py-2 pr-3">Latency</th>
                <th className="py-2 pr-3">When</th>
              </tr>
            </thead>
            <tbody>
              {recentQueries.map((row) => (
                <tr key={row.id} className="border-b border-black/5">
                  <td className="py-2 pr-3 max-w-[360px] truncate">{row.question}</td>
                  <td className="py-2 pr-3 text-black/70">{orNone(row.intent)}</td>
                  <td className="py-2 pr-3 text-black/70">{orNone(row.exit_type)}</td>
                  <td className="py-2 pr-3 text-black/50 text-xs">
                    {row.latency_ms != null ? `${row.latency_ms}ms` : 'n/a'}
                  </td>
                  <td className="py-2 pr-3 text-black/50 text-xs">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
