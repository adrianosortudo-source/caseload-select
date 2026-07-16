/**
 * Pure helpers for Firm Assist corpus ingestion (DR-100, DR-101). No I/O.
 *
 * Sitemap parsing, seed-exclude matching, and HTML-to-chunk extraction all
 * live here so they get direct vitest coverage without a network or a
 * database. The I/O wrapper (corpus-ingest.ts) calls these and handles
 * fetch + Supabase reads/writes.
 *
 * No HTML parser dependency exists in this repo, so extraction is
 * regex-based. This is acceptable because the corpus is well-formed HTML
 * from controlled sources (this app's own Next.js output, or a firm's own
 * production site), not arbitrary third-party markup.
 */

import { createHash } from 'crypto';

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Decodes named entities from HTML_ENTITIES plus numeric character
 * references (decimal &#39; and hex &#x27;). Field-detected 2026-07-16
 * live-verifying the DRG corpus: apostrophes on the real site render as
 * &#x27; (hex), which the named-only version silently left in retrieved
 * chunk text and would have surfaced verbatim in generated answers.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const codePoint = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : m;
    }
    return HTML_ENTITIES[code.toLowerCase()] ?? m;
  });
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Sitemap parsing
// ---------------------------------------------------------------------------

/** True when the XML document root is a sitemap index (points at child sitemaps, not pages). */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/** Every <loc>...</loc> value in a sitemap or sitemap-index document, trimmed. */
export function extractLocs(xml: string): string[] {
  const matches = xml.matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi);
  const locs: string[] = [];
  for (const m of matches) {
    const value = m[1]?.trim();
    if (value) locs.push(value);
  }
  return locs;
}

// ---------------------------------------------------------------------------
// Seed-exclude rules (DR-101 default exclusions)
// ---------------------------------------------------------------------------

export interface SeedExcludeResult {
  exclude: boolean;
  reason?: string;
}

const EXCLUDE_PATH_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\/(privacy|privacidade)(\/|$|\.)/i, reason: 'seed_rule:privacy' },
  { re: /\/(terms|termos)(\/|$|\.)/i, reason: 'seed_rule:terms' },
  { re: /\/(thank-you|thanks|obrigado|obrigada)(\/|$|\.)/i, reason: 'seed_rule:thank_you' },
  { re: /\/(tag|tags|category|categories|categoria|categorias)\//i, reason: 'seed_rule:taxonomy_index' },
  { re: /\/page\/\d+(\/|$)/i, reason: 'seed_rule:pagination' },
  { re: /\?.*\bpage=\d+/i, reason: 'seed_rule:pagination' },
];

const NON_HTML_EXTENSION_RE = /\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|json|xml|txt|ico|woff2?|ttf|zip|mp4|mp3)(\?.*)?$/i;

/**
 * Applies the DR-101 default seed-exclude rules to a URL. Operator-set
 * `include` flags on already-seeded pages are never touched by this
 * function; it only decides the default for a NEWLY discovered URL.
 */
export function shouldExcludeBySeedRule(url: string): SeedExcludeResult {
  let path: string;
  try {
    path = new URL(url).pathname + new URL(url).search;
  } catch {
    return { exclude: true, reason: 'seed_rule:invalid_url' };
  }
  if (NON_HTML_EXTENSION_RE.test(path)) {
    return { exclude: true, reason: 'seed_rule:non_html_asset' };
  }
  for (const { re, reason } of EXCLUDE_PATH_PATTERNS) {
    if (re.test(path)) return { exclude: true, reason };
  }
  return { exclude: false };
}

// ---------------------------------------------------------------------------
// Same-site gate (Ses.18 audit F2)
// ---------------------------------------------------------------------------

/**
 * True when `url` belongs to the same site as `seedOrigin` (the operator-
 * provided root the firm's sitemap was seeded from). http(s) only; the
 * `www.` prefix is ignored in both directions so `drglaw.ca` and
 * `www.drglaw.ca` match each other, but a different subdomain
 * (`blog.drglaw.ca`) or a different host entirely does not.
 *
 * A malicious or compromised client-site sitemap can list <loc> entries
 * pointing anywhere; without this gate, seedPagesFromSitemap would insert
 * (and reindexFirm would later fetch, even through safeFetch's SSRF
 * filter) arbitrary public URLs into a firm's corpus. This is a
 * data-integrity gate, separate from and in addition to safeFetch's
 * network-layer SSRF protection.
 */
