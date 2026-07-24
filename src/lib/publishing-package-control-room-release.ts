/**
 * CR-21: Release tab preflight gates (Section 15), read-only, no Publish
 * button anywhere in this build. Computed per piece so the Release tab can
 * show exactly which slot is blocked and why, matching the rest of this
 * build's per-piece reasoning.
 *
 * Publication-gate inputs (authorization, destination identity, channel
 * auth, receipt state) are NOT reimplemented here -- the real route is
 * expected to populate PublicationInputs from this codebase's existing
 * getStandingAuthorizationState() and loadPlanPublicationReadiness()
 * outputs and pass the result in. This module only expresses the release
 * logic that is genuinely specific to the weekly package manifest.
 */
import type { PackageManifest, PackageManifestPiece } from "@/lib/publishing-package-control-room-manifest";
import { FORMAT_FAMILIES_REQUIRING_SOURCE_VERSION, PACKAGE_LOCALES } from "@/lib/publishing-package-control-room-manifest";
import type { OverviewViewModel, OverviewRow, AssetStatus } from "@/lib/publishing-package-control-room-overview";

export interface ReleaseCheck {
  checkKey: string;
  status: "pass" | "fail";
  reasonCode: string | null;
  message: string;
}

export type ReleaseGateName = "editorial" | "asset" | "experience" | "publication";

export interface ReleaseGate {
  gate: ReleaseGateName;
  checks: ReleaseCheck[];
  allPass: boolean;
}

export interface PieceReleaseGates {
  contentSlotId: string;
  pieceTitle: string;
  gates: ReleaseGate[];
  allPass: boolean;
}

/**
 * Populated by the real route from this codebase's existing standing-
 * authorization and publication-readiness loaders -- never reimplemented
 * here. The two per-piece maps are optional and, when present, override
 * the package-level booleans for that specific deliverable: content
 * approval and receipt state are genuinely per-deliverable facts, unlike
 * destinationIdentityConfirmed/channelAuthenticated, which have no
 * existing per-piece source in this codebase and stay package-level.
 */
export interface PublicationInputs {
  standingAuthorizationActive: boolean;
  individuallyApproved: boolean;
  destinationIdentityConfirmed: boolean;
  channelAuthenticated: boolean;
  publicationReceiptRecorded: boolean;
  /** Keyed by content_deliverables.id. Overrides publication_content_approval for a piece whose deliverableId has an entry here. */
  approvedByDeliverableId?: Record<string, boolean>;
  /** Keyed by content_deliverables.id. Overrides publication_receipt for a piece whose deliverableId has an entry here. */
  receiptsByDeliverableId?: Record<string, boolean>;
}

/** Pipeline order for "has this asset reached at least stage X" checks. Blocked/rejected/superseded/not_planned are terminal-negative and never satisfy a "reached stage" check regardless of position. */
const PIPELINE_ORDER: AssetStatus[] = [
  "required", "missing", "candidate", "visually_selected",
  "hash_verified", "uploaded", "bound", "rendered_verified", "release_ready",
];
const TERMINAL_NEGATIVE: ReadonlySet<AssetStatus> = new Set(["blocked", "rejected", "superseded", "not_planned"]);

function reachedStage(status: AssetStatus, stage: AssetStatus): boolean {
  if (TERMINAL_NEGATIVE.has(status)) return false;
  const idx = PIPELINE_ORDER.indexOf(status);
  const stageIdx = PIPELINE_ORDER.indexOf(stage);
  return idx !== -1 && stageIdx !== -1 && idx >= stageIdx;
}

function check(checkKey: string, pass: boolean, reasonCode: string, message: string): ReleaseCheck {
  return { checkKey, status: pass ? "pass" : "fail", reasonCode: pass ? null : reasonCode, message };
}

function editorialGate(piece: PackageManifestPiece, manifest: PackageManifest): ReleaseGate {
  const requiresSource = (FORMAT_FAMILIES_REQUIRING_SOURCE_VERSION as readonly string[]).includes(piece.formatFamily);
  const hasLocalePair = manifest.pieces.some(
    (p) => p !== piece && p.formatFamily === piece.formatFamily && p.destination === piece.destination && p.locale !== piece.locale,
  );

  const checks = [
    check("editorial_source_version", !requiresSource || !!piece.sourceVersionId, "missing_source_version", "Exact source version resolved for this format"),
    check("editorial_locale_valid", (PACKAGE_LOCALES as readonly string[]).includes(piece.locale), "invalid_locale", "Piece locale is a supported locale"),
    check("editorial_content_approved", piece.approvalStatus === "approved", "content_not_approved", "Content has cleared approval"),
    check("editorial_locale_pair", hasLocalePair, "missing_locale_pair", "A paired EN/PT piece exists for this same format+destination"),
  ];
  return { gate: "editorial", checks, allPass: checks.every((c) => c.status === "pass") };
}

