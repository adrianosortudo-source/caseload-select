import { describe, it, expect } from "vitest";
import { validatePackageManifest } from "../publishing-package-control-room-manifest";
import { baseManifestJson, DRG_CANDIDATE_ASSETS } from "../__fixtures__/publishing-package-drg-renewal-week";
import { assembleOverviewViewModel, type OverviewAssetRef } from "../publishing-package-control-room-overview";

function validManifest() {
  const result = validatePackageManifest(baseManifestJson());
  if (!result.ok) throw new Error(`fixture manifest unexpectedly invalid: ${JSON.stringify(result.errors)}`);
  return result.manifest;
}

const candidateAssetRefs: OverviewAssetRef[] = DRG_CANDIDATE_ASSETS.map((c) => ({
  id: c.id,
  status: c.status,
  filename: `${c.id}.jpg`,
}));

describe("assembleOverviewViewModel", () => {
  it("reports the full 16/16 expected-vs-actual piece count", () => {
    const vm = assembleOverviewViewModel(validManifest(), "assembling", candidateAssetRefs);
    expect(vm.header.expectedPieceCount).toBe(16);
    expect(vm.header.actualPieceCount).toBe(16);
    expect(vm.rows).toHaveLength(16);
  });

  it("treats a piece with no selected asset as missing, not ready", () => {
    const vm = assembleOverviewViewModel(validManifest(), "assembling", candidateAssetRefs);
    const row = vm.rows.find((r) => r.contentSlotId === "counsel-note-pt")!;
    expect(row.actualAssetSummary).toBe("missing");
    expect(row.assetStatus).toBe("missing");
    expect(row.releaseBlockers.some((b) => b.includes("missing required asset"))).toBe(true);
  });

  it("resolves a selected asset's real status through the assetsById map, not assumes readiness from selection alone", () => {
    // counsel-note-en has 3 required assets: website_article_hero (points at
    // the fixture's release_ready selected candidate), canonical_textless_master
    // (has a selected_asset_id in the fixture, but that candidate is not in
    // this test's asset list -> "selected asset not found"), and
    // rendered_qa_evidence (selected_asset_id is null in the fixture ->
    // genuinely "missing"). The piece-level status is the worst of the
    // three -- "missing" outranks "release_ready" in severity, so the whole
    // piece still reads as not-ready even though its hero is fully cleared.
    const vm = assembleOverviewViewModel(validManifest(), "assembling", candidateAssetRefs);
    const row = vm.rows.find((r) => r.contentSlotId === "counsel-note-en")!;
    expect(row.assetStatus).toBe("missing");
    expect(row.releaseBlockers.some((b) => b.includes("selected asset not found") && b.includes("canonical_textless_master"))).toBe(true);
    expect(row.releaseBlockers.some((b) => b.includes("missing required asset: rendered_qa_evidence"))).toBe(true);
  });

  it("marks the gbp-post-en slot release-ready only when both content and every required asset clear (it is NOT release-ready here: its gbp_card candidate was never registered in this test's asset list)", () => {
    const vm = assembleOverviewViewModel(validManifest(), "assembling", candidateAssetRefs);
    const row = vm.rows.find((r) => r.contentSlotId === "gbp-post-en")!;
    expect(row.contentStatus).toBe("approved");
    expect(row.releaseBlockers.length).toBeGreaterThan(0); // asset not in candidateAssetRefs -> "not found"
  });

  it("flags a Files-hub CTA as a release blocker distinct from a missing asset", () => {
    const manifest = validManifest();
    const piece = manifest.pieces.find((p) => p.contentSlotId === "lead-magnet-document-en")!;
    piece.cta.target = "/files/x.pdf";
    const vm = assembleOverviewViewModel(manifest, "assembling", candidateAssetRefs);
    const row = vm.rows.find((r) => r.contentSlotId === "lead-magnet-document-en")!;
    expect(row.ctaPdfStatus).toBe("files_hub_blocked");
    expect(row.releaseBlockers.some((b) => b.includes("Files hub"))).toBe(true);
  });

  it("marks cta not_applicable for pieces with no CTA requirement", () => {
    const vm = assembleOverviewViewModel(validManifest(), "assembling", candidateAssetRefs);
    const row = vm.rows.find((r) => r.contentSlotId === "counsel-note-en")!;
    expect(row.ctaPdfStatus).toBe("not_applicable");
  });

  it("computes progress denominators against the actual row count, not a hardcoded 16", () => {
    const manifest = validManifest();
    manifest.pieces.pop(); // simulate a 15-piece in-progress manifest
    const vm = assembleOverviewViewModel(manifest, "assembling", candidateAssetRefs);
    expect(vm.progress.content.total).toBe(15);
    expect(vm.progress.assets.total).toBe(15);
  });

  it("never lets a blocked or rejected candidate register as ready even if formally selected", () => {
    const blockedRef: OverviewAssetRef = { id: "blocked-1", status: "blocked", filename: "x.jpg" };
    const manifest = validManifest();
    const piece = manifest.pieces.find((p) => p.contentSlotId === "clause-margin-en")!;
    piece.requiredAssets[0].selectedAssetId = "blocked-1";
    const vm = assembleOverviewViewModel(manifest, "assembling", [blockedRef]);
    const row = vm.rows.find((r) => r.contentSlotId === "clause-margin-en")!;
    expect(row.assetStatus).toBe("blocked");
    expect(row.releaseBlockers.some((b) => b.includes("asset blocked"))).toBe(true);
  });
});
