import { describe, it, expect } from "vitest";
import { validatePackageManifest } from "../publishing-package-control-room-manifest";
import { baseManifestJson } from "../__fixtures__/publishing-package-drg-renewal-week";
import { buildGatewayExportManifest, buildExportBundle, runAssetBindingDryRun } from "../publishing-package-gateway-export";
import type { ControlRoomAssetDetail } from "../publishing-package-control-room-assets";

const FAKE_DELIVERABLE_ID = "d0d0d0d0-0000-4000-8000-000000000d01";
const FAKE_FIRM_ID = "f1f1f1f1-0000-4000-8000-0000000000f1";

function manifestWithResolvedDeliverable() {
  const result = validatePackageManifest(baseManifestJson());
  if (!result.ok) throw new Error(`fixture manifest unexpectedly invalid: ${JSON.stringify(result.errors)}`);
  const piece = result.manifest.pieces.find((p) => p.contentSlotId === "counsel-note-en")!;
  piece.deliverableId = FAKE_DELIVERABLE_ID; // mutate the validated object -- same pattern used elsewhere in this suite
  return result.manifest;
}

function baseAsset(overrides: Partial<ControlRoomAssetDetail>): ControlRoomAssetDetail {
  return {
    id: "asset-eligible-1",
    content_slot_id: "counsel-note-en",
    asset_role: "website_article_hero",
    locale: "en-CA",
    destination: "website",
    filename: "hero.jpg",
    mime_type: "image/jpeg",
    byte_size: 200_000,
    width: 1600,
    height: 900,
    sha256: "a".repeat(64),
    alt_text: "A hero image",
    text_policy: "textless",
    overlay_language: null,
    status: "hash_verified",
    is_selected: true,
    ...overrides,
  };
}

