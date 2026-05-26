/**
 * Triage queue search + rank.
 *
 * The simple substring filter in `triage-queue-filter.ts` is fine for "find
 * everything that contains this string." But the lawyer's daily use of the
 * search field has three failure modes that substring matching can't handle:
 *
 *   1. Typos. The lawyer types "patell" or "Sahar" and the search returns
 *      nothing. Damerau-Levenshtein with a small edit-distance threshold
 *      fixes this. We only fuzzy-match queries of 4+ chars to avoid noisy
 *      false positives on very short queries.
 *
 *   2. Multi-word queries. "patel messenger" should ONLY return Patel rows
 *      that came in via Messenger, not every row with "patel" OR every
 *      row with "messenger". Multi-token AND across the row's full corpus.
 *
 *   3. Power-user disambiguation. "patel" might match a name, an email, a
 *      matter type. When the lawyer knows which field to look in, field
 *      qualifiers (`name:patel`, `phone:647`, `band:A`, `channel:voice`,
 *      `email:gmail`, `matter:dismissal`, `ref:Z3A`, `text:harassment`)
 *      narrow the search without forcing them to use a separate UI.
 *
 * The output is ranked: every match gets a score (sum of per-token best
 * matches, weighted by field), so the most relevant rows surface first.
 * Empty query returns all rows in original order (preserves the
 * band-then-deadline sort the page already applied).
 *
 * Each result also carries `highlights`: the lowercased token strings that
 * matched somewhere in the row. The card renderer uses these to wrap
 * matching substrings in `<mark>` so the lawyer sees why a row matched at
 * a glance.
 */

import { matterLabel } from "./screened-leads-labels";
import { channelLabel } from "./channel-labels";

// ─── Types ──────────────────────────────────────────────────────────────

export type SearchField =
  | "any"
  | "name"
  | "phone"
  | "email"
  | "postal"
  | "band"
  | "channel"
  | "matter"
  | "ref"
  | "text";

export interface SearchToken {
  field: SearchField;
  value: string;
  /** True when the user wrote `field:value`; false when the token is plain. */
  qualified: boolean;
  /** True when the token was prefixed with `-` (e.g. `-channel:voice`). */
  negated: boolean;
}

export interface SearchableQueueRow {
  lead_id: string;
  band: "A" | "B" | "C" | "D" | null;
  matter_type: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_postal_code: string | null;
  slot_answers: { channel?: string } | null;
  brief_json: { matter_snapshot?: string; fee_estimate?: string } | null;
  whale_nurture?: boolean;
  submitted_at?: string;
}

export interface SavedView {
  id: string;
  label: string;
  /** Pre-set band filter applied when the view is selected. */
  bands?: Array<"A" | "B" | "C" | "D">;
  /** Pre-set channel filter applied when the view is selected. */
  channels?: string[];
  /** Pre-set query applied when the view is selected. */
  query?: string;
  /** Row-level flag filter (e.g. whale_nurture). */
  flag?: "whale_nurture";
  /** Time-window filter: only include rows submitted within the past N hours. */
  withinHours?: number;
  /** Time-window filter: only include rows submitted MORE than N hours ago. */
  olderThanHours?: number;
}

/**
 * Canonical preset views. Order is the order they render in the header.
 * Numbers picked from operator daily flow: priority comes first, then
 * the cohorts that recur ("am I missing a whale?", "any voice today?",
 * "anything stale that's about to expire?").
 */
export const SAVED_VIEWS: readonly SavedView[] = [
  { id: "priority", label: "Top priority", bands: ["A", "B"] },
  { id: "whales", label: "Whales", flag: "whale_nurture" },
  { id: "voice", label: "Voice", channels: ["voice"] },
  { id: "stale", label: "Stale (4h+)", olderThanHours: 4 },
] as const;

export interface SearchOptions {
  query: string;
  bands: Array<"A" | "B" | "C" | "D">;
  channels: string[];
  view?: SavedView | null;
  /** Test-only: override the wall-clock for time-window filters. */
  now?: Date;
}

