/**
 * Pure helpers for operator lead management (archive + delete).
 */

export type LeadStatus = "triaging" | "taken" | "passed" | "referred" | "declined";

// A taken lead has a client_matters row pointing back at it
// (source_screened_lead_id). Deleting it would sever that provenance link, so
// taken leads can be archived but never hard-deleted.
export const PROTECTED_DELETE_STATUSES: ReadonlyArray<string> = ["taken"];

export function isDeletableStatus(status: string | null | undefined): boolean {
  if (!status) return true;
  return !PROTECTED_DELETE_STATUSES.includes(status);
}

// Statuses the bulk "archive finalised older than N days" sweep touches. It
// never archives triaging (still in the queue) or taken (active client work).
export const ARCHIVABLE_HISTORY_STATUSES: ReadonlyArray<string> = [
  "passed",
  "referred",
  "declined",
];

export const MAX_OLDER_THAN_DAYS = 3650; // ~10 years; an upper sanity bound

export function isValidOlderThanDays(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX_OLDER_THAN_DAYS;
}

/**
 * ISO cutoff for a bulk sweep: rows created strictly before this instant are
 * in scope. `now` is injected so this stays pure and testable.
 */
export function olderThanCutoffIso(days: number, now: number): string {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}
