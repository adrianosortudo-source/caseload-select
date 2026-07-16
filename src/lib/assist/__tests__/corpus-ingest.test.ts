/**
 * Tests for the I/O layer of Firm Assist ingestion (Ses.18 audit F2/F3).
 * Mocks safeFetch, supabase-admin, and gemini-embed so the real network,
 * database, and Gemini API are never touched.
 *
 * The supabase-js query builder is chainable AND thenable (awaiting the
 * builder itself resolves the query), so the mock below is a generic
 * chainable object: every filter method returns `this`, and `.then()`
 * resolves to whatever result the test configured for that table+method.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  embedDocuments: vi.fn(),
}));

vi.mock('@/lib/safe-outbound-fetch', () => ({
  safeFetch: mocks.safeFetch,
}));

vi.mock('../gemini-embed', () => ({
  embedDocuments: mocks.embedDocuments,
}));

const state = vi.hoisted(() => ({
  // assist_corpus_pages.select('url') existing-rows lookup (seed dedupe)
  existingUrlRows: [] as Array<{ url: string }>,
  // assist_corpus_pages.select('id, url')...order(...) (reindexFirm page list)
  pageListRows: [] as Array<{ id: string; url: string }>,
  insertCalls: [] as Array<{ table: string; rows: unknown }>,
  orderCalls: [] as Array<{ table: string; column: string; opts: unknown }>,
}));

function chainable(resolveValue: unknown) {
  const builder: Record<string, unknown> = {};
  const passthroughMethods = ['select', 'eq', 'in', 'gte', 'limit', 'delete', 'update'];
  for (const m of passthroughMethods) {
    builder[m] = vi.fn(() => builder);
  }
  builder.order = vi.fn((column: string, opts: unknown) => {
    state.orderCalls.push({ table: '(see call order)', column, opts });
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve(resolveValue));
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolveValue).then(resolve);
  return builder;
}

vi.mock('@/lib/supabase-admin', () => {
  const from = (table: string) => {
    if (table === 'assist_corpus_pages') {
      const builder = chainable({ data: state.pageListRows, error: null });
      // select('url') path (existing-rows dedupe) needs its own resolve
      // shape; both queries share this table, so branch on call args via a
      // wrapping select().
      const originalSelect = builder.select as ReturnType<typeof vi.fn>;
      builder.select = vi.fn((cols: string) => {
        originalSelect(cols);
        if (cols === 'url') {
          return chainable({ data: state.existingUrlRows, error: null });
        }
        if (cols === 'content_hash') {
          return chainable({ data: null, error: null });
        }
        return builder;
      });
      builder.insert = vi.fn((rows: unknown) => {
        state.insertCalls.push({ table, rows });
        return Promise.resolve({ error: null });
      });
      builder.update = vi.fn(() => chainable({ data: null, error: null }));
      return builder;
    }
    if (table === 'assist_corpus_chunks') {
      const builder = chainable({ error: null });
      builder.insert = vi.fn((rows: unknown) => {
        state.insertCalls.push({ table, rows });
        return Promise.resolve({ error: null });
      });
      builder.delete = vi.fn(() => chainable({ error: null }));
      return builder;
    }
    throw new Error(`unexpected table in test: ${table}`);
  };
  return { supabaseAdmin: { from } };
});

import { seedPagesFromSitemap, reindexFirm } from '../corpus-ingest';

beforeEach(() => {
  vi.clearAllMocks();
  state.existingUrlRows = [];
  state.pageListRows = [];
  state.insertCalls = [];
  state.orderCalls = [];
});

function sitemapResult(body: string) {
  return { ok: true, status: 200, body, reason: null };
}

describe('seedPagesFromSitemap: offsite gate (Ses.18 audit F2)', () => {
  it('drops an offsite <loc> entry from a sitemap, counting it in skipped_offsite', async () => {
    const xml = `<urlset>
      <url><loc>https://drglaw.ca/faq</loc></url>
      <url><loc>https://drglaw.ca/about</loc></url>
      <url><loc>https://evil.example/steal-me</loc></url>
    </urlset>`;
    mocks.safeFetch.mockResolvedValue(sitemapResult(xml));

    const result = await seedPagesFromSitemap('firm-1', 'https://drglaw.ca');

    expect(result.total_found).toBe(2);
    expect(result.skipped_offsite).toBe(1);
    expect(result.errors).toEqual([]);
    const insertedUrls = (state.insertCalls[0]?.rows as Array<{ url: string }>).map((r) => r.url);
    expect(insertedUrls).not.toContain('https://evil.example/steal-me');
    expect(insertedUrls).toContain('https://drglaw.ca/faq');
  });

  it('never fetches an offsite sitemap-index child at all', async () => {
    const indexXml = `<sitemapindex>
      <sitemap><loc>https://drglaw.ca/sitemap-pages.xml</loc></sitemap>
      <sitemap><loc>https://attacker.example/sitemap-inject.xml</loc></sitemap>
    </sitemapindex>`;
    const childXml = `<urlset><url><loc>https://drglaw.ca/faq</loc></url></urlset>`;
    mocks.safeFetch.mockImplementation((url: string) => {
      if (url === 'https://drglaw.ca/sitemap.xml') return Promise.resolve(sitemapResult(indexXml));
      if (url === 'https://drglaw.ca/sitemap-pages.xml') return Promise.resolve(sitemapResult(childXml));
      throw new Error(`test should never fetch ${url}`);
    });

    const result = await seedPagesFromSitemap('firm-1', 'https://drglaw.ca');

    expect(result.total_found).toBe(1);
    expect(mocks.safeFetch).not.toHaveBeenCalledWith('https://attacker.example/sitemap-inject.xml', expect.anything());
  });

  it('calls safeFetch with method GET (safeFetch itself defaults to POST)', async () => {
    mocks.safeFetch.mockResolvedValue(sitemapResult('<urlset><url><loc>https://drglaw.ca/faq</loc></url></urlset>'));
    await seedPagesFromSitemap('firm-1', 'https://drglaw.ca');
    expect(mocks.safeFetch).toHaveBeenCalledWith('https://drglaw.ca/sitemap.xml', expect.objectContaining({ method: 'GET' }));
  });

  it('surfaces a safeFetch rejection (e.g. private-IP block) as a seed error, not a throw', async () => {
    mocks.safeFetch.mockResolvedValue({ ok: false, status: null, body: null, reason: 'host resolves to private IP 169.254.169.254' });
    const result = await seedPagesFromSitemap('firm-1', 'https://drglaw.ca');
    expect(result.total_found).toBe(0);
    expect(result.errors[0]).toContain('private IP');
  });
});

describe('reindexFirm: budget cutoff (Ses.18 audit F3)', () => {
  it('with no budget, processes every page (existing behavior unchanged)', async () => {
    state.pageListRows = [
      { id: 'p1', url: 'https://drglaw.ca/a' },
      { id: 'p2', url: 'https://drglaw.ca/b' },
    ];
    mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, body: '<main><h2>T</h2><p>short</p></main>', reason: null });
    mocks.embedDocuments.mockResolvedValue({ mode: 'error', vectors: [], reason: 'boom' });

    const summary = await reindexFirm('firm-1');

    expect(summary.pages_processed).toBe(2);
    expect(summary.pages_skipped_budget).toBe(0);
  });

  it('a budget already exceeded before the first page skips every page, reporting them', async () => {
    state.pageListRows = [
      { id: 'p1', url: 'https://drglaw.ca/a' },
      { id: 'p2', url: 'https://drglaw.ca/b' },
      { id: 'p3', url: 'https://drglaw.ca/c' },
    ];

    const summary = await reindexFirm('firm-1', { budgetMs: -1 });

    expect(summary.pages_processed).toBe(0);
    expect(summary.pages_skipped_budget).toBe(3);
    expect(mocks.safeFetch).not.toHaveBeenCalled();
  });

  it('orders the page query oldest-crawled-first, nulls first', async () => {
    state.pageListRows = [];
    await reindexFirm('firm-1');
    const call = state.orderCalls.find((c) => c.column === 'last_crawled_at');
    expect(call).toBeTruthy();
    expect(call?.opts).toEqual({ ascending: true, nullsFirst: true });
  });
});
