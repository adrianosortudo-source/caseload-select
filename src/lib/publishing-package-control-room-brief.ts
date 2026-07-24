/**
 * CR-18: Asset Brief Builder (Section 13). Generates a complete,
 * deterministic creation brief for one missing required asset, straight
 * from the manifest -- never a vague prompt, never infers visible copy
 * from the title when required_copy is provided (required_copy is used
 * verbatim or not at all).
 */
import type {
  AssetRole,
  PackageLocale,
  TextPolicy,
  OverlayLanguage,
  PackageManifestPiece,
  PackageManifestRequiredAsset,
} from "@/lib/publishing-package-control-room-manifest";

export const ASSET_BRIEF_MAX_BYTE_SIZE = 10_485_760; // 10 MB

export interface AssetBrief {
  topic: string;
  readerDecision: string;
  canonicalSourceDeliverableVersion: string | null;
  locale: PackageLocale;
  destination: string;
  role: AssetRole;
  exactDimensions: { width: number; height: number };
  textPolicy: TextPolicy;
  requiredVisibleCopy: string | null;
  prohibitedCopy: string | null;
  overlayLanguage: OverlayLanguage | null;
  safeAreaRule: string;
  cropRule: string;
  visualDirection: string;
  filenameConvention: string;
  outputFormat: string;
  maxByteSize: number;
  requiredAltText: string;
  currentSourceApprovalState: string;
}

function cropRuleFor(width: number, height: number, role: AssetRole): string {
  if (role === "pdf_document") return "Not applicable -- this requirement is a PDF, not an image.";
  return `Crop to exactly ${width}x${height}px. No letterboxing, no padding bars, no cropped-in logos or text near the edges.`;
}

function visualDirectionFor(textPolicy: TextPolicy, overlayLanguage: OverlayLanguage | null): string {
  if (textPolicy === "textless") return "Textless. No text overlay of any kind, including logos with embedded wordmarks.";
  if (textPolicy === "platform_rendered_text") return "The destination platform renders its own text over this image -- do not add competing text overlay.";
  return `Text-bearing in ${overlayLanguage ?? "the piece's"} language. Overlay copy must stay inside the safe area and remain legible at the destination's rendered size.`;
}

function outputFormatFor(role: AssetRole): string {
  return role === "pdf_document" ? "PDF" : "PNG";
}

function filenameConventionFor(contentSlotId: string, role: AssetRole, locale: PackageLocale): string {
  return `${contentSlotId}--${role}--${locale}.${outputFormatFor(role).toLowerCase()}`;
}

/**
 * Builds one brief for one (piece, required_assets entry) pair. `required_copy`,
 * when present, is used verbatim as requiredVisibleCopy -- never derived
 * from readerTitle. When absent AND the policy is textless, prohibitedCopy
 * is set explicitly so a designer can't accidentally add text "because the
 * title suggested it."
 */
export function buildAssetBrief(
  piece: PackageManifestPiece,
  requirement: PackageManifestRequiredAsset,
  sourceApprovalState: string,
): AssetBrief {
  const requiredVisibleCopy = requirement.requiredCopy ?? null;
  const prohibitedCopy =
    requiredVisibleCopy === null && requirement.textPolicy === "textless"
      ? "Do not add any text overlay"
      : null;

  return {
    topic: piece.readerTitle,
    readerDecision: piece.bodyRelationship,
    canonicalSourceDeliverableVersion: piece.sourceVersionId,
    locale: requirement.locale,
    destination: requirement.destination,
    role: requirement.assetRole,
    exactDimensions: { width: requirement.requiredWidth, height: requirement.requiredHeight },
    textPolicy: requirement.textPolicy,
    requiredVisibleCopy,
    prohibitedCopy,
    overlayLanguage: requirement.overlayLanguage,
    safeAreaRule: requirement.safeArea,
    cropRule: cropRuleFor(requirement.requiredWidth, requirement.requiredHeight, requirement.assetRole),
    visualDirection: visualDirectionFor(requirement.textPolicy, requirement.overlayLanguage),
    filenameConvention: filenameConventionFor(piece.contentSlotId, requirement.assetRole, requirement.locale),
    outputFormat: outputFormatFor(requirement.assetRole),
    maxByteSize: ASSET_BRIEF_MAX_BYTE_SIZE,
    requiredAltText: `Required. Must accurately describe this image's content for screen readers -- not the piece's title restated, the image itself.`,
    currentSourceApprovalState: sourceApprovalState,
  };
}

export function briefToJson(brief: AssetBrief): string {
  return JSON.stringify(brief, null, 2);
}
