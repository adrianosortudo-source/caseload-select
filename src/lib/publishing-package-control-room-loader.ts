/**
 * I/O loader for the Weekly Package Control Room. Same thin-wrapper pattern
 * as this codebase's other period-scoped loaders (publication-preflight-
 * loader.ts, publication-packet-loader.ts): every real decision lives in
 * the pure modules (publishing-package-control-room-manifest.ts,
 * -overview.ts); this file only fetches rows and hands them off.
 *
 * The publishing_package_* tables are defined in an UNAPPLIED migration
 * (supabase/migrations/20260723120000_publishing_package_control_room.sql)
 * -- there is no environment in which they currently exist, local or
 * production. Any query error here (including "relation does not exist")
 * resolves to null, matching every other loader in this codebase that
 * treats a load failure as "nothing to show" rather than a crash -- this
 * loader must behave identically once the migration lands, with no code
 * change required.
 */
import "server-only";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import {
  validatePackageManifest,
  type PackageManifest,
} from "@/lib/publishing-package-control-room-manifest";
import type { ContentPeriod } from "@/lib/types";
import type { ControlRoomAssetDetail } from "@/lib/publishing-package-control-room-assets";
import type { PublicationInputs } from "@/lib/publishing-package-control-room-release";
import { getStandingAuthorizationState } from "@/lib/standing-publishing-authorization";
import { listCurrentReceiptsByPlacementForDeliverable } from "@/lib/publication-receipts";

const ASSET_SELECT_COLUMNS =
  "id, content_slot_id, asset_role, locale, destination, filename, mime_type, byte_size, width, height, sha256, alt_text, text_policy, overlay_language, status, is_selected";

export interface ControlRoomPackageResult {
  period: ContentPeriod;
  packageId: string;
  packageStatus: string;
  manifest: PackageManifest;
  /** Trusted as the DB's own CHECK-constrained enum columns, same as every other loader in this codebase trusting a constrained row's shape without a second runtime re-validation pass. */
  assets: ControlRoomAssetDetail[];
}

/**
 * Loads the latest manifest_revision package for one firm+period, plus its
 * assets, plus the period row itself. Returns null when the period doesn't
 * resolve for this firm, when no package manifest has been created yet for
 * it, when the stored manifest fails validation (a corrupt/tampered row
 * must never render as if it were a valid package), or on any query error.
 */
export async function loadControlRoomPackage(
  firmId: string,
  periodId: string,
): Promise<ControlRoomPackageResult | null> {
  const periodRes = await supabase
    .from("content_periods")
    .select("*")
    .eq("id", periodId)
    .eq("firm_id", firmId)
    .maybeSingle();
  if (periodRes.error || !periodRes.data) return null;
  const period = periodRes.data as ContentPeriod;

  const packageRes = await supabase
    .from("publishing_packages")
    .select("id, status, manifest")
    .eq("firm_id", firmId)
    .eq("period_id", periodId)
    .order("manifest_revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (packageRes.error || !packageRes.data) return null;

  const validated = validatePackageManifest(packageRes.data.manifest);
  if (!validated.ok) return null;

  const assetsRes = await supabase
    .from("publishing_package_assets")
    .select(ASSET_SELECT_COLUMNS)
    .eq("package_id", packageRes.data.id);
  if (assetsRes.error) return null;

  return {
    period,
    packageId: packageRes.data.id as string,
    packageStatus: packageRes.data.status as string,
    manifest: validated.manifest,
    assets: (assetsRes.data ?? []) as unknown as ControlRoomAssetDetail[],
  };
}

/**
 * Builds the Release gate's PublicationInputs the same way for every
 * caller (the real release route and the preflight-persistence mutation)
 * -- one implementation, not two independently-maintained copies.
 * standingAuthorizationActive comes from the real, existing
 * getStandingAuthorizationState(); approvedByDeliverableId/
 * receiptsByDeliverableId come from content_deliverables and
 * listCurrentReceiptsByPlacementForDeliverable (also real, existing --
 * never reimplemented here). individuallyApproved,
 * destinationIdentityConfirmed, and channelAuthenticated stay explicitly
 * false: no per-piece or firm-wide source for any of the three exists
 * anywhere in this codebase yet, so those checks fail closed rather than
 * guess.
 */
export async function loadPublicationInputs(
  firmId: string,
  deliverableIds: string[],
): Promise<PublicationInputs> {
  const approvedByDeliverableId: Record<string, boolean> = {};
  const receiptsByDeliverableId: Record<string, boolean> = {};

  const [authState] = await Promise.all([
    getStandingAuthorizationState(firmId),
    (async () => {
      if (deliverableIds.length === 0) return;
      const deliverablesRes = await supabase
        .from("content_deliverables")
        .select("id, status, approved_version_id")
        .in("id", deliverableIds);
      const rows = (deliverablesRes.data ?? []) as Array<{ id: string; status: string; approved_version_id: string | null }>;
      for (const row of rows) {
        approvedByDeliverableId[row.id] = row.status === "approved" && !!row.approved_version_id;
      }
      await Promise.all(
        rows.map(async (row) => {
          const receipts = await listCurrentReceiptsByPlacementForDeliverable(row.id, row.approved_version_id).catch(() => ({}));
          receiptsByDeliverableId[row.id] = Object.values(receipts).some((r) => r !== null);
        }),
      );
    })(),
  ]);

  return {
    standingAuthorizationActive: authState?.active ?? false,
    individuallyApproved: false,
    destinationIdentityConfirmed: false,
    channelAuthenticated: false,
    publicationReceiptRecorded: false,
    approvedByDeliverableId,
    receiptsByDeliverableId,
  };
}
