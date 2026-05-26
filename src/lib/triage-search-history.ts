/**
 * Per-firm search-history persistence (localStorage).
 *
 * Stores the last few queries the operator ran. Surfaces as a dropdown
 * below the search field when the input is focused and empty. Quick
 * one-click reapply for the searches they actually run more than once
 * ("patel", "whatsapp Z3A", "channel:voice").
 *
 * Storage key is keyed by firm to keep one operator's view of one firm
 * separate from another firm's recent queries (an operator may sit on
 * multiple firms).
 *
 * SSR-safe: every function checks for `localStorage` existence before
 * touching it. Returns empty array / no-op on the server.
 */

const MAX_ENTRIES = 8;
const MIN_LENGTH = 2;
const STORAGE_PREFIX = "caseload-triage-search-history:";

function keyFor(firmId: string): string {
  return `${STORAGE_PREFIX}${firmId}`;
}

function readStorage(): Storage | null {
  if (typeof globalThis === "undefined") return null;
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

export function loadSearchHistory(firmId: string): string[] {
  const ls = readStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(keyFor(firmId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length >= MIN_LENGTH).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Push a query onto the history. De-duplicates case-insensitively (so
 * "Patel" and "patel" don't both land), bumps the existing entry to the
 * head, caps the list at MAX_ENTRIES. Returns the resulting history list.
 */
export function pushSearchHistory(firmId: string, query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length < MIN_LENGTH) return loadSearchHistory(firmId);
  const ls = readStorage();
  if (!ls) return [];
  try {
    const current = loadSearchHistory(firmId);
    const filtered = current.filter((q) => q.toLowerCase() !== trimmed.toLowerCase());
    const next = [trimmed, ...filtered].slice(0, MAX_ENTRIES);
    ls.setItem(keyFor(firmId), JSON.stringify(next));
    return next;
  } catch {
    return loadSearchHistory(firmId);
  }
}

export function removeSearchHistoryEntry(firmId: string, query: string): string[] {
  const ls = readStorage();
  if (!ls) return [];
  try {
    const current = loadSearchHistory(firmId);
    const filtered = current.filter((q) => q !== query);
    ls.setItem(keyFor(firmId), JSON.stringify(filtered));
    return filtered;
  } catch {
    return loadSearchHistory(firmId);
  }
}

export function clearSearchHistory(firmId: string): void {
  const ls = readStorage();
  if (!ls) return;
  try {
    ls.removeItem(keyFor(firmId));
  } catch {
    /* swallow */
  }
}