function assetGate(piece: PackageManifestPiece, row: OverviewRow): ReleaseGate {
  const checks: ReleaseCheck[] = [];
  const anyMissing = piece.requiredAssets.some((r) => !r.selectedAssetId);
  checks.push(check("asset_required_present", !anyMissing, "missing_required_asset", "Every required asset has a selected candidate"));

  const worst = row.assetStatus;
  checks.push(check("asset_hash_verified", !anyMissing && reachedStage(worst, "hash_verified"), "asset_not_hash_verified", "Selected asset has passed hash verification"));
  checks.push(check("asset_uploaded", !anyMissing && reachedStage(worst, "uploaded"), "asset_not_uploaded", "Selected asset has been uploaded"));
  checks.push(check("asset_bound", !anyMissing && reachedStage(worst, "bound"), "asset_not_bound", "Selected asset has been bound to its destination"));
  checks.push(check("asset_not_blocked", worst !== "blocked" && worst !== "rejected", "asset_blocked", "No selected asset is blocked or rejected"));

  return { gate: "asset", checks, allPass: checks.every((c) => c.status === "pass") };
}

function experienceGate(piece: PackageManifestPiece, row: OverviewRow): ReleaseGate {
  const ctaRequired = piece.cta.required;
  const checks = [
    check("experience_rendered_verified", row.assetStatus === "rendered_verified" || row.assetStatus === "release_ready", "not_rendered_verified", "Selected asset has cleared rendered verification"),
    check("experience_cta_present", !ctaRequired || row.ctaPdfStatus !== "missing", "missing_cta", "Required CTA has a target"),
    check("experience_no_files_hub", row.ctaPdfStatus !== "files_hub_blocked", "files_hub_cta", "CTA does not point at the Files hub"),
    check("experience_cta_behavior", !ctaRequired || row.ctaPdfStatus !== "wrong_behavior", "wrong_cta_behavior", "Lead-magnet CTA behavior is exactly \"download\""),
  ];
  return { gate: "experience", checks, allPass: checks.every((c) => c.status === "pass") };
}

function publicationGate(piece: PackageManifestPiece, inputs: PublicationInputs): ReleaseGate {
  const deliverableId = piece.deliverableId;
  const approvedOverride = deliverableId ? inputs.approvedByDeliverableId?.[deliverableId] : undefined;
  const receiptOverride = deliverableId ? inputs.receiptsByDeliverableId?.[deliverableId] : undefined;

  const contentApproved = approvedOverride ?? (piece.approvalStatus === "approved");
  const receiptRecorded = receiptOverride ?? inputs.publicationReceiptRecorded;

  const checks = [
    check("publication_content_approval", contentApproved, "content_not_approved", "Content approval state is approved"),
    check("publication_authorization", inputs.standingAuthorizationActive || inputs.individuallyApproved, "no_publication_authorization", "Standing or individual publication authorization is in force"),
    check("publication_destination_identity", inputs.destinationIdentityConfirmed, "destination_identity_unconfirmed", "Exact external destination identity confirmed"),
    check("publication_channel_authenticated", inputs.channelAuthenticated, "channel_not_authenticated", "Publishing channel is authenticated"),
    check("publication_placement", piece.placementStatus !== "not_placed", "not_placed", "Piece has a placement"),
    check(
      "publication_receipt",
      piece.placementStatus !== "placed" || receiptRecorded,
      "publication_receipt_missing",
      "A publication receipt is recorded for this placed piece",
    ),
  ];
  return { gate: "publication", checks, allPass: checks.every((c) => c.status === "pass") };
}

export function assembleReleaseGates(
  overviewViewModel: OverviewViewModel,
  manifest: PackageManifest,
  publicationInputs: PublicationInputs,
): PieceReleaseGates[] {
  const rowsBySlot = new Map(overviewViewModel.rows.map((r) => [r.contentSlotId, r]));

  return manifest.pieces.map((piece) => {
    const row = rowsBySlot.get(piece.contentSlotId)!;
    const gates = [
      editorialGate(piece, manifest),
      assetGate(piece, row),
      experienceGate(piece, row),
      publicationGate(piece, publicationInputs),
    ];
    return {
      contentSlotId: piece.contentSlotId,
      pieceTitle: piece.readerTitle,
      gates,
      allPass: gates.every((g) => g.allPass),
    };
  });
}