export interface ScoredRow<T extends SearchableQueueRow> {
  row: T;
  score: number;
  /** Lowercased token strings that matched in this row. Used for `<mark>` wrapping. */
  highlights: string[];
}

// ─── Tokenisation ───────────────────────────────────────────────────────

const QUALIFIER_NAMES = new Set<string>([
  "name", "phone", "email", "postal", "band", "channel", "matter", "ref", "text",
]);

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * Lex a query into tokens. Token grammar (informal):
 *
 *   token       = ['-'] [field ':'] value
 *   value       = quoted | unquoted
 *   quoted      = '"' anything-but-quote '"'      (unclosed quote: read to EOS)
 *   unquoted    = chars until whitespace
 *   field       = name | phone | email | postal | band | channel | matter | ref | text
 *
 * Examples:
 *   patel                              → [{any, "patel"}]
 *   patel messenger                    → [{any, "patel"}, {any, "messenger"}]
 *   "van der berg"                     → [{any, "van der berg"}]
 *   name:"van der berg"                → [{name, "van der berg", qualified}]
 *   -channel:voice                     → [{channel, "voice", qualified, negated}]
 *   patel -channel:voice               → [{any, "patel"}, {channel, "voice", negated}]
 *   "sarah patel" name:lee             → [{any, "sarah patel"}, {name, "lee", qualified}]
 *   foo:bar                            → [{any, "foo:bar"}]   (unknown qualifier → plain)
 *   "unclosed                          → [{any, "unclosed"}]  (best-effort)
 */
export function tokenize(query: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  const n = query.length;
  let i = 0;

  while (i < n) {
    // Skip whitespace.
    while (i < n && isWhitespace(query[i])) i++;
    if (i >= n) break;

    // Optional negation prefix.
    let negated = false;
    if (query[i] === "-") {
      // Only treat as negation if followed by a non-whitespace char.
      if (i + 1 < n && !isWhitespace(query[i + 1])) {
        negated = true;
        i++;
      }
    }

    // Optional field qualifier `field:`. We peek for a known qualifier name
    // followed by ':' before consuming. Unknown qualifiers fall through to a
    // plain-text token.
    let field: SearchField = "any";
    let qualified = false;
    const colonOffset = query.indexOf(":", i);
    if (colonOffset > i) {
      // Make sure the would-be qualifier doesn't contain whitespace (the colon
      // must belong to this token).
      let valid = true;
      for (let k = i; k < colonOffset; k++) {
        if (isWhitespace(query[k])) { valid = false; break; }
      }
      if (valid) {
        const candidate = query.slice(i, colonOffset).toLowerCase();
        if (QUALIFIER_NAMES.has(candidate)) {
          field = candidate as SearchField;
          qualified = true;
          i = colonOffset + 1;
        }
      }
    }

    // Read the value: quoted or unquoted.
    let value = "";
    if (i < n && query[i] === "\"") {
      i++; // skip opening quote
      while (i < n && query[i] !== "\"") {
        value += query[i];
        i++;
      }
      if (i < n && query[i] === "\"") i++; // skip closing quote
    } else {
      while (i < n && !isWhitespace(query[i])) {
        value += query[i];
        i++;
      }
    }

    // Skip empty values and lone-dash noise (e.g. a stray "-" the user is
    // about to follow with a qualifier).
    if (value.length > 0 && value !== "-") {
      tokens.push({ field, value, qualified, negated });
    }
  }

  return tokens;
}

// ─── Damerau-Levenshtein ────────────────────────────────────────────────

/**
 * Damerau-Levenshtein edit distance with adjacent-transposition support.
 * Quadratic in string length, fine for queue rows (single-digit names).
 *
 *   damerauLevenshtein("patel", "patell") === 1   (insertion)
 *   damerauLevenshtein("sarah", "sahar")  === 1   (transposition)
 *   damerauLevenshtein("kitten", "sitting") === 3 (substitution + substitution + insertion)
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length;
  const n = b.length;
  // Three rolling rows: prev-prev, prev, curr. Transposition needs two rows back.
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // deletion
        d[i][j - 1] + 1,      // insertion
        d[i - 1][j - 1] + cost, // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return d[m][n];
}

// ─── Field accessors ────────────────────────────────────────────────────

function digitsOnly(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D+/g, "");
}

function postalNormalised(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, "").toUpperCase();
}

interface FieldCorpus {
  /** Lower-cased text. Empty string when the field is null/missing. */
  text: string;
  /** Normalised digits-only form (phone). */
  digits?: string;
  /** Normalised postal form (no whitespace, upper). */
  postal?: string;
}

