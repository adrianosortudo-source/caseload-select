/**
 * CR-15 tests (Section 22 "Assets"): one test per required filter (13
 * minimum: all, missing, candidate, selected, uploaded, bound,
 * rendered_verified, blocked, superseded, locale:en-CA, locale:pt-BR,
 * destination:<value>, role:<value>) plus grouping order, fed from the DRG
 * fixture.
 */
import { describe, it, expect } from "vitest";
import { validatePackageManifest } from "../publishing-package-control-room-manifest";
import { baseManifestJson, DRG_CANDIDATE_ASSETS } from "../__fixtures__/publishing-package-drg-renewal-week";
import {
  assembleAssetsViewModel,
  filterAssetCards,
  type ControlRoomAssetDetail,
} from "../publishing-package-control-room-assets";

function validManifest() {
  const result = validatePackageManifest(baseManifestJson());
  if (!result.ok) throw new Error(`fixture manifest unexpectedly invalid: ${JSON.stringify(result.errors)}`);
  return result.manifest;
}

// The 3 counsel-note-en hero candidates from the fixture, promoted to full
// ControlRoomAssetDetail rows (AssetGuardCandidate doesn't carry every
// field this view needs -- content_slot_id, destination, mime_type,
// byte_size, alt_text are supplied here to match what a real
// publishing_package_assets row would carry for the same candidates).
const heroCandidates: ControlRoomAssetDetail[] = DRG_CANDIDATE_ASSETS
  .filter((c) => c.role === "website_article_hero")
  .map((c) => ({
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

// A pt-BR candidate registered for the linkedin-article-pt slot, so
// destination/role/locale filters each have something outside the hero
// group to prove they actually narrow the set.
const linkedinPtCandidate: ControlRoomAssetDetail = {
  id: "linkedin-pt-candidate-1",
  content_slot_id: "linkedin-article-pt",
  asset_role: "native_linkedin_article_cover",
  locale: "pt-BR",
  destination: "linkedin_article",
  filename: "linkedin-pt-cover.jpg",
  mime_type: "image/jpeg",
  byte_size: 180_000,
  width: 1200,
  height: 627,
  sha256: "e".repeat(64),
  alt_text: "Cláusula de Renovação cover",
  text_policy: "text_bearing",
  overlay_language: "pt",
  status: "uploaded",
  is_selected: true,
};

const allAssets: ControlRoomAssetDetail[] = [...heroCandidates, linkedinPtCandidate];

function buildViewModel() {
  return assembleAssetsViewModel(validManifest(), allAssets);
}

describe("assembleAssetsViewModel", () => {
  it("groups by content piece, then by required destination role", () => {
    const vm = buildViewModel();
    const counselNoteEn = vm.groups.find((g) => g.contentSlotId === "counsel-note-en")!;
    expect(counselNoteEn.roles.map((r) => r.assetRole)).toEqual([
      "website_article_hero", "canonical_textless_master", "rendered_qa_evidence",
    ]);
  });

  it("registers 3 candidate cards for the hero requirement with a real candidate group", () => {
    const vm = buildViewModel();
    const heroGroup = vm.groups.find((g) => g.contentSlotId === "counsel-note-en")!.roles.find((r) => r.assetRole === "website_article_hero")!;
    expect(heroGroup.cards).toHaveLength(3);
    expect(heroGroup.cards.every((c) => c.kind === "candidate")).toBe(true);
  });

  it("synthesizes a single 'missing' requirement_gap card for a requirement with zero candidates", () => {
    const vm = buildViewModel();
    const masterGroup = vm.groups.find((g) => g.contentSlotId === "counsel-note-en")!.roles.find((r) => r.assetRole === "canonical_textless_master")!;
    expect(masterGroup.cards).toHaveLength(1);
    expect(masterGroup.cards[0].kind).toBe("requirement_gap");
    expect(masterGroup.cards[0].status).toBe("missing");
    expect(masterGroup.cards[0].blockingReason).toBe("no candidate registered for this requirement");
  });
});

describe("filterAssetCards -- all 13 required filters", () => {
  const vm = buildViewModel();

  it("all: returns every card unfiltered", () => {
    expect(filterAssetCards(vm.allCards, "all")).toHaveLength(vm.allCards.length);
  });

  it("missing: matches every requirement_gap card", () => {
    const result = filterAssetCards(vm.allCards, "missing");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.status === "missing")).toBe(true);
  });

  it("candidate: matches only status candidate", () => {
    // none of the fixture rows are status 'candidate' -- proves the filter
    // narrows to zero rather than silently matching everything.
    const result = filterAssetCards(vm.allCards, "candidate");
    expect(result.every((c) => c.status === "candidate")).toBe(true);
  });

  it("selected: matches isSelected regardless of pipeline stage", () => {
    const result = filterAssetCards(vm.allCards, "selected");
    expect(result.length).toBeGreaterThanOrEqual(2); // release_ready hero + uploaded linkedin-pt
    expect(result.every((c) => c.isSelected)).toBe(true);
  });

  it("uploaded: matches status uploaded", () => {
    const result = filterAssetCards(vm.allCards, "uploaded");
    expect(result.some((c) => c.assetId === "linkedin-pt-candidate-1")).toBe(true);
    expect(result.every((c) => c.status === "uploaded")).toBe(true);
  });

  it("bound: matches status bound", () => {
    expect(filterAssetCards(vm.allCards, "bound").every((c) => c.status === "bound")).toBe(true);
  });

  it("rendered_verified: matches status rendered_verified", () => {
    expect(filterAssetCards(vm.allCards, "rendered_verified").every((c) => c.status === "rendered_verified")).toBe(true);
  });

  it("blocked: matches status blocked", () => {
    const result = filterAssetCards(vm.allCards, "blocked");
    expect(result.every((c) => c.status === "blocked")).toBe(true);
  });

  it("superseded: matches the fixture's superseded hero candidate", () => {
    const result = filterAssetCards(vm.allCards, "superseded");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((c) => c.status === "superseded")).toBe(true);
  });

  it("locale:en-CA: narrows to en-CA cards only", () => {
    const result = filterAssetCards(vm.allCards, "locale:en-CA");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.locale === "en-CA")).toBe(true);
  });

  it("locale:pt-BR: narrows to pt-BR cards only", () => {
    const result = filterAssetCards(vm.allCards, "locale:pt-BR");
    expect(result.some((c) => c.assetId === "linkedin-pt-candidate-1")).toBe(true);
    expect(result.every((c) => c.locale === "pt-BR")).toBe(true);
  });

  it("destination:<value>: narrows to an exact destination", () => {
    const result = filterAssetCards(vm.allCards, "destination:linkedin_article");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.destination === "linkedin_article")).toBe(true);
  });

  it("role:<value>: narrows to an exact asset role", () => {
    const result = filterAssetCards(vm.allCards, "role:website_article_hero");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.assetRole === "website_article_hero")).toBe(true);
  });
});
