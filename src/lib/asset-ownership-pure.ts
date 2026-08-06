/**
 * Pure logic for the firm asset ownership register (DR-111). No I/O here;
 * src/lib/asset-ownership.ts wraps these with supabaseAdmin reads/writes.
 */

import { ASSET_OWNERSHIP_CATALOGUE, type AssetCatalogueEntry } from "./asset-ownership-catalogue";

export type OwnershipStatus =
  | "firm_controlled"
  | "shared_access"
  | "provider_controlled"
  | "unknown";

export type ReviewPhase = "onboarding" | "offboarding";

export const OWNERSHIP_STATUSES: OwnershipStatus[] = [
  "firm_controlled",
  "shared_access",
  "provider_controlled",
  "unknown",
];

export const STATUS_LABELS: Record<OwnershipStatus, string> = {
  firm_controlled: "Firm controlled",
  shared_access: "Shared access",
  provider_controlled: "Provider controlled",
  unknown: "Unknown or missing",
};

export interface AssetOwnershipRow {
  id: string;
  firm_id: string;
  review_phase: ReviewPhase;
  asset_key: string;
  category: string;
  status: OwnershipStatus;
  account_holder: string | null;
  account_email: string | null;
  billing_owner: string | null;
  firm_has_admin: boolean | null;
  evidence_url: string | null;
  evidence_note: string | null;
  action: string | null;
  action_done: boolean;
  notes: string | null;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NewAssetOwnershipRow = Pick<
  AssetOwnershipRow,
  "firm_id" | "review_phase" | "asset_key" | "category"
> & { status: "unknown" };

/**
 * True when a row needs operator attention: any status other than firm
 * controlled, and the action has not already been marked done.
 */
export function needsAction(row: Pick<AssetOwnershipRow, "status" | "action_done">): boolean {
  return row.status !== "firm_controlled" && !row.action_done;
}

/**
 * Priority order for the transfer list. A vendor holding a material asset
 * is the most urgent risk; an unverified asset is next (it might BE
 * provider controlled and nobody has checked); shared access is lowest,
 * since the firm already has a working path in.
 */
const TRANSFER_PRIORITY: Record<OwnershipStatus, number> = {
  provider_controlled: 0,
  unknown: 1,
  shared_access: 2,
  firm_controlled: 3,
};

/**
 * The prioritized transfer/repair list: every open (not done) row that is
 * not firm controlled, ordered by risk.
 */
export function buildTransferList(rows: AssetOwnershipRow[]): AssetOwnershipRow[] {
  return rows
    .filter(needsAction)
    .slice()
    .sort((a, b) => TRANSFER_PRIORITY[a.status] - TRANSFER_PRIORITY[b.status]);
}

/**
 * Catalogue entries not yet present as a row for this firm and phase,
 * ready to insert. Idempotent: re-seeding never duplicates or resets an
 * existing row (the caller passes the asset_keys that already exist).
 */
export function seedRowsForFirm(
  firmId: string,
  reviewPhase: ReviewPhase,
  existingAssetKeys: ReadonlySet<string>,
  catalogue: AssetCatalogueEntry[] = ASSET_OWNERSHIP_CATALOGUE,
): NewAssetOwnershipRow[] {
  return catalogue
    .filter((entry) => !existingAssetKeys.has(entry.key))
    .map((entry) => ({
      firm_id: firmId,
      review_phase: reviewPhase,
      asset_key: entry.key,
      category: entry.category,
      status: "unknown" as const,
    }));
}

/**
 * Rows grouped by category, in catalogue category order, for rendering.
 * Rows the catalogue no longer lists (a retired asset key) sort last under
 * an "Other" bucket rather than being dropped, so historical data is never
 * silently hidden.
 */
export function groupRowsByCategory(
  rows: AssetOwnershipRow[],
  categoryOrder: string[],
): Array<{ category: string; rows: AssetOwnershipRow[] }> {
  const byCategory = new Map<string, AssetOwnershipRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }
  const known = categoryOrder.filter((c) => byCategory.has(c));
  const unknown = [...byCategory.keys()].filter((c) => !categoryOrder.includes(c));
  return [...known, ...unknown].map((category) => ({
    category,
    rows: byCategory.get(category) ?? [],
  }));
}