function corpusFor(row: SearchableQueueRow, field: Exclude<SearchField, "any">): FieldCorpus {
  switch (field) {
    case "name":    return { text: (row.contact_name ?? "").toLowerCase() };
    case "phone":   return { text: (row.contact_phone ?? "").toLowerCase(), digits: digitsOnly(row.contact_phone) };
    case "email":   return { text: (row.contact_email ?? "").toLowerCase() };
    case "postal":  return { text: (row.contact_postal_code ?? "").toLowerCase(), postal: postalNormalised(row.contact_postal_code) };
    case "band":    return { text: (row.band ?? "").toLowerCase() };
    case "channel": {
      const code = row.slot_answers?.channel ?? "";
      return { text: `${code} ${channelLabel(code)}`.toLowerCase() };
    }
    case "matter":  return { text: `${row.matter_type} ${matterLabel(row.matter_type)}`.toLowerCase() };
    case "ref":     return { text: row.lead_id.toLowerCase() };
    case "text": {
      const snap = row.brief_json?.matter_snapshot ?? "";
      const fee = row.brief_json?.fee_estimate ?? "";
      return { text: `${snap} ${fee}`.toLowerCase() };
    }
  }
}

// ─── Scoring ────────────────────────────────────────────────────────────

/**
 * Per-field weight. Higher = more important. The lawyer's mental model puts
 * the name + phone + email at the top; brief text is a fallback for "I
 * remember the matter mentioned something about a harassment complaint."
 */
const FIELD_WEIGHT: Record<Exclude<SearchField, "any">, number> = {
  name: 1.0,
  phone: 0.95,
  email: 0.95,
  postal: 0.85,
  band: 0.85,
  channel: 0.85,
  matter: 0.75,
  ref: 0.7,
  text: 0.4,
};

/** Match strength multipliers — exact > prefix > substring > fuzzy. */
const MATCH_EXACT = 100;
const MATCH_PREFIX = 80;
const MATCH_SUBSTRING = 60;
const MATCH_FUZZY = 40;

/**
 * Score a single token against a single field. Returns the highest match
 * strength found (exact > prefix > substring > fuzzy), weighted by field.
 * Returns 0 when no match.
 */
function scoreFieldMatch(token: string, corpus: FieldCorpus, field: Exclude<SearchField, "any">): number {
  const q = token.toLowerCase();
  if (!q) return 0;
  const v = corpus.text;
  // Phone-specific digit-only match: query "647" finds "(647) 555-9999".
  if (field === "phone" && corpus.digits && corpus.digits.length > 0) {
    const qDigits = digitsOnly(q);
    if (qDigits.length >= 3 && corpus.digits.includes(qDigits)) {
      // Prefix on digits ranks higher than substring.
      if (corpus.digits.startsWith(qDigits)) return MATCH_PREFIX * FIELD_WEIGHT[field];
      return MATCH_SUBSTRING * FIELD_WEIGHT[field];
    }
  }
  // Postal-specific match: query "m5t1b3" finds "M5T 1B3".
  if (field === "postal" && corpus.postal && corpus.postal.length > 0) {
    const qPostal = postalNormalised(q);
    if (qPostal.length >= 3 && corpus.postal.includes(qPostal)) {
      if (corpus.postal === qPostal) return MATCH_EXACT * FIELD_WEIGHT[field];
      if (corpus.postal.startsWith(qPostal)) return MATCH_PREFIX * FIELD_WEIGHT[field];
      return MATCH_SUBSTRING * FIELD_WEIGHT[field];
    }
  }
  // General text matching.
  if (!v) return 0;
  if (v === q) return MATCH_EXACT * FIELD_WEIGHT[field];
  if (v.startsWith(q)) return MATCH_PREFIX * FIELD_WEIGHT[field];
  if (v.includes(q)) return MATCH_SUBSTRING * FIELD_WEIGHT[field];
  // Fuzzy match — only worth the cost for queries of 4+ chars; below that the
  // false-positive rate is too high. We check distance against the field's
  // best word, not the entire corpus, to keep the threshold meaningful.
  if (q.length >= 4) {
    const words = v.split(/\s+/);
    let bestDist = Infinity;
    for (const word of words) {
      if (word.length < 3) continue;
      const dist = damerauLevenshtein(q, word);
      if (dist < bestDist) bestDist = dist;
    }
    const threshold = q.length <= 5 ? 1 : 2;
    if (bestDist <= threshold) return MATCH_FUZZY * FIELD_WEIGHT[field];
  }
  return 0;
}

