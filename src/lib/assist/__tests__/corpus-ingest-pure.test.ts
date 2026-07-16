import { describe, it, expect } from 'vitest';
import {
  isSitemapIndex,
  extractLocs,
  shouldExcludeBySeedRule,
  extractTitle,
  extractSections,
  chunkSections,
  hashContent,
} from '../corpus-ingest-pure';

describe('isSitemapIndex', () => {
  it('detects a sitemap index root', () => {
    expect(isSitemapIndex('<sitemapindex xmlns="x"><sitemap></sitemap></sitemapindex>')).toBe(true);
  });

  it('returns false for a plain urlset', () => {
    expect(isSitemapIndex('<urlset><url><loc>https://a.com/</loc></url></urlset>')).toBe(false);
  });
});

describe('extractLocs', () => {
  it('extracts loc values from a urlset', () => {
    const xml = '<urlset><url><loc>https://a.com/</loc></url><url><loc>https://a.com/b</loc></url></urlset>';
    expect(extractLocs(xml)).toEqual(['https://a.com/', 'https://a.com/b']);
  });

  it('extracts loc values from a sitemap index (recursion is the IO layer\'s job)', () => {
    const xml = '<sitemapindex><sitemap><loc>https://a.com/sitemap-pages.xml</loc></sitemap></sitemapindex>';
    expect(extractLocs(xml)).toEqual(['https://a.com/sitemap-pages.xml']);
  });

  it('returns an empty array for malformed input', () => {
    expect(extractLocs('not xml at all')).toEqual([]);
  });
});