describe("buildGatewayExportManifest", () => {
  it("includes an eligible asset: selected, hash_verified, website_article_hero, deliverable resolved", () => {
    const manifest = manifestWithResolvedDeliverable();
    const asset = baseAsset({});
    const result = buildGatewayExportManifest(FAKE_FIRM_ID, manifest, [asset]);
    expect(result.included).toEqual([asset.id]);
    expect(result.excluded).toHaveLength(0);
    expect(result.ok).toBe(true);
    expect(result.raw.operations).toHaveLength(1);
    expect((result.raw.operations[0] as { asset_path: string }).asset_path).toBe("assets/hero.jpg");
  });

  it("excludes a rejected candidate", () => {
    const manifest = manifestWithResolvedDeliverable();
    const asset = baseAsset({ id: "asset-rejected", status: "rejected" });
    const result = buildGatewayExportManifest(FAKE_FIRM_ID, manifest, [asset]);
    expect(result.included).toHaveLength(0);
    expect(result.excluded[0]).toMatchObject({ assetId: "asset-rejected", reason: "rejected" });
  });

  it("excludes a superseded candidate", () => {
    const manifest = manifestWithResolvedDeliverable();
    const asset = baseAsset({ id: "asset-superseded", status: "superseded" });
    const result = buildGatewayExportManifest(FAKE_FIRM_ID, manifest, [asset]);
    expect(result.excluded[0]).toMatchObject({ assetId: "asset-superseded", reason: "superseded" });
  });

  it("excludes a missing-status row", () => {
    const manifest = manifestWithResolvedDeliverable();
    const asset = baseAsset({ id: "asset-missing", status: "missing" });
    const result = buildGatewayExportManifest(FAKE_FIRM_ID, manifest, [asset]);
    expect(result.excluded[0]).toMatchObject({ assetId: "asset-missing", reason: "missing" });
  });

  it("excludes an already-bound asset", () => {
    const manifest = manifestWithResolvedDeliverable();
    const asset = baseAsset({ id: "asset-bound", status: "bound" });
    const result = buildGatewayExportManifest(FAKE_FIRM_ID, manifest, [asset]);
    expect(result.excluded[0]).toMatchObject({ assetId: "asset-bound", reason: "already_bound" });
  });

  it("excludes a pdf_document role", () => {
    const manifest = manifestWithResolvedDeliverable();
    const asset = baseAsset({ id: "asset-pdf", asset_role: "pdf_document" });
    const result = buildGatewayExportManifest(FAKE_FIRM_ID, manifest, [asset]);
    expect(result.excluded[0]).toMatchObject({ assetId: "asset-pdf", reason: "unsupported_role" });
  });

  it("excludes a non-hero role (the gateway binds only website_article_hero)", () => {
    const manifest = manifestWithResolvedDeliverable();
    const asset = baseAsset({ id: "asset-gbp", asset_role: "gbp_card" });
    const result = buildGatewayExportManifest(FAKE_FIRM_ID, manifest, [asset]);
    expect(result.excluded[0]).toMatchObject({ assetId: "asset-gbp", reason: "unsupported_role" });
  });

  it("excludes a selected hero not yet hash_verified with reason not_hash_verified", () => {
    const manifest = manifestWithResolvedDeliverable();
    const asset = baseAsset({ id: "asset-early", status: "visually_selected" });
    const result = buildGatewayExportManifest(FAKE_FIRM_ID, manifest, [asset]);
    expect(result.excluded[0]).toMatchObject({ assetId: "asset-early", reason: "not_hash_verified" });
  });

  it("excludes an unselected candidate even if otherwise eligible", () => {
    const manifest = manifestWithResolvedDeliverable();
    const asset = baseAsset({ id: "asset-unselected", is_selected: false });
    const result = buildGatewayExportManifest(FAKE_FIRM_ID, manifest, [asset]);
    expect(result.excluded[0]).toMatchObject({ assetId: "asset-unselected", reason: "not_selected" });
  });

  it("excludes an asset whose piece has no resolved deliverable_id", () => {
    // baseManifestJson's un-mutated pieces all carry deliverable_id: null.
    const result = validatePackageManifest(baseManifestJson());
    if (!result.ok) throw new Error("fixture unexpectedly invalid");
    const asset = baseAsset({ id: "asset-no-deliverable" });
    const exportResult = buildGatewayExportManifest(FAKE_FIRM_ID, result.manifest, [asset]);
    expect(exportResult.excluded[0]).toMatchObject({ assetId: "asset-no-deliverable", reason: "deliverable_not_resolved" });
  });

  it("output passes the gateway's own validator", () => {
    const manifest = manifestWithResolvedDeliverable();
    const asset = baseAsset({});
    const result = buildGatewayExportManifest(FAKE_FIRM_ID, manifest, [asset]);
    expect(result.ok).toBe(true);
    expect(result.manifest).not.toBeNull();
    expect(result.errors).toHaveLength(0);
  });
});

describe("buildExportBundle", () => {
  it("produces all 4 artifacts and a non-empty blocker report when something is excluded", () => {
    const manifest = manifestWithResolvedDeliverable();
    const eligible = baseAsset({});
    const rejected = baseAsset({ id: "asset-rejected", status: "rejected" });
    const bundle = buildExportBundle(FAKE_FIRM_ID, manifest, [eligible, rejected]);
    expect(bundle.packageManifestJson.length).toBeGreaterThan(0);
    expect(bundle.gatewayManifestJson).not.toBeNull();
    expect(bundle.humanReadableSummary).toContain("Gateway-eligible operations: 1");
    expect(bundle.blockerReport).toContain("rejected");
  });
});

describe("runAssetBindingDryRun", () => {
  it("performs zero writes and reports every operation as eligible on a valid export", () => {
    const manifest = manifestWithResolvedDeliverable();
    const asset = baseAsset({});
    const exportResult = buildGatewayExportManifest(FAKE_FIRM_ID, manifest, [asset]);
    const dryRun = runAssetBindingDryRun(exportResult);
    expect(dryRun.ok).toBe(true);
    expect(dryRun.operations).toHaveLength(1);
    expect(dryRun.operations[0].eligible).toBe(true);
  });

  it("never invokes fetch (proves zero network calls)", () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (() => {
      fetchCalled = true;
      throw new Error("fetch must never be called by a dry run");
    }) as typeof fetch;

    try {
      const manifest = manifestWithResolvedDeliverable();
      const asset = baseAsset({});
      const exportResult = buildGatewayExportManifest(FAKE_FIRM_ID, manifest, [asset]);
      runAssetBindingDryRun(exportResult);
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
