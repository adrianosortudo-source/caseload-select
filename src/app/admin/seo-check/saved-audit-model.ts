export const SAVED_AUDIT_LIST_COLUMNS =
  "id, domain, grade, overall_score, ai_search_score, scan_mode, pages_scanned, issue_count, created_at, methodologyVersion:result->>methodologyVersion";

export function parseSavedMethodologyVersion(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}