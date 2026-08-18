/* eslint-disable @typescript-eslint/no-explicit-any -- compact adversarial JSON fixtures */
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertExistingDeploymentMatch, canonicalJsonSha256, EXPECTED_SLOTS, loadAndValidateBundle, touchedTargets, validateAuthorization } from "../deployment-bundle";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "drg-deploy-"));
  mkdirSync(path.join(root, "sources")); mkdirSync(path.join(root, "assets")); mkdirSync(path.join(root, "approvals"));
  writeFileSync(path.join(root, "run-state.json"), "{}");
  writeFileSync(path.join(root, "weekly-strategy-brief.json"), "{}");
  const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
  const pieces = [...EXPECTED_SLOTS].sort().map((slot, index) => {
    const source = JSON.stringify({ slot }); writeFileSync(path.join(root, "sources", `${slot}.json`), source);
    const bodyHtml = slot.startsWith("checklist")
      ? `<h2>How to use</h2><h3>Observable checks</h3><ul><li>Check</li></ul><div data-review-table="true">${"complete decision tool ".repeat(300)}</div>`
      : `<p>Reader-facing body for ${slot} with enough content.</p>`;
    return { slotId: slot, deliverableId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, versionId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, formatFamily: slot.startsWith("gbp-") ? "google_business_profile_post" : slot.startsWith("checklist") ? "decision_tool" : "counsel_note", locale: slot.endsWith("-pt") ? "pt-BR" : "en-CA", destination: slot.startsWith("gbp-") ? "google_business_profile" : "firm_website", deliverableRole: slot.startsWith("gbp-") ? "gbp_post" : slot.startsWith("checklist") ? "lead_magnet_pdf" : "article", title: `Title for ${slot}`, description: `Description for ${slot}`, bodyHtml, source: { path: `sources/${slot}.json`, sha256: sha(source) }, bodySha256: sha(bodyHtml), contentKind: "text", publicationPath: null, ctaTargetPath: null };
  });
  const assets = Array.from({ length: 9 }, (_, index) => {
    const bytes = Buffer.from(`asset-${index}`); writeFileSync(path.join(root, "assets", `${index}.png`), bytes);
    return { assetId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, localPath: `assets/${index}.png`, sha256: sha(bytes), mimeType: "image/png", byteSize: bytes.length, width: 1200, height: 900, storagePath: `deliverables/00000000-0000-4000-8000-000000000001/drg-test/${sha(bytes)}-${index}.png`, textPolicy: "text_bearing", overlayLanguage: "en", placements: [{ slotId: [...EXPECTED_SLOTS][index], role: "gbp_card", databaseRole: "gbp_card", packageAssetId: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, destination: "website", locale: "en-CA" }] };
  });
  const approval = "{}"; writeFileSync(path.join(root, "approvals", "a.json"), approval); writeFileSync(path.join(root, "approvals", "b.json"), approval);
  const strategyBrief = { readerAndSituation: "A real reader in a real situation.", workSupported: "A defined desired legal service.", whyThisWeek: "No dated trigger was verified.", practicalAngle: "Prepare actual documents for review.", authorityAndEvidence: "Official primary authority supports the law.", websiteAndConversionRole: "A specific query leads to a qualified review decision." };
  const bundle: any = { schemaVersion: "drg-deployment-bundle-v1", deploymentKey: "drg-test", deploymentReceiptId: "60000000-0000-4000-8000-000000000001", packageEventId: "70000000-0000-4000-8000-000000000001", operationId: "80000000-0000-4000-8000-000000000001", firmId: "00000000-0000-4000-8000-000000000001", operatorWeekNumber: 5, calendarKey: "2026-W33", runId: "DRG-TEST", contentVersion: "v1", sourcePackage: { path: "run-state.json", sha256: sha("{}") }, authority: { releaseId: "DRG-LAW-CSB-4.22", sha256: "0ea34d352d875e030458e96fdd73b23053f32067477b250ac1895d378bbd6ed3" }, period: { id: "30000000-0000-4000-8000-000000000001", strategyBrief, strategyBriefSource: { path: "weekly-strategy-brief.json", sha256: sha("{}") } }, publishingPackageId: "40000000-0000-4000-8000-000000000001", pieces, assets, approvalEvidence: [{ approvalId: "aaaa", source: { path: "approvals/a.json", sha256: sha(approval) }, decision: "approved", scope: assets.map((x) => x.assetId) }, { approvalId: "bbbb", source: { path: "approvals/b.json", sha256: sha(approval) }, decision: "approved", scope: assets.map((x) => x.assetId) }], writeAllowlist: { tables: ["content_periods", "content_deliverables", "deliverable_versions", "publishing_packages", "publishing_package_assets", "publishing_package_events", "drg_content_deployments"], storageBucket: "firm-files", storagePrefix: "deliverables/00000000-0000-4000-8000-000000000001/drg-test/", maxWrites: 80 }, publicationAuthorized: false };
  const bundlePath = path.join(root, "bundle.json"); writeFileSync(bundlePath, JSON.stringify(bundle));
  return { root, bundle, bundlePath };
}

