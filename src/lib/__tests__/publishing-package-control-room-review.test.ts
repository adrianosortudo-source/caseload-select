import { describe, it, expect } from "vitest";
import { validatePackageManifest } from "../publishing-package-control-room-manifest";
import { baseManifestJson, DRG_CANDIDATE_ASSETS } from "../__fixtures__/publishing-package-drg-renewal-week";
import { assembleOverviewViewModel } from "../publishing-package-control-room-overview";
import { filterPackageForViewer } from "../publishing-package-control-room-review";
import type { ControlRoomAssetDetail } from "../publishing-package-control-room-assets";

function validManifest() {
  const result = validatePackageManifest(baseManifestJson());
  if (!result.ok) throw new Error(`fixture manifest unexpectedly invalid: ${JSON.stringify(result.errors)}`);
  return result.manifest;
}

const assets: ControlRoomAssetDetail[] = DRG_CANDIDATE_ASSETS.filter((c) => c.role === "website_article_hero").map((c) => ({
  id: c.id,
  content_slot_id: "counsel-note-en",
  asset_role: c.role,
  locale: c.locale,
  destination: c.destination,
  filename: `${c.id.slice(0, 8)}.jpg`,
  mime_type: "image/jpeg",
  byte_size: 240_000,
  width: c.width,
  height: c.height,
  sha256: c.sha256,
  alt_text: "Fixture hero alt text",
  text_policy: "textless",
  overlay_language: null,
  status: c.status,
  is_selected: c.isSelected,
}));

function buildViewModel() {
  const manifest = validManifest();
  const overview = assembleOverviewViewModel(
    manifest, "assembling",
    assets.map((a) => ({ id: a.id, status: a.status, filename: a.filename })),
  );
  return { overview };
}

describe("filterPackageForViewer", () => {
  it("operator payload includes sha256, asset ids, rejected and superseded candidates, and release blockers", () => {
    const { overview } = buildViewModel();
    const view = filterPackageForViewer(overview, assets, "operator");
    const json = JSON.stringify(view);

    const selectedCandidate = assets.find((a) => a.is_selected)!;
    const rejectedCandidate = assets.find((a) => a.status === "rejected")!;
    const supersededCandidate = assets.find((a) => a.status === "superseded")!;

    expect(json).toContain(selectedCandidate.sha256);
    expect(json).toContain(rejectedCandidate.id);
    expect(json).toContain(supersededCandidate.id);

    const piece = view.pieces.find((p) => p.contentSlotId === "counsel-note-en")!;
    expect(piece.candidates.some((c) => c.status === "rejected")).toBe(true);
    expect(piece.candidates.some((c) => c.status === "superseded")).toBe(true);
    expect(piece.releaseBlockers.length).toBeGreaterThan(0);
  });

  it("lawyer payload contains no sha256, no asset ids, and no rejected/superseded entries anywhere", () => {
    const { overview } = buildViewModel();
    const view = filterPackageForViewer(overview, assets, "lawyer");
    const json = JSON.stringify(view);

    for (const a of assets) {
      expect(json).not.toContain(a.sha256);
      if (!a.is_selected) expect(json).not.toContain(a.id);
    }
    expect(json).not.toContain('"status":"rejected"');
    expect(json).not.toContain('"status":"superseded"');

    const piece = view.pieces.find((p) => p.contentSlotId === "counsel-note-en")!;
    expect(piece.candidates).toHaveLength(0);
    expect(piece.releaseBlockers).toHaveLength(0);
  });

  it("lawyer payload still surfaces the selected visual's filename, locale, destination, and content/approval status", () => {
    const { overview } = buildViewModel();
    const view = filterPackageForViewer(overview, assets, "lawyer");
    const piece = view.pieces.find((p) => p.contentSlotId === "counsel-note-en")!;
    const selectedCandidate = assets.find((a) => a.is_selected)!;

    expect(piece.selectedAsset?.filename).toBe(selectedCandidate.filename);
    expect(piece.locale).toBe("en-CA");
    expect(piece.destination).toBe("website");
    expect(piece.sourceContentStatus).toBe("in_review");
    expect(piece.approvalState).toBe("in_review");
  });

  it("both payloads cover every piece in the manifest", () => {
    const { overview } = buildViewModel();
    const operatorView = filterPackageForViewer(overview, assets, "operator");
    const lawyerView = filterPackageForViewer(overview, assets, "lawyer");
    expect(operatorView.pieces).toHaveLength(16);
    expect(lawyerView.pieces).toHaveLength(16);
  });
});
