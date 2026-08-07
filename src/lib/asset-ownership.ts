/**
 * IO layer for the firm asset ownership register (DR-111). Service-role
 * only, called from operator-gated routes. No `server-only` import here
 * (see the app CLAUDE.md Developer Gotchas note on why an IO lib imported
 * by a tested route must not carry it).
 */

import { supabaseAdmin as supabase } from "./supabase-admin";
import { ASSET_OWNERSHIP_CATALOGUE } from "./asset-ownership-catalogue";
import {
  seedRowsForFirm,
  type AssetOwnershipRow,
  type ReviewPhase,
  type OwnershipStatus,
} from "./asset-ownership-pure";

const TABLE = "firm_asset_ownership";

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || /relation .* does not exist/i.test(error.message ?? "");
}

/**
 * Guarded read: returns an empty register if the migration has not landed
 * on this environment yet, so the admin page is safe to deploy ahead of it.
 */
export async function getOwnershipRegister(
  firmId: string,
  reviewPhase: ReviewPhase = "onboarding",
): Promise<AssetOwnershipRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("firm_id", firmId)
    .eq("review_phase", reviewPhase)
    .order("category", { ascending: true });

  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`getOwnershipRegister failed: ${error.message}`);
  }
  return (data ?? []) as AssetOwnershipRow[];
}

/**
 * Idempotent seed: inserts one row per catalogue entry not already present
 * for this firm and phase, then returns the full register. Re-running this
 * on an already-seeded firm is a no-op for existing rows (only new
 * catalogue entries added later would insert).
 */
export async function seedOwnershipRegister(
  firmId: string,
  reviewPhase: ReviewPhase = "onboarding",
): Promise<AssetOwnershipRow[]> {
  const existing = await getOwnershipRegister(firmId, reviewPhase);
  const existingKeys = new Set(existing.map((r) => r.asset_key));
  const toInsert = seedRowsForFirm(firmId, reviewPhase, existingKeys, ASSET_OWNERSHIP_CATALOGUE);

  if (toInsert.length > 0) {
    // onConflict matches the table's UNIQUE (firm_id, review_phase, asset_key);
    // ignoreDuplicates makes a concurrent double-seed harmless.
    const { error } = await supabase
      .from(TABLE)
      .upsert(toInsert, { onConflict: "firm_id,review_phase,asset_key", ignoreDuplicates: true });
    if (error && !isMissingTable(error)) {
      throw new Error(`seedOwnershipRegister insert failed: ${error.message}`);
    }
  }

  return getOwnershipRegister(firmId, reviewPhase);
}

export interface OwnershipRowPatch {
  status?: OwnershipStatus;
  account_holder?: string | null;
  account_email?: string | null;
  billing_owner?: string | null;
  firm_has_admin?: boolean | null;
  evidence_url?: string | null;
  evidence_note?: string | null;
  action?: string | null;
  action_done?: boolean;
  notes?: string | null;
}

/**
 * Updates one row, scoped to the firm (defense in depth: a row id from a
 * different firm never matches). Stamps last_reviewed_at whenever the
 * caller sets a status, so "last reviewed" always reflects the last time
 * someone actually looked at this asset, not just any field edit.
 */
export async function updateOwnershipRow(
  firmId: string,
  rowId: string,
  patch: OwnershipRowPatch,
): Promise<AssetOwnershipRow | null> {
  const update: OwnershipRowPatch & { last_reviewed_at?: string } = { ...patch };
  if (patch.status !== undefined) {
    update.last_reviewed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update(update)
    .eq("id", rowId)
    .eq("firm_id", firmId)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`updateOwnershipRow failed: ${error.message}`);
  }
  return (data ?? null) as AssetOwnershipRow | null;
}