const ALL_FIELDS: Array<Exclude<SearchField, "any">> = [
  "name",
  "phone",
  "email",
  "postal",
  "band",
  "channel",
  "matter",
  "ref",
  "text",
];

/**
 * Score one token against the row. For unqualified ("any") tokens we score
 * across every field and take the best. For qualified tokens we score only
 * the named field. Returns 0 when nothing matched.
 */
function scoreToken(row: SearchableQueueRow, token: SearchToken): number {
  if (token.field === "any") {
    let best = 0;
    for (const field of ALL_FIELDS) {
      const corpus = corpusFor(row, field);
      const s = scoreFieldMatch(token.value, corpus, field);
      if (s > best) best = s;
    }
    return best;
  }
  const corpus = corpusFor(row, token.field);
  return scoreFieldMatch(token.value, corpus, token.field);
}

/**
 * Score a row against the full token set. Multi-token semantics:
 *
 *   • Positive tokens (default): the row must match each one. Score adds up
 *     across all positive tokens — more matches + stronger matches → higher
 *     score → higher rank.
 *   • Negated tokens (`-field:value` or `-value`): the row must NOT match.
 *     If any negated token DOES match, the row is excluded.
 *
 * Returns matched=false when any positive token fails to match OR any
 * negated token matches.
 */
function scoreRow(row: SearchableQueueRow, tokens: SearchToken[]): { score: number; matched: boolean; tokenHits: string[] } {
  if (tokens.length === 0) return { score: 0, matched: true, tokenHits: [] };
  let total = 0;
  const hits: string[] = [];
  for (const token of tokens) {
    const s = scoreToken(row, token);
    if (token.negated) {
      // Negated token: matching is a failure.
      if (s > 0) return { score: 0, matched: false, tokenHits: [] };
      continue;
    }
    if (s <= 0) return { score: 0, matched: false, tokenHits: [] };
    total += s;
    hits.push(token.value.toLowerCase());
  }
  return { score: total, matched: true, tokenHits: hits };
}

// ─── Filters ────────────────────────────────────────────────────────────