describe("DR-122 deployment bundle", () => {
  it("binds exact bytes and exact authorization", () => {
    const { root, bundle, bundlePath } = fixture();
    const loaded = loadAndValidateBundle(bundlePath, root);
    const touched = touchedTargets(bundle);
    const auth = { operation: "deliverables_publishing_kit_placement", planSha256: loaded.canonicalSha256, expiresAt: "2099-01-01T00:00:00Z", allowedTargetIds: [...touched.ids], allowedDestinationRecords: [...touched.records], maxWriteCount: 80 };
    expect(validateAuthorization(auth, bundle, loaded.canonicalSha256)).toBe(canonicalJsonSha256(auth));
    expect(touched.records).toContain(`drg_content_deployments:${bundle.deploymentReceiptId}`);
    expect(touched.records).toContain(`publishing_package_events:${bundle.packageEventId}`);
    expect(bundle.assets.every((asset: any) => touched.records.has(`storage:firm-files:${asset.storagePath}`))).toBe(true);
    expect(() => validateAuthorization({ ...auth, planSha256: "0".repeat(64) }, bundle, loaded.canonicalSha256)).toThrow(/plan hash/);
    expect(() => validateAuthorization({ ...auth, expiresAt: "2000-01-01T00:00:00Z" }, bundle, loaded.canonicalSha256)).toThrow(/expired/);
    expect(() => validateAuthorization({ ...auth, allowedTargetIds: [] }, bundle, loaded.canonicalSha256)).toThrow(/misses target/);
    expect(() => validateAuthorization({ ...auth, allowedTargetIds: [...auth.allowedTargetIds, "unexpected-target"] }, bundle, loaded.canonicalSha256)).toThrow(/outside the exact deployment plan/);
  });

  it("rejects publication, source drift, and storage escape", () => {
    const { root, bundle, bundlePath } = fixture();
    bundle.publicationAuthorized = true; writeFileSync(bundlePath, JSON.stringify(bundle));
    expect(() => loadAndValidateBundle(bundlePath, root)).toThrow(/publicationAuthorized/);
    bundle.publicationAuthorized = false; bundle.assets[0].storagePath = "outside/file.png"; writeFileSync(bundlePath, JSON.stringify(bundle));
    expect(() => loadAndValidateBundle(bundlePath, root)).toThrow(/outside allowlist/);
  });

  it("rejects same-key byte substitution and allows an exact no-op identity", () => {
    const hashes = { bundleFileSha256: "a".repeat(64), bundleCanonicalSha256: "b".repeat(64), authorizationSha256: "c".repeat(64) };
    const existing = { bundle_sha256: hashes.bundleFileSha256, bundle_canonical_sha256: hashes.bundleCanonicalSha256, authorization_sha256: hashes.authorizationSha256 };
    expect(() => assertExistingDeploymentMatch(existing, hashes)).not.toThrow();
    expect(() => assertExistingDeploymentMatch({ ...existing, bundle_sha256: "d".repeat(64) }, hashes)).toThrow(/different bundle/);
  });
});
