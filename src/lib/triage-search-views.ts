/**
 * Per-firm user-defined saved views (localStorage).
 *
 * The operator builds up a set of frequently-used filter bundles ("Patel
 * pending intake", "Voice in last 24h", "WhatsApp Band A"). Storing
 * them as user-defined views means they're one click away in the views
 * row, alongside the system presets (Top priority, Whales, Voice, Stale).
 *
 * V1 captures: query string + bands + channels. System presets remain the
 * way to express flag-based filters (whale_nurture) and time-window
 * filters (within/older-than hours) because those require richer UI to
 * construct.
 *
 * SSR-safe: localStorage access is guarded everywhere.
 */

const MAX_VIEWS = 12;
const STORAGE_PREFIX = "caseload-triage-user-views:";

export interface UserSavedView {
  id: string;
  label: string;
  query: string;
  bands: Array<"A" | "B" | "C" | "D">;
  channels: string[];
  createdAt: string;
}

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

function isUserSavedView(v: unknown): v is UserSavedView {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.label === "string" &&
    typeof obj.query === "string" &&
    Array.isArray(obj.bands) &&
    Array.isArray(obj.channels) &&
    typeof obj.createdAt === "string"
  );
}

export function loadUserViews(firmId: string): UserSavedView[] {
  const ls = readStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(keyFor(firmId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isUserSavedView).slice(0, MAX_VIEWS);
  } catch {
    return [];
  }
}

/**
 * Save (or replace) a user view. Replace semantics: if a view with the
 * same label already exists (case-insensitive), it's overwritten — this
 * lets the operator iterate on a view without accumulating duplicates.
 *
 * Returns the resulting array of views.
 */
export function saveUserView(
  firmId: string,
  draft: Omit<UserSavedView, "id" | "createdAt">,
): UserSavedView[] {
  const ls = readStorage();
  if (!ls) return [];
  if (!draft.label.trim()) return loadUserViews(firmId);
  try {
    const current = loadUserViews(firmId);
    const filtered = current.filter((v) => v.label.toLowerCase() !== draft.label.trim().toLowerCase());
    const next: UserSavedView = {
      ...draft,
      label: draft.label.trim(),
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    const updated = [next, ...filtered].slice(0, MAX_VIEWS);
    ls.setItem(keyFor(firmId), JSON.stringify(updated));
    return updated;
  } catch {
    return loadUserViews(firmId);
  }
}

export function deleteUserView(firmId: string, id: string): UserSavedView[] {
  const ls = readStorage();
  if (!ls) return [];
  try {
    const current = loadUserViews(firmId);
    const filtered = current.filter((v) => v.id !== id);
    ls.setItem(keyFor(firmId), JSON.stringify(filtered));
    return filtered;
  } catch {
    return loadUserViews(firmId);
  }
}

export function clearUserViews(firmId: string): void {
  const ls = readStorage();
  if (!ls) return;
  try {
    ls.removeItem(keyFor(firmId));
  } catch {
    /* swallow */
  }
}

function generateId(): string {
  // Time-prefixed + 6 random base36 chars. Plenty for localStorage uniqueness.
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