function rowPassesView(row: SearchableQueueRow, view: SavedView | null | undefined, now: Date): boolean {
  if (!view) return true;
  if (view.flag === "whale_nurture" && !row.whale_nurture) return false;
  if (view.withinHours !== undefined || view.olderThanHours !== undefined) {
    if (!row.submitted_at) return false;
    const submitted = new Date(row.submitted_at).getTime();
    if (Number.isNaN(submitted)) return false;
    const ageHours = (now.getTime() - submitted) / 3_600_000;
    if (view.withinHours !== undefined && ageHours > view.withinHours) return false;
    if (view.olderThanHours !== undefined && ageHours < view.olderThanHours) return false;
  }
  return true;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Search + filter + rank the queue. Returns `ScoredRow` entries in
 * relevance order when a query is present, or input order when not.
 *
 * The saved-view filter (if any) is merged with the bands/channels filters
 * additively: the view contributes its own bands/channels/flag/time-window
 * which the call-time bands/channels can further narrow.
 *
 * Pure — `now` is overridable for deterministic tests.
 */
export function searchAndRankQueue<T extends SearchableQueueRow>(
  rows: T[],
  options: SearchOptions,
): ScoredRow<T>[] {
  const tokens = tokenize(options.query);
  const now = options.now ?? new Date();

  // Resolve effective filters. The view contributes its own bands/channels
  // on top of any user-clicked bands/channels chips. We intersect rather
  // than replace, so a user can click "Top priority" view and additionally
  // narrow to Band A only.
  const viewBands = options.view?.bands ?? [];
  const viewChannels = options.view?.channels ?? [];
  const effectiveBands = viewBands.length > 0
    ? (options.bands.length > 0
        ? options.bands.filter((b) => viewBands.includes(b))
        : [...viewBands])
    : options.bands;
  const effectiveChannels = viewChannels.length > 0
    ? (options.channels.length > 0
        ? options.channels.filter((c) => viewChannels.includes(c))
        : [...viewChannels])
    : options.channels;

  const bandSet = effectiveBands.length > 0 ? new Set(effectiveBands) : null;
  const channelSet = effectiveChannels.length > 0 ? new Set(effectiveChannels) : null;

  // Apply view query on top of explicit query if the view supplies one. We
  // concatenate: explicit query first, then view query. This lets the user
  // type free-text on top of a preset (e.g. selecting "Voice" and typing
  // "patel" finds voice leads named Patel).
  const effectiveTokens = options.view?.query
    ? [...tokens, ...tokenize(options.view.query)]
    : tokens;

  const scored: ScoredRow<T>[] = [];
  for (const row of rows) {
    if (bandSet && (!row.band || !bandSet.has(row.band))) continue;
    if (channelSet) {
      const ch = row.slot_answers?.channel ?? null;
      if (!ch || !channelSet.has(ch)) continue;
    }
    if (!rowPassesView(row, options.view ?? null, now)) continue;

    const { score, matched, tokenHits } = scoreRow(row, effectiveTokens);
    if (!matched) continue;
    scored.push({ row, score, highlights: tokenHits });
  }

  // Sort by score desc when there's any query. Empty query preserves input
  // order so the page's band-then-deadline sort wins.
  if (effectiveTokens.length > 0) {
    scored.sort((a, b) => b.score - a.score);
  }
  return scored;
}

// ─── Highlighting ───────────────────────────────────────────────────────

/**
 * Wrap any case-insensitive occurrence of a token in `<mark>`. Returns a
 * React-renderable array of strings and `{mark: string}` markers. The
 * renderer (card component) maps these to JSX. Pure — no DOM dependency.
 *
 * We sort tokens by length desc so longer matches win over shorter prefixes
 * when both could match at the same position (e.g. "patel" wins over "p").
 *
 *   highlightText("Sarah Patel", ["patel"]) →
 *     [{text: "Sarah "}, {mark: "Patel"}]
 */
export interface HighlightSegment {
  text?: string;
  mark?: string;
}

export function highlightText(value: string, tokens: string[]): HighlightSegment[] {
  if (!value) return [];
  const filtered = tokens.filter((t) => t.length > 0).sort((a, b) => b.length - a.length);
  if (filtered.length === 0) return [{ text: value }];

  // Find all non-overlapping match ranges across all tokens. Greedy left-to-
  // right scan, longest-first so a longer token wins ties.
  const ranges: Array<{ start: number; end: number }> = [];
  const lower = value.toLowerCase();
  for (const token of filtered) {
    let from = 0;
    while (from < lower.length) {
      const idx = lower.indexOf(token, from);
      if (idx === -1) break;
      const end = idx + token.length;
      // Skip if this overlaps an existing range.
      const overlaps = ranges.some((r) => idx < r.end && end > r.start);
      if (!overlaps) ranges.push({ start: idx, end });
      from = end;
    }
  }
  if (ranges.length === 0) return [{ text: value }];
  ranges.sort((a, b) => a.start - b.start);

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) segments.push({ text: value.slice(cursor, r.start) });
    segments.push({ mark: value.slice(r.start, r.end) });
    cursor = r.end;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor) });
  return segments;
}