describe('shouldExcludeBySeedRule', () => {
  it('excludes privacy pages', () => {
    expect(shouldExcludeBySeedRule('https://drglaw.ca/privacy').exclude).toBe(true);
  });

  it('excludes terms pages', () => {
    expect(shouldExcludeBySeedRule('https://drglaw.ca/terms').exclude).toBe(true);
  });

  it('excludes thank-you pages (EN and PT)', () => {
    expect(shouldExcludeBySeedRule('https://drglaw.ca/thank-you').exclude).toBe(true);
    expect(shouldExcludeBySeedRule('https://drglaw.ca/pt/obrigado').exclude).toBe(true);
  });

  it('excludes taxonomy index pages', () => {
    expect(shouldExcludeBySeedRule('https://drglaw.ca/tag/leases').exclude).toBe(true);
    expect(shouldExcludeBySeedRule('https://drglaw.ca/category/employment').exclude).toBe(true);
  });

  it('excludes paginated archive URLs', () => {
    expect(shouldExcludeBySeedRule('https://drglaw.ca/journal/page/2').exclude).toBe(true);
    expect(shouldExcludeBySeedRule('https://drglaw.ca/journal?page=3').exclude).toBe(true);
  });

  it('excludes non-HTML assets', () => {
    expect(shouldExcludeBySeedRule('https://drglaw.ca/files/brochure.pdf').exclude).toBe(true);
    expect(shouldExcludeBySeedRule('https://drglaw.ca/sitemap.xml').exclude).toBe(true);
  });

  it('includes an ordinary content page by default', () => {
    const result = shouldExcludeBySeedRule('https://drglaw.ca/journal/commercial-lease-guide');
    expect(result.exclude).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('excludes and reasons an unparseable URL rather than throwing', () => {
    const result = shouldExcludeBySeedRule('not a url');
    expect(result.exclude).toBe(true);
    expect(result.reason).toBe('seed_rule:invalid_url');
  });
});

describe('extractTitle', () => {
  it('prefers the <title> tag', () => {
    const html = '<html><head><title>Commercial Leases | DRG Law</title></head><body><h1>Different</h1></body></html>';
    expect(extractTitle(html)).toBe('Commercial Leases | DRG Law');
  });

  it('falls back to the first h1 when there is no title', () => {
    const html = '<html><body><h1>Commercial Leases</h1></body></html>';
    expect(extractTitle(html)).toBe('Commercial Leases');
  });

  it('returns null when neither exists', () => {
    expect(extractTitle('<html><body><p>No heading here</p></body></html>')).toBeNull();
  });
});

describe('extractSections', () => {
  it('strips nav, header, footer, script, and style before extracting', () => {
    const html = `
      <html><body>
        <nav>Home | About | Contact</nav>
        <header>Site header content that should never appear here</header>
        <script>window.trackEvent('pageview');</script>
        <style>.hero { color: red; }</style>
        <main>
          <h1>Commercial Lease Reviews</h1>
          <p>${'The firm reviews commercial leases before you sign. '.repeat(5)}</p>
          <footer>Copyright footer text that should never appear here</footer>
        </main>
      </body></html>`;
    const sections = extractSections(html);
    const joined = sections.map((s) => s.text).join(' ');
    expect(joined).not.toContain('Home | About | Contact');
    expect(joined).not.toContain('Site header content');
    expect(joined).not.toContain('Copyright footer');
    expect(joined).not.toContain('trackEvent');
    expect(joined).not.toContain('.hero');
    expect(sections.some((s) => s.heading === 'Commercial Lease Reviews')).toBe(true);
  });

  it('prefers content inside <main> over content outside it', () => {
    const html = `
      <html><body>
        <div>Sidebar promo content outside main, should be dropped when main exists and is long enough on its own</div>
        <main><h2>Inside Main</h2><p>${'This is the real content of the page that matters most. '.repeat(4)}</p></main>
      </body></html>`;
    const sections = extractSections(html);
    const joined = sections.map((s) => s.text).join(' ');
    expect(joined).not.toContain('Sidebar promo');
    expect(joined).toContain('real content of the page');
  });

  it('splits into multiple sections at h1/h2/h3 boundaries', () => {
    const html = `<main>
      <h2>First Topic</h2><p>${'Content about the first topic. '.repeat(4)}</p>
      <h2>Second Topic</h2><p>${'Content about the second topic. '.repeat(4)}</p>
    </main>`;
    const sections = extractSections(html);
    expect(sections.map((s) => s.heading)).toEqual(['First Topic', 'Second Topic']);
  });

  it('drops sections below the noise floor (leftover nav/breadcrumb junk)', () => {
    const html = '<main><h2>Tiny</h2><p>Hi</p></main>';
    expect(extractSections(html)).toEqual([]);
  });

  it('decodes HTML entities', () => {
    const html = `<main><p>${'Landlords &amp; tenants &mdash; rights &amp; obligations. '.repeat(3)}</p></main>`;
    const sections = extractSections(html);
    expect(sections[0].text).toContain('Landlords & tenants');
  });

  it('decodes hex and decimal numeric character references (real drglaw.ca apostrophe encoding)', () => {
    const html = `<main><p>${"The owner&#x27;s obligations confirm the company&#39;s duties under the lease. ".repeat(3)}</p></main>`;
    const sections = extractSections(html);
    expect(sections[0].text).toContain("owner's obligations");
    expect(sections[0].text).toContain("company's duties");
    expect(sections[0].text).not.toContain('&#x27;');
    expect(sections[0].text).not.toContain('&#39;');
  });
});

describe('chunkSections', () => {
  it('keeps a short section as a single chunk', () => {
    const chunks = chunkSections([{ heading: 'Short', text: 'A short paragraph of content.' }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ heading: 'Short', chunk_text: 'A short paragraph of content.', chunk_index: 0 });
  });

  it('splits a long section into multiple chunks at sentence boundaries', () => {
    const sentence = 'This is one sentence about commercial leases in Ontario. ';
    const longText = sentence.repeat(80); // well over MAX_CHUNK_CHARS (2500)
    const chunks = chunkSections([{ heading: 'Long', text: longText }]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.chunk_text.length).toBeLessThanOrEqual(2500);
    }
    // chunk_index increments monotonically starting at 0
    expect(chunks.map((c) => c.chunk_index)).toEqual(chunks.map((_, i) => i));
  });

  it('hard-cuts a single sentence that alone exceeds the max (no punctuation)', () => {
    const wallOfText = 'a'.repeat(6000);
    const chunks = chunkSections([{ heading: null, text: wallOfText }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.chunk_text.length <= 2500)).toBe(true);
  });

  it('continues chunk_index across multiple sections on the same page', () => {
    const chunks = chunkSections([
      { heading: 'A', text: 'First section text.' },
      { heading: 'B', text: 'Second section text.' },
    ]);
    expect(chunks.map((c) => c.chunk_index)).toEqual([0, 1]);
  });
});

describe('hashContent', () => {
  it('is deterministic for the same input', () => {
    expect(hashContent('hello world')).toBe(hashContent('hello world'));
  });

  it('differs for different input', () => {
    expect(hashContent('hello world')).not.toBe(hashContent('hello there'));
  });
});
