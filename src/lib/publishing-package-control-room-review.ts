/**
 * CR-19/20: Review tab view-model split (Section 14). One function builds
 * both the operator and the lawyer/client payloads from the same source
 * data, so there is exactly one place that decides what a lawyer is and
 * isn't shown -- not two independently-maintained rendering paths that can
 * drift apart.
 *
 * Lawyer payload strips: rejected candidates, superseded candidates,
 * storage keys, asset ids, sha256 hashes, and release-blocker detail
 * strings (those can themselves leak internal ids/paths). Lawyer payload
 * keeps: reader title, the selected visual's filename only, destination
 * label, locale, source content status, existing approval/release status.
 */
import type { OverviewViewModel } from "@/lib/publishing-package-control-room-overview";
import type { ControlRoomAssetDetail } from "@/lib/publishing-package-control-room-assets";
import type { AssetStatus } from "@/lib/publishing-package-control-room-overview";

export interface ReviewAssetRef {
  filename: string;
  status: AssetStatus;
  isSelected: boolean;
  /** Present only in the operator payload. */
  assetId?: string;
  sha256?: string;
  storageKey?: string | null;
}

export interface ReviewPieceView {
  contentSlotId: string;
  pieceTitle: string;
  locale: string;
  destination: string;
  sourceContentStatus: string;
  approvalState: string;
  placementStatus: string;
  selectedAsset: ReviewAssetRef | null;
  /** Operator: every registered candidate including rejected/superseded. Lawyer: always empty -- only selectedAsset is shown. */
  candidates: ReviewAssetRef[];
  /** Operator: the exact release blockers from the Overview computation. Lawyer: always empty -- those strings can embed asset ids. */
  releaseBlockers: string[];
}

export interface ReviewPackageView {
  viewerRole: "operator" | "lawyer";
  pieces: ReviewPieceView[];
}

function toReviewAssetRef(
  asset: ControlRoomAssetDetail,
  role: "operator" | "lawyer",
): ReviewAssetRef {
  const base: ReviewAssetRef = { filename: asset.filename, status: asset.status, isSelected: asset.is_selected };
  if (role === "operator") {
    base.assetId = asset.id;
    base.sha256 = asset.sha256;
    base.storageKey = null; // storage_key is not loaded into ControlRoomAssetDetail today; reserved field, never fabricated.
  }
  return base;
}

export function filterPackageForViewer(
  overviewViewModel: OverviewViewModel,
  assets: ControlRoomAssetDetail[],
  role: "operator" | "lawyer",
): ReviewPackageView {
  const assetsBySlot = new Map<string, ControlRoomAssetDetail[]>();
  for (const a of assets) {
    const list = assetsBySlot.get(a.content_slot_id) ?? [];
    list.push(a);
    assetsBySlot.set(a.content_slot_id, list);
  }

  const pieces: ReviewPieceView[] = overviewViewModel.rows.map((row) => {
    const slotAssets = assetsBySlot.get(row.contentSlotId) ?? [];
    const selected = slotAssets.find((a) => a.is_selected) ?? null;

    if (role === "lawyer") {
      return {
        contentSlotId: row.contentSlotId,
        pieceTitle: row.pieceTitle,
        locale: row.locale,
        destination: row.destination,
        sourceContentStatus: row.contentStatus,
        approvalState: row.approvalState,
        placementStatus: row.placement,
        selectedAsset: selected ? toReviewAssetRef(selected, "lawyer") : null,
        candidates: [],
        releaseBlockers: [],
      };
    }

    // slotAssets is already scoped to this content_slot_id by assetsBySlot above --
    // every registered candidate across all of this piece's required roles.
    const operatorCandidates = slotAssets.map((a) => toReviewAssetRef(a, "operator"));

    return {
      contentSlotId: row.contentSlotId,
      pieceTitle: row.pieceTitle,
      locale: row.locale,
      destination: row.destination,
      sourceContentStatus: row.contentStatus,
      approvalState: row.approvalState,
      placementStatus: row.placement,
      selectedAsset: selected ? toReviewAssetRef(selected, "operator") : null,
      candidates: operatorCandidates,
      releaseBlockers: row.releaseBlockers,
    };
  });

  return { viewerRole: role, pieces };
}
