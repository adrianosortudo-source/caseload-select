import { describe, it, expect } from "vitest";
import { validatePackageManifest } from "../publishing-package-control-room-manifest";
import { baseManifestJson } from "../__fixtures__/publishing-package-drg-renewal-week";
import { buildAssetBrief, briefToJson, ASSET_BRIEF_MAX_BYTE_SIZE } from "../publishing-package-control-room-brief";

function validManifest() {
  const result = validatePackageManifest(baseManifestJson());
  if (!result.ok) throw new Error(`fixture manifest unexpectedly invalid: ${JSON.stringify(result.errors)}`);
  return result.manifest;
}

function pieceAndRequirement(slot: string, roleIndex = 0) {
  const manifest = validManifest();
  const piece = manifest.pieces.find((p) => p.contentSlotId === slot)!;
  return { piece, requirement: piece.requiredAssets[roleIndex] };
}

describe("buildAssetBrief", () => {
  it("uses required_copy verbatim, never derives visible copy from the title", () => {
    // linkedin-post-en has an explicit required_copy distinct from its reader_title.
    const { piece, requirement } = pieceAndRequirement("linkedin-post-en");
    const brief = buildAssetBrief(piece, requirement, "in_review");
    expect(requirement.requiredCopy).not.toBeNull();
    expect(brief.requiredVisibleCopy).toBe(requirement.requiredCopy);
    expect(brief.requiredVisibleCopy).not.toBe(piece.readerTitle);
    expect(brief.prohibitedCopy).toBeNull();
  });

  it("sets an explicit prohibition when the requirement is textless and has no required_copy", () => {
    // counsel-note-en's website_article_hero is textless with required_copy: null.
    const { piece, requirement } = pieceAndRequirement("counsel-note-en", 0);
    expect(requirement.textPolicy).toBe("textless");
    expect(requirement.requiredCopy).toBeNull();
    const brief = buildAssetBrief(piece, requirement, "in_review");
    expect(brief.requiredVisibleCopy).toBeNull();
    expect(brief.prohibitedCopy).toBe("Do not add any text overlay");
  });

  it("includes every required brief field", () => {
    const { piece, requirement } = pieceAndRequirement("gbp-post-en");
    const brief = buildAssetBrief(piece, requirement, "approved");
    expect(brief.topic).toBe(piece.readerTitle);
    expect(brief.readerDecision).toBe(piece.bodyRelationship);
    expect(brief.canonicalSourceDeliverableVersion).toBe(piece.sourceVersionId);
    expect(brief.locale).toBe(requirement.locale);
    expect(brief.destination).toBe(requirement.destination);
    expect(brief.role).toBe(requirement.assetRole);
    expect(brief.exactDimensions).toEqual({ width: requirement.requiredWidth, height: requirement.requiredHeight });
    expect(brief.textPolicy).toBe(requirement.textPolicy);
    expect(brief.overlayLanguage).toBe(requirement.overlayLanguage);
    expect(brief.safeAreaRule).toBe(requirement.safeArea);
    expect(brief.cropRule.length).toBeGreaterThan(0);
    expect(brief.visualDirection.length).toBeGreaterThan(0);
    expect(brief.filenameConvention).toBe(`gbp-post-en--gbp_card--en-CA.png`);
    expect(brief.outputFormat).toBe("PNG");
    expect(brief.maxByteSize).toBe(ASSET_BRIEF_MAX_BYTE_SIZE);
    expect(brief.requiredAltText.length).toBeGreaterThan(0);
    expect(brief.currentSourceApprovalState).toBe("approved");
  });

  it("uses PDF output format and a not-applicable crop rule for the pdf_document role", () => {
    const { piece, requirement } = pieceAndRequirement("lead-magnet-document-en", 1); // [1] = pdf_document
    expect(requirement.assetRole).toBe("pdf_document");
    const brief = buildAssetBrief(piece, requirement, "approved");
    expect(brief.outputFormat).toBe("PDF");
    expect(brief.cropRule).toContain("Not applicable");
    expect(brief.filenameConvention.endsWith(".pdf")).toBe(true);
  });

  it("round-trips through briefToJson without loss", () => {
    const { piece, requirement } = pieceAndRequirement("clause-margin-en");
    const brief = buildAssetBrief(piece, requirement, "approved");
    const json = briefToJson(brief);
    expect(JSON.parse(json)).toEqual(brief);
  });
});
