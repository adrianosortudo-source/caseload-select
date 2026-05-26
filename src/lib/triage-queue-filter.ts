/**
 * Pure filter for the lawyer triage queue.
 *
 * Powers the search field + band + channel chips on /portal/[firmId]/triage.
 * The page server-renders the full set of rows; the client component filters
 * in-memory on every keystroke. Splitting the filter out as a pure function
 * keeps it unit-testable and isolates the search-field semantics (digits-only
 * phone match, whitespace-stripped postal, lower-cased substring, etc.).
 *
 * Search target fields (lower-cased substring match):
 *   • contact_name
 *   • contact_phone     (digits-only normalised — "(647) 555 9999" indexed as "6475559999")
 *   • contact_email
 *   • contact_postal_code   (whitespace stripped — "M5T 1B3" indexed as "M5T1B3")
 *   • lead_id           (the L-2026-05-26-XYZ short code)
 *   • matter_type label (the display string, not the enum)
 *
 * The lawyer types what they remember. One field, multi-target match. No
 * special syntax. Empty query returns the input array unchanged.
 */

import { matterLabel } from "./screened-leads-labels";

export interface FilterableQueueRow {
  lead_id: string;
  band: "A" | "B" | "C" | "D" | null;
  matter_type: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_postal_code: string | null;
  slot_answers: { channel?: string } | null;
}

export interface QueueFilters {
  /** Free-text search across NAP + lead ref + matter type. Empty string = no filter. */
  query: string;
  /** Selected bands. Empty array = all bands. */
  bands: Array<"A" | "B" | "C" | "D">;
  /** Selected channels. Empty array = all channels. */
  channels: string[];
}

/** Normalise a phone number for substring search: strip everything that is not a digit. */
function digitsOnly(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D+/g, "");
}

/** Normalise a postal code for substring search: strip whitespace and upper-case. */
function postalNormalised(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, "").toUpperCase();
}

/**
 * Build the lower-cased search corpus for one row. The corpus is the string
 * we run `corpus.includes(query.toLowerCase())` against. We also build a
 * digits-only fragment so a query like "6475559999" hits a row whose phone is
 * stored as "(647) 555-9999".
 */
function buildSearchCorpus(row: FilterableQueueRow): { textCorpus: string; digitCorpus: string; postalCorpus: string } {
  const textParts: string[] = [];
  if (row.contact_name) textParts.push(row.contact_name);
  if (row.contact_email) textParts.push(row.contact_email);
  if (row.contact_postal_code) textParts.push(row.contact_postal_code);
  textParts.push(row.lead_id);
  textParts.push(matterLabel(row.matter_type));
  return {
    textCorpus: textParts.join(" ").toLowerCase(),
    digitCorpus: digitsOnly(row.contact_phone),
    postalCorpus: postalNormalised(row.contact_postal_code),
  };
}

/**
 * Decide whether a row matches the search query. Returns true on empty query.
 * Handles three flavours of match transparently:
 *   1. Text substring against name + email + postal + lead_id + matter label
 *   2. Digits-only phone match (the query is digits-stripped before matching)
 *   3. Postal substring with whitespace stripped on both sides
 */
export function rowMatchesQuery(row: FilterableQueueRow, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  const qDigits = digitsOnly(query);
  const qPostal = postalNormalised(query);
  const { textCorpus, digitCorpus, postalCorpus } = buildSearchCorpus(row);
  if (textCorpus.includes(q)) return true;
  if (qDigits.length >= 3 && digitCorpus.length > 0 && digitCorpus.includes(qDigits)) return true;
  if (qPostal.length >= 3 && postalCorpus.length > 0 && postalCorpus.includes(qPostal)) return true;
  return false;
}

/**
 * Apply the full filter set (query + bands + channels) to a list of rows.
 * Pure — returns a new array, never mutates input.
 */
export function applyQueueFilters<T extends FilterableQueueRow>(rows: T[], filters: QueueFilters): T[] {
  const { query, bands, channels } = filters;
  const bandSet = bands.length > 0 ? new Set(bands) : null;
  const channelSet = channels.length > 0 ? new Set(channels) : null;
  return rows.filter((row) => {
    if (bandSet && (!row.band || !bandSet.has(row.band))) return false;
    if (channelSet) {
      const channel = row.slot_answers?.channel ?? null;
      if (!channel || !channelSet.has(channel)) return false;
    }
    if (!rowMatchesQuery(row, query)) return false;
    return true;
  });
}

/**
 * Band + channel chip counts computed from the full queue (not the filtered
 * subset). The operator wants to see workload, not how each chip narrows
 * the current search. Returns per-band counts and per-channel counts.
 */
export function buildChipCounts<T extends FilterableQueueRow>(rows: T[]): {
  bandCounts: Record<"A" | "B" | "C" | "D", number>;
  channelCounts: Record<string, number>;
} {
  const bandCounts: Record<"A" | "B" | "C" | "D", number> = { A: 0, B: 0, C: 0, D: 0 };
  const channelCounts: Record<string, number> = {};
  for (const row of rows) {
    if (row.band && bandCounts[row.band] !== undefined) bandCounts[row.band] += 1;
    const channel = row.slot_answers?.channel;
    if (channel) channelCounts[channel] = (channelCounts[channel] ?? 0) + 1;
  }
  return { bandCounts, channelCounts };
}
