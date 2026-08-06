/**
 * CR-15: pure view-model assembly for the Weekly Package Control Room's
 * Assets tab (Section 11). Groups by content piece, then by required
 * destination role, exactly as specified. One AssetCard per (requirement x
 * candidate) pair, plus a synthetic "missing" card for any requirement with
 * zero registered candidates -- so "All" filtered to nothing still shows
 * every gap, not just registered rows.
 */
import type {
  PackageManifest,
  AssetRole,
  PackageLocale,
  TextPolicy,
  OverlayLanguage,
} from "@/lib/publishing-package-control-room-manifest";
import type { AssetStatus } from "@/lib/publishing-package-control-room-overview";

export interface ControlRoomAssetDetail {
  id: string;
  content_slot_id: string;
  asset_role: AssetRole;
  locale: PackageLocale;
  destination: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  sha256: string;
  alt_text: string;
  text_policy: TextPolicy;
  overlay_language: OverlayLanguage | null;
  status: AssetStatus;
  is_selected: boolean;
}

export interface AssetCard {
  kind: "requirement_gap" | "candidate";
  contentSlotId: string;
  pieceTitle: string;
  assetRole: AssetRole;
  locale: PackageLocale;
  destination: string;
  status: AssetStatus;
  isSelected: boolean;
  requiredWidth: number;
  requiredHeight: number;
  textPolicy: TextPolicy;
  overlayLanguage: OverlayLanguage | null;
  safeArea: string;
  requiredCopy: string | null;
  blockingReason: string | null;
  // Present only for kind === "candidate".
  assetId?: string;
  filename?: string;
  width?: number | null;
  height?: number | null;
  mimeType?: string;
  byteSize?: number;
  sha256?: string;
  altText?: string;
}

export interface AssetRoleGroup {
  assetRole: AssetRole;
  destination: string;
  cards: AssetCard[];
}

export interface AssetPieceGroup {
  contentSlotId: string;
  pieceTitle: string;
  roles: AssetRoleGroup[];
}

export interface AssetsViewModel {
  groups: AssetPieceGroup[];
  allCards: AssetCard[];
}

function blockingReasonFor(status: AssetStatus): string | null {
  if (status === "missing") return "no candidate registered for this requirement";
  if (status === "blocked") return "this candidate is blocked";
  if (status === "rejected") return "this candidate was rejected";
  if (status === "superseded") return "this candidate has been superseded";
  return null;
}

export function assembleAssetsViewModel(
  manifest: PackageManifest,
  assets: ControlRoomAssetDetail[],
): AssetsViewModel {
  const assetsBySlot = new Map<string, ControlRoomAssetDetail[]>();
  for (const a of assets) {
    const list = assetsBySlot.get(a.content_slot_id) ?? [];
    list.push(a);
    assetsBySlot.set(a.content_slot_id, list);
  }

  const groups: AssetPieceGroup[] = [];
  const allCards: AssetCard[] = [];

  for (const piece of manifest.pieces) {
    const slotAssets = assetsBySlot.get(piece.contentSlotId) ?? [];
    const roles: AssetRoleGroup[] = [];

    for (const req of piece.requiredAssets) {
      const candidates = slotAssets.filter(
        (a) => a.asset_role === req.assetRole && a.destination === req.destination,
      );

      const cards: AssetCard[] = candidates.map((c) => ({
        kind: "candidate",
        contentSlotId: piece.contentSlotId,
        pieceTitle: piece.readerTitle,
        assetRole: req.assetRole,
        locale: req.locale,
        destination: req.destination,
        status: c.status,
        isSelected: c.is_selected,
        requiredWidth: req.requiredWidth,
        requiredHeight: req.requiredHeight,
        textPolicy: req.textPolicy,
        overlayLanguage: req.overlayLanguage,
        safeArea: req.safeArea,
        requiredCopy: req.requiredCopy,
        blockingReason: blockingReasonFor(c.status),
        assetId: c.id,
        filename: c.filename,
        width: c.width,
        height: c.height,
        mimeType: c.mime_type,
        byteSize: c.byte_size,
        sha256: c.sha256,
        altText: c.alt_text,
      }));

      if (cards.length === 0) {
        cards.push({
          kind: "requirement_gap",
          contentSlotId: piece.contentSlotId,
          pieceTitle: piece.readerTitle,
          assetRole: req.assetRole,
          locale: req.locale,
          destination: req.destination,
          status: "missing",
          isSelected: false,
          requiredWidth: req.requiredWidth,
          requiredHeight: req.requiredHeight,
          textPolicy: req.textPolicy,
          overlayLanguage: req.overlayLanguage,
          safeArea: req.safeArea,
          requiredCopy: req.requiredCopy,
          blockingReason: blockingReasonFor("missing"),
        });
      }

      roles.push({ assetRole: req.assetRole, destination: req.destination, cards });
      allCards.push(...cards);
    }

    groups.push({ contentSlotId: piece.contentSlotId, pieceTitle: piece.readerTitle, roles });
  }

  return { groups, allCards };
}

export type AssetCardFilter =
  | "all" | "missing" | "candidate" | "selected" | "uploaded" | "bound"
  | "rendered_verified" | "blocked" | "superseded"
  | `locale:${PackageLocale}` | `destination:${string}` | `role:${string}`;

/**
 * "selected" matches AssetCard.isSelected regardless of the candidate's
 * current pipeline stage (a selected candidate can be anywhere from
 * visually_selected through release_ready and is still "the selected one").
 * Every other named filter matches AssetCard.status exactly. destination:/
 * role: are open-ended (any destination or role string the manifest uses),
 * matching Section 11's literal "Destination" / "Asset role" filter
 * controls rather than a fixed enum of buttons.
 */
export function filterAssetCards(cards: AssetCard[], filter: AssetCardFilter): AssetCard[] {
  if (filter === "all") return cards;
  if (filter === "selected") return cards.filter((c) => c.isSelected);
  if (filter.startsWith("locale:")) return cards.filter((c) => c.locale === filter.slice("locale:".length));
  if (filter.startsWith("destination:")) return cards.filter((c) => c.destination === filter.slice("destination:".length));
  if (filter.startsWith("role:")) return cards.filter((c) => c.assetRole === filter.slice("role:".length));
  return cards.filter((c) => c.status === filter);
}
