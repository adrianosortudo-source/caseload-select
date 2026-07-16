/**
 * I/O layer for Firm Assist corpus ingestion (DR-100, DR-101).
 *
 * seedPagesFromSitemap() discovers a firm's pages from their sitemap.xml
 * and inserts new rows into assist_corpus_pages, applying the DR-101
 * default seed-exclude rules. It never touches an already-seeded row's
 * `include` flag (operator curation is sticky).
 *
 * reindexFirm() walks the firm's included pages, fetches + extracts +
 * chunks + embeds each one, and replaces its chunk set in
 * assist_corpus_chunks. Unchanged pages (by content hash) are skipped.
 */

import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { embedDocuments } from './gemini-embed';
import {
  isSitemapIndex,
  extractLocs,
  shouldExcludeBySeedRule,
  extractTitle,
  extractSections,
  chunkSections,
  hashContent,
} from './corpus-ingest-pure';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_SITEMAP_CHILDREN = 20;
const MAX_PAGES_PER_FIRM = 500;
const EMBED_BATCH_SIZE = 20;

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'CaseLoadSelect-FirmAssist/1.0' } });
    if (!res.ok) throw new Error(`fetch ${url} returned ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/** Recursively resolves a sitemap (or sitemap index) into a flat list of page URLs. */
async function resolveSitemapUrls(sitemapUrl: string): Promise<string[]> {
  const xml = await fetchText(sitemapUrl);
  if (!isSitemapIndex(xml)) {
    return extractLocs(xml);
  }

  const childSitemaps = extractLocs(xml).slice(0, MAX_SITEMAP_CHILDREN);
  const pageUrls: string[] = [];
  for (const child of childSitemaps) {
    try {
      const childXml = await fetchText(child);
      pageUrls.push(...extractLocs(childXml));
    } catch (err) {
      console.warn(`[corpus-ingest] failed to fetch child sitemap ${child}:`, err instanceof Error ? err.message : String(err));
    }
  }
  return pageUrls;
}

export interface SeedResult {
  total_found: number;
  inserted: number;
  skipped_existing: number;
  errors: string[];
}

export async function seedPagesFromSitemap(firmId: string, siteUrl: string): Promise<SeedResult> {
  const root = siteUrl.replace(/\/$/, '');
  const sitemapUrl = `${root}/sitemap.xml`;

  let urls: string[];
  try {
    urls = await resolveSitemapUrls(sitemapUrl);
  } catch (err) {
    return {
      total_found: 0,
      inserted: 0,
      skipped_existing: 0,
      errors: [`sitemap fetch failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const uniqueUrls = Array.from(new Set(urls)).slice(0, MAX_PAGES_PER_FIRM);
  const { data: existingRows } = await supabase
    .from('assist_corpus_pages')
    .select('url')
    .eq('firm_id', firmId);
  const existingUrls = new Set((existingRows ?? []).map((r) => r.url as string));

  const toInsert = uniqueUrls
    .filter((url) => !existingUrls.has(url))
    .map((url) => {
      const seed = shouldExcludeBySeedRule(url);
      return {
        firm_id: firmId,
        url,
        include: !seed.exclude,
        exclude_reason: seed.exclude ? seed.reason : null,
      };
    });

  const errors: string[] = [];
  let inserted = 0;
  if (toInsert.length > 0) {
    const { error } = await supabase.from('assist_corpus_pages').insert(toInsert);
    if (error) {
      errors.push(error.message);
    } else {
      inserted = toInsert.length;
    }
  }

  return {
    total_found: uniqueUrls.length,
    inserted,
    skipped_existing: uniqueUrls.length - toInsert.length,
    errors,
  };
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

export interface ReindexPageResult {
  page_id: string;
  url: string;
  status: 'ok' | 'unchanged' | 'error' | 'disabled';
  chunk_count?: number;
  error?: string;
}

export interface ReindexSummary {
  pages_processed: number;
  pages_ok: number;
  pages_unchanged: number;
  pages_errored: number;
  pages_disabled: number;
  results: ReindexPageResult[];
}

async function reindexOnePage(page: { id: string; url: string }, firmId: string): Promise<ReindexPageResult> {
  let html: string;
  try {
    html = await fetchText(page.url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from('assist_corpus_pages')
      .update({ last_crawled_at: new Date().toISOString(), last_crawl_status: 'error', updated_at: new Date().toISOString() })
      .eq('id', page.id);
    return { page_id: page.id, url: page.url, status: 'error', error: message };
  }

  const title = extractTitle(html);
  const sections = extractSections(html);
  const contentText = sections.map((s) => s.text).join('\n');
  const contentHash = hashContent(contentText);

  const { data: existing } = await supabase
    .from('assist_corpus_pages')
    .select('content_hash')
    .eq('id', page.id)
    .maybeSingle();

  if (existing?.content_hash === contentHash) {
    await supabase
      .from('assist_corpus_pages')
      .update({ last_crawled_at: new Date().toISOString(), last_crawl_status: 'unchanged', title, updated_at: new Date().toISOString() })
      .eq('id', page.id);
    return { page_id: page.id, url: page.url, status: 'unchanged' };
  }

  const chunks = chunkSections(sections);
  if (chunks.length === 0) {
    await supabase
      .from('assist_corpus_pages')
      .update({ last_crawled_at: new Date().toISOString(), last_crawl_status: 'error', title, updated_at: new Date().toISOString() })
      .eq('id', page.id);
    return { page_id: page.id, url: page.url, status: 'error', error: 'no extractable content' };
  }

  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const result = await embedDocuments(batch.map((c) => c.chunk_text));
    if (result.mode === 'disabled') {
      return { page_id: page.id, url: page.url, status: 'disabled', error: result.reason };
    }
    if (result.mode === 'error') {
      await supabase
        .from('assist_corpus_pages')
        .update({ last_crawled_at: new Date().toISOString(), last_crawl_status: 'error', updated_at: new Date().toISOString() })
        .eq('id', page.id);
      return { page_id: page.id, url: page.url, status: 'error', error: result.reason };
    }
    embeddings.push(...result.vectors);
  }

  // Replace this page's chunks in one pass: delete then insert. Not wrapped
  // in a database transaction (supabase-js has no cross-statement
  // transaction API); an interrupted reindex leaves the page briefly
  // chunk-less rather than duplicated, and the next reindex repairs it.
  const { error: deleteErr } = await supabase.from('assist_corpus_chunks').delete().eq('page_id', page.id);
  if (deleteErr) {
    return { page_id: page.id, url: page.url, status: 'error', error: deleteErr.message };
  }

  const rows = chunks.map((chunk, i) => ({
    page_id: page.id,
    firm_id: firmId,
    heading: chunk.heading,
    chunk_text: chunk.chunk_text,
    embedding: toVectorLiteral(embeddings[i]),
    chunk_index: chunk.chunk_index,
  }));
  const { error: insertErr } = await supabase.from('assist_corpus_chunks').insert(rows);
  if (insertErr) {
    return { page_id: page.id, url: page.url, status: 'error', error: insertErr.message };
  }

  await supabase
    .from('assist_corpus_pages')
    .update({
      title,
      content_hash: contentHash,
      last_crawled_at: new Date().toISOString(),
      last_crawl_status: 'ok',
      updated_at: new Date().toISOString(),
    })
    .eq('id', page.id);

  return { page_id: page.id, url: page.url, status: 'ok', chunk_count: rows.length };
}

export async function reindexFirm(firmId: string): Promise<ReindexSummary> {
  const { data: pages } = await supabase
    .from('assist_corpus_pages')
    .select('id, url')
    .eq('firm_id', firmId)
    .eq('include', true);

  const results: ReindexPageResult[] = [];
  for (const page of pages ?? []) {
    results.push(await reindexOnePage(page, firmId));
  }

  return {
    pages_processed: results.length,
    pages_ok: results.filter((r) => r.status === 'ok').length,
    pages_unchanged: results.filter((r) => r.status === 'unchanged').length,
    pages_errored: results.filter((r) => r.status === 'error').length,
    pages_disabled: results.filter((r) => r.status === 'disabled').length,
    results,
  };
}
