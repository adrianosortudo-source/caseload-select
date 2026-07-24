/**
 * CR-13: pure view-model assembly for the Weekly Package Control Room's
 * Overview tab (Section 9 of the build spec). Kept separate from any data
 * loader or React component so it's testable without a database, a
 * request, or a browser -- exactly like publication-packet.ts's own
 * assemble* functions in this codebase.
 *
 * Asset "readiness" is judged by status alone, never by is_selected alone:
 * a selected candidate that hasn't cleared hash verification is not ready,
 * matching this build's repeated point that visual selection is a weaker
 * claim than release-readiness.
 */
import type { PackageManifest, PackageManifestPiece } from "@/lib/publishing-package-control-room-manifest";
import { targetsFilesHub } from "@/lib/publishing-package-control-room-manifest";

export type AssetStatus =
  | "required" | "missing" | "candidate" | "visually_selected" | "hash_verified"
  | "uploaded" | "bound" | "rendered_verified" | "release_ready" | "blocked"
  | "rejected" | "superseded" | "not_planned";

export interface OverviewAssetRef {
  id: string;
  status: AssetStatus;
  filename: string;
}

/** Ready statuses, in the sense the Overview matrix cares about: the asset has cleared enough of the pipeline to no longer be a plain gap. Matches everything from hash_verified onward except the terminal negative states. */
const READY_ASSET_STATUSES: ReadonlySet<AssetStatus> = new Set([
  "hash_verified", "uploaded", "bound", "rendered_verified", "release_ready",
]);

/** Statuses that actively block release, distinct from "just not done yet". */
const BLOCKING_ASSET_STATUSES: ReadonlySet<AssetStatus> = new Set(["blocked", "rejected"]);

/** Worse-first ordering for picking one representative status across a piece's several required assets, so a matrix cell can show a single value. */
const ASSET_STATUS_SEVERITY: AssetStatus[] = [
  "blocked", "rejected", "missing", "required", "superseded",
  "candidate", "visually_selected", "hash_verified", "uploaded",
  "bound", "rendered_verified", "release_ready", "not_planned",
];

function worstAssetStatus(statuses: AssetStatus[]): AssetStatus {
  if (statuses.length === 0) return "missing";
  // ASSET_STATUS_SEVERITY is ordered most-severe-first, so the WORST status
  // among several is whichever has the SMALLEST index -- not the largest.
  let worst: AssetStatus = statuses[0];
  let worstIndex = ASSET_STATUS_SEVERITY.indexOf(worst);
  for (const s of statuses) {
    const idx = ASSET_STATUS_SEVERITY.indexOf(s);
    if (idx !== -1 && idx < worstIndex) {
      worstIndex = idx;
      worst = s;
    }
  }
  return worst;
}

export interface OverviewRow {
  contentSlotId: string;
  pieceTitle: string;
  format: string;
  locale: string;
  destination: string;
  sourceVersionId: string | null;
  contentStatus: string; // piece.approvalStatus, shown as-is -- Section 9 "Content status"
  requiredAssetSummary: string; // e.g. "website_article_hero (+2 more)"
  actualAssetSummary: string; // selected filename(s), or "missing"
  assetStatus: AssetStatus; // worst status across this piece's required assets
  ctaPdfStatus: "not_applicable" | "ok" | "missing" | "files_hub_blocked" | "wrong_behavior";
  approvalState: string; // alias of contentStatus, kept distinct since Section 9 lists them as separate columns
  placement: string;
  releaseBlockers: string[];
  deliverableId: string | null;
}

export interface OverviewHeader {
  expectedPieceCount: number;
  actualPieceCount: number;
  contentReadyCount: number;
  assetReadyCount: number;
  blockedCount: number;
  approvalCount: number;
  releaseReadyCount: number;
  packageStatus: string;
}

export interface OverviewProgress {
  content: { done: number; total: number };
  assets: { done: number; total: number };
  localization: { done: number; total: number };
  review: { done: number; total: number };
  release: { done: number; total: number };
}

export interface OverviewViewModel {
  header: OverviewHeader;
  progress: OverviewProgress;
  rows: OverviewRow[];
}

/** Section 15/16-consistent CTA/PDF status for one piece, reusing the same Files-hub check the manifest validator itself uses so the two surfaces can never disagree about what counts as a blocker. */
function ctaPdfStatusForPiece(piece: PackageManifestPiece): OverviewRow["ctaPdfStatus"] {
  if (!piece.cta.required) return "not_applicable";
  if (!piece.cta.target) return "missing";
  if (targetsFilesHub(piece.cta.target)) return "files_hub_blocked";
  const isLeadMagnet = piece.formatFamily === "lead_magnet_document" || piece.formatFamily === "lead_magnet_landing_page";
  if (isLeadMagnet && piece.cta.behavior !== "download") return "wrong_behavior";
  return "ok";
}