export function isSameSiteUrl(url: string, seedOrigin: string): boolean {
  let target: URL;
  let seed: URL;
  try {
    target = new URL(url);
    seed = new URL(seedOrigin);
  } catch {
    return false;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;

  const bareHost = (h: string) => (h.startsWith('www.') ? h.slice(4) : h);
  return bareHost(target.hostname.toLowerCase()) === bareHost(seed.hostname.toLowerCase());
}

// ---------------------------------------------------------------------------
// HTML content extraction + chunking
// ---------------------------------------------------------------------------

export interface ExtractedSection {
  heading: string | null;
  text: string;
}

const STRIP_BLOCK_RE = /<(script|style|noscript|svg|nav|header|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Extracts the document <title>, falling back to the first h1. */
export function extractTitle(html: string): string | null {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    const t = stripTags(titleMatch[1]);
    if (t) return t;
  }
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1]) {
    const t = stripTags(h1Match[1]);
    if (t) return t;
  }
  return null;
}

/**
 * Strips chrome (nav/header/footer/script/style/form/comments), narrows to
 * <main>/<article> when present, then splits the remaining markup into
 * sections at each h1/h2/h3 boundary. Sections shorter than the noise floor
 * (likely leftover nav/breadcrumb junk) are dropped.
 */
export function extractSections(html: string): ExtractedSection[] {
  let body = html.replace(COMMENT_RE, '').replace(STRIP_BLOCK_RE, ' ');

  const mainMatch = body.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ?? body.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (mainMatch?.[1]) {
    body = mainMatch[1];
  }

  const headingRe = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  const boundaries: Array<{ index: number; length: number; heading: string }> = [];
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(body)) !== null) {
    boundaries.push({ index: hm.index, length: hm[0].length, heading: stripTags(hm[1]) });
  }

  const sections: ExtractedSection[] = [];
  const NOISE_FLOOR = 40;

  if (boundaries.length === 0) {
    const text = stripTags(body);
    if (text.length >= NOISE_FLOOR) sections.push({ heading: null, text });
    return sections;
  }

  const leading = stripTags(body.slice(0, boundaries[0].index));
  if (leading.length >= NOISE_FLOOR) sections.push({ heading: null, text: leading });

  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].index + boundaries[i].length;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : body.length;
    const text = stripTags(body.slice(start, end));
    if (text.length >= NOISE_FLOOR) {
      sections.push({ heading: boundaries[i].heading || null, text });
    }
  }

  return sections;
}

export interface Chunk {
  heading: string | null;
  chunk_text: string;
  chunk_index: number;
}

const MAX_CHUNK_CHARS = 2500;

/**
 * Splits extracted sections into chunks bounded by MAX_CHUNK_CHARS,
 * preferring sentence boundaries. A short section stays whole. A single
 * sentence longer than the cap (a wall-of-text section with no
 * punctuation) is hard-cut in a loop, so the trailing remainder can never
 * itself come out over MAX_CHUNK_CHARS.
 */
export function chunkSections(sections: ExtractedSection[]): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;

  const pushChunk = (heading: string | null, text: string) => {
    const trimmed = text.trim();
    if (trimmed) chunks.push({ heading, chunk_text: trimmed, chunk_index: index++ });
  };

  // Hard-cuts oversized text into MAX_CHUNK_CHARS pieces, returning
  // whatever remainder is left (guaranteed <= MAX_CHUNK_CHARS).
  const hardCut = (heading: string | null, text: string): string => {
    let remaining = text;
    while (remaining.length > MAX_CHUNK_CHARS) {
      pushChunk(heading, remaining.slice(0, MAX_CHUNK_CHARS));
      remaining = remaining.slice(MAX_CHUNK_CHARS);
    }
    return remaining;
  };

  for (const section of sections) {
    if (section.text.length <= MAX_CHUNK_CHARS) {
      pushChunk(section.heading, section.text);
      continue;
    }

    const sentences = section.text.split(/(?<=[.!?])\s+/);
    let current = '';
    for (const sentence of sentences) {
      if (sentence.length > MAX_CHUNK_CHARS) {
        // A single sentence already exceeds the cap on its own. Flush
        // whatever was accumulated, then hard-cut this one.
        if (current.trim()) pushChunk(section.heading, current);
        current = hardCut(section.heading, sentence);
        continue;
      }
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length > MAX_CHUNK_CHARS) {
        pushChunk(section.heading, current);
        current = sentence;
      } else {
        current = candidate;
      }
    }
    if (current.trim()) {
      pushChunk(section.heading, current);
    }
  }

  return chunks;
}

/** Deterministic content hash used to skip re-embedding an unchanged page. */
export function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