function releaseBlockersForPiece(piece: PackageManifestPiece, assetsById: Map<string, OverviewAssetRef>): string[] {
  const blockers: string[] = [];

  if (piece.approvalStatus !== "approved") {
    blockers.push(`content not approved (status: ${piece.approvalStatus})`);
  }

  for (const req of piece.requiredAssets) {
    if (!req.selectedAssetId) {
      blockers.push(`missing required asset: ${req.assetRole} (${req.locale}/${req.destination})`);
      continue;
    }
    const asset = assetsById.get(req.selectedAssetId);
    if (!asset) {
      blockers.push(`selected asset not found: ${req.assetRole} (${req.selectedAssetId})`);
      continue;
    }
    if (BLOCKING_ASSET_STATUSES.has(asset.status)) {
      blockers.push(`asset ${asset.status}: ${req.assetRole}`);
    } else if (!READY_ASSET_STATUSES.has(asset.status)) {
      blockers.push(`asset not yet release-ready (status: ${asset.status}): ${req.assetRole}`);
    }
  }

  const ctaStatus = ctaPdfStatusForPiece(piece);
  if (ctaStatus === "files_hub_blocked") blockers.push("CTA points at the Files hub");
  if (ctaStatus === "wrong_behavior") blockers.push("lead-magnet CTA behavior is not \"download\"");
  if (ctaStatus === "missing") blockers.push("required CTA has no target");

  return blockers;
}

function rowForPiece(piece: PackageManifestPiece, assetsById: Map<string, OverviewAssetRef>): OverviewRow {
  const statuses = piece.requiredAssets.map((req) => {
    if (!req.selectedAssetId) return "missing" as AssetStatus;
    return assetsById.get(req.selectedAssetId)?.status ?? "missing";
  });
  const selectedFilenames = piece.requiredAssets
    .map((req) => (req.selectedAssetId ? assetsById.get(req.selectedAssetId)?.filename : null))
    .filter((f): f is string => !!f);

  const roleNames = piece.requiredAssets.map((r) => r.assetRole);
  const requiredAssetSummary = roleNames.length <= 1
    ? (roleNames[0] ?? "none")
    : `${roleNames[0]} (+${roleNames.length - 1} more)`;

  return {
    contentSlotId: piece.contentSlotId,
    pieceTitle: piece.readerTitle,
    format: piece.formatFamily,
    locale: piece.locale,
    destination: piece.destination,
    sourceVersionId: piece.sourceVersionId,
    contentStatus: piece.approvalStatus,
    requiredAssetSummary,
    actualAssetSummary: selectedFilenames.length > 0 ? selectedFilenames.join(", ") : "missing",
    assetStatus: worstAssetStatus(statuses),
    ctaPdfStatus: ctaPdfStatusForPiece(piece),
    approvalState: piece.approvalStatus,
    placement: piece.placementStatus,
    releaseBlockers: releaseBlockersForPiece(piece, assetsById),
    deliverableId: piece.deliverableId,
  };
}

export function assembleOverviewViewModel(
  manifest: PackageManifest,
  packageStatus: string,
  assets: OverviewAssetRef[],
): OverviewViewModel {
  const assetsById = new Map(assets.map((a) => [a.id, a]));
  const rows = manifest.pieces.map((p) => rowForPiece(p, assetsById));

  const contentReadyCount = rows.filter((r) => r.contentStatus === "approved").length;
  const assetReadyCount = rows.filter((r) => READY_ASSET_STATUSES.has(r.assetStatus)).length;
  const blockedCount = rows.filter((r) => r.releaseBlockers.length > 0).length;
  const approvalCount = rows.filter((r) => r.approvalState === "approved").length;
  const releaseReadyCount = rows.filter((r) => r.releaseBlockers.length === 0).length;

  const localizationReady = (locale: "en-CA" | "pt-BR") => {
    const localeRows = rows.filter((r) => r.locale === locale);
    const ready = localeRows.filter((r) => READY_ASSET_STATUSES.has(r.assetStatus) && r.contentStatus === "approved").length;
    return { done: ready, total: localeRows.length };
  };
  const en = localizationReady("en-CA");
  const pt = localizationReady("pt-BR");

  return {
    header: {
      expectedPieceCount: manifest.expectedPieceCount,
      actualPieceCount: manifest.pieces.length,
      contentReadyCount,
      assetReadyCount,
      blockedCount,
      approvalCount,
      releaseReadyCount,
      packageStatus,
    },
    progress: {
      content: { done: contentReadyCount, total: rows.length },
      assets: { done: assetReadyCount, total: rows.length },
      localization: { done: en.done + pt.done, total: en.total + pt.total },
      review: { done: approvalCount, total: rows.length },
      release: { done: releaseReadyCount, total: rows.length },
    },
    rows,
  };
}
