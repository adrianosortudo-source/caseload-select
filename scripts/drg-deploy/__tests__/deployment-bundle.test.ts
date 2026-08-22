/* eslint-disable @typescript-eslint/no-explicit-any -- compact adversarial JSON fixtures */
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertExistingDeploymentMatch, canonicalJsonSha256, EXPECTED_SLOTS, isExactLegacyWeek7ExistingVerification, LEGACY_WEEK_7_EXISTING_VERIFICATION, loadAndValidateBundle, loadPinnedPlacementContract, preflightDeploymentBundle, touchedTargets, validateAuthorization, verifyExistingDeployment } from "../deployment-bundle";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "drg-deploy-"));
  mkdirSync(path.join(root, "sources")); mkdirSync(path.join(root, "assets")); mkdirSync(path.join(root, "approvals"));
  writeFileSync(path.join(root, "run-state.json"), "{}");
  writeFileSync(path.join(root, "weekly-strategy-brief.json"), "{}");
  const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
  const pieces = [...EXPECTED_SLOTS].sort().map((slot, index) => {
    const source = JSON.stringify({ slot }); writeFileSync(path.join(root, "sources", `${slot}.json`), source);
    const bodyHtml = slot.startsWith("checklist")
      ? `${"<h2>Workbook section</h2>".repeat(8)}${"<h3>Decision subsection</h3>".repeat(15)}${"<ul><li>☐ Check the record.</li></ul>".repeat(43)}${"<strong>Condition and bounded action.</strong>".repeat(76)}${"complete decision tool ".repeat(300)}`
      : `<p>Reader-facing body for ${slot} with enough content.</p>`;
    return { slotId: slot, deliverableId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, versionId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, formatFamily: slot.startsWith("gbp-") ? "google_business_profile_post" : slot.startsWith("checklist") ? "decision_tool" : "counsel_note", locale: slot.endsWith("-pt") ? "pt-BR" : "en-CA", destination: slot.startsWith("gbp-") ? "google_business_profile" : "firm_website", deliverableRole: slot.startsWith("gbp-") ? "gbp_post" : slot.startsWith("checklist") ? "lead_magnet_pdf" : "article", title: `Title for ${slot}`, description: `Description for ${slot}`, bodyHtml, source: { path: `sources/${slot}.json`, sha256: sha(source) }, bodySha256: sha(bodyHtml), contentKind: "text", publicationPath: null, ctaTargetPath: null };
  });
  const assets = Array.from({ length: 9 }, (_, index) => {
    const bytes = Buffer.from(`asset-${index}`); writeFileSync(path.join(root, "assets", `${index}.png`), bytes);
    return { assetId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, localPath: `assets/${index}.png`, sha256: sha(bytes), mimeType: "image/png", byteSize: bytes.length, width: 1200, height: 900, storagePath: `deliverables/00000000-0000-4000-8000-000000000001/drg-test/${sha(bytes)}-${index}.png`, textPolicy: "text_bearing", overlayLanguage: "en", placements: [{ slotId: [...EXPECTED_SLOTS][index], role: "gbp_card", databaseRole: "gbp_card", packageAssetId: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, destination: "website", locale: "en-CA" }] };
  });
  const approval = "{}"; writeFileSync(path.join(root, "approvals", "a.json"), approval); writeFileSync(path.join(root, "approvals", "b.json"), approval);
  const strategyBrief = { readerAndSituation: "A real reader in a real situation.", workSupported: "A defined desired legal service.", whyThisWeek: "No dated trigger was verified.", practicalAngle: "Prepare actual documents for review.", authorityAndEvidence: "Official primary authority supports the law.", websiteAndConversionRole: "A specific query leads to a qualified review decision." };
  const placementContract = loadPinnedPlacementContract();
  const bundle: any = { schemaVersion: "drg-deployment-bundle-v1", placementContract: { contractVersion: placementContract.contract.contractVersion, canonicalSha256: placementContract.canonicalSha256 }, placementPurpose: "operator_review", contentApprovalStatus: "pending", deploymentKey: "drg-test", deploymentReceiptId: "60000000-0000-4000-8000-000000000001", packageEventId: "70000000-0000-4000-8000-000000000001", operationId: "80000000-0000-4000-8000-000000000001", firmId: "00000000-0000-4000-8000-000000000001", operatorWeekNumber: 5, calendarKey: "2026-W33", runId: "DRG-TEST", contentVersion: "v1", sourcePackage: { path: "run-state.json", sha256: sha("{}") }, authority: { releaseId: "DRG-LAW-CSB-4.22", sha256: "0ea34d352d875e030458e96fdd73b23053f32067477b250ac1895d378bbd6ed3" }, period: { id: "30000000-0000-4000-8000-000000000001", strategyBrief, strategyBriefSource: { path: "weekly-strategy-brief.json", sha256: sha("{}") } }, publishingPackageId: "40000000-0000-4000-8000-000000000001", pieces, assets, approvalEvidence: [{ approvalId: "aaaa", source: { path: "approvals/a.json", sha256: sha(approval) }, decision: "approved", scope: assets.map((x) => x.assetId) }, { approvalId: "bbbb", source: { path: "approvals/b.json", sha256: sha(approval) }, decision: "approved", scope: assets.map((x) => x.assetId) }], writeAllowlist: { tables: ["content_periods", "content_deliverables", "deliverable_versions", "publishing_packages", "publishing_package_assets", "publishing_package_events", "drg_content_deployments"], storageBucket: "firm-files", storagePrefix: "deliverables/00000000-0000-4000-8000-000000000001/drg-test/", maxWrites: 80 }, publicationAuthorized: false };
  const bundlePath = path.join(root, "bundle.json"); writeFileSync(bundlePath, JSON.stringify(bundle));
  return { root, bundle, bundlePath };
}

function readOnlySupabaseFixture(bundle: any, deploymentOverrides: Record<string, unknown> = {}) {
  const rows: Record<string, unknown> = {
    drg_content_deployments: {
      id: bundle.deploymentReceiptId,
      bundle_sha256: "file-sha",
      bundle_canonical_sha256: "canonical-sha",
      period_id: bundle.period.id,
      package_id: bundle.publishingPackageId,
      receipt: { publication_authorized: false },
      ...deploymentOverrides,
    },
    content_periods: { id: bundle.period.id, week_number: bundle.operatorWeekNumber },
    content_deliverables: bundle.pieces.map((piece: any) => ({
      id: piece.deliverableId,
      current_version_id: piece.versionId,
      period_id: bundle.period.id,
      status: "in_review",
      published_at: null,
    })),
    publishing_package_assets: bundle.assets.map((asset: any) => ({ sha256: asset.sha256 })),
  };
  return {
    from(table: string) {
      const result = { data: rows[table], error: null };
      const query: any = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => result,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
      };
      return query;
    },
  } as any;
}

describe("DR-122 deployment bundle", () => {
  it("limits the historical Week 7 verification exception to the exact key and two hashes", () => {
    const exactBundle = { deploymentKey: LEGACY_WEEK_7_EXISTING_VERIFICATION.deploymentKey };
    expect(isExactLegacyWeek7ExistingVerification(
      exactBundle,
      LEGACY_WEEK_7_EXISTING_VERIFICATION.fileSha256,
      LEGACY_WEEK_7_EXISTING_VERIFICATION.canonicalSha256,
    )).toBe(true);
    expect(isExactLegacyWeek7ExistingVerification(
      exactBundle,
      `0${LEGACY_WEEK_7_EXISTING_VERIFICATION.fileSha256.slice(1)}`,
      LEGACY_WEEK_7_EXISTING_VERIFICATION.canonicalSha256,
    )).toBe(false);
    expect(isExactLegacyWeek7ExistingVerification(
      { deploymentKey: `${LEGACY_WEEK_7_EXISTING_VERIFICATION.deploymentKey}-other` },
      LEGACY_WEEK_7_EXISTING_VERIFICATION.fileSha256,
      LEGACY_WEEK_7_EXISTING_VERIFICATION.canonicalSha256,
    )).toBe(false);
  });

  it("verifies an existing deployment read-only without a fresh authorization", async () => {
    const { bundle } = fixture();
    const report = await verifyExistingDeployment(readOnlySupabaseFixture(bundle), bundle, "file-sha", "canonical-sha");
    expect(report).toMatchObject({
      status: "existing_deployment_verified",
      writes: 0,
      replayWrites: 0,
      deliverables: 16,
      assets: 9,
      publicationAuthorized: false,
    });
  });

  it("rejects stored hash drift during existing-deployment verification", async () => {
    const { bundle } = fixture();
    await expect(verifyExistingDeployment(
      readOnlySupabaseFixture(bundle, { bundle_canonical_sha256: "different" }),
      bundle,
      "file-sha",
      "canonical-sha",
    )).rejects.toThrow(/stored deployment canonical hash mismatch/);
  });

  it("runs an offline zero-write preflight bound to the pinned placement contract", () => {
    const { root, bundlePath } = fixture();
    const report = preflightDeploymentBundle(bundlePath, root);
    expect(report).toMatchObject({
      status: "preflight_passed",
      writesPerformed: 0,
      pieces: 16,
      assets: 9,
      placementPurpose: "operator_review",
      contentApprovalStatus: "pending",
      publicationAuthorized: false,
    });
    const pinned = loadPinnedPlacementContract();
    expect(report.placementContract).toEqual({
      contractVersion: pinned.contract.contractVersion,
      canonicalSha256: pinned.canonicalSha256,
    });
  });

  it("rejects a missing, drifted, or mis-versioned placement contract binding", () => {
    const { root, bundle, bundlePath } = fixture();
    delete bundle.placementContract;
    writeFileSync(bundlePath, JSON.stringify(bundle));
    expect(() => loadAndValidateBundle(bundlePath, root)).toThrow(/placement contract version\/hash/);

    bundle.placementContract = { contractVersion: "drg-review-placement-contract-v0", canonicalSha256: "0".repeat(64) };
    writeFileSync(bundlePath, JSON.stringify(bundle));
    expect(() => loadAndValidateBundle(bundlePath, root)).toThrow(/placement contract version\/hash/);
  });

  it("accepts the legacy review table and rejects iframe and raw Markdown Checklist bodies", () => {
    const { root, bundle, bundlePath } = fixture();
    const checklist = bundle.pieces.find((piece: any) => piece.slotId === "checklist-en");
    checklist.bodyHtml = `<section data-review-table="true"><h2>Section</h2><h3>Decision</h3><ul><li>Review</li></ul></section>${"complete review content ".repeat(300)}`;
    checklist.bodySha256 = createHash("sha256").update(checklist.bodyHtml).digest("hex");
    writeFileSync(bundlePath, JSON.stringify(bundle));
    expect(() => loadAndValidateBundle(bundlePath, root)).not.toThrow();

    checklist.bodyHtml += "<IFRAME src=\"file.pdf\"></IFRAME>";
    checklist.bodySha256 = createHash("sha256").update(checklist.bodyHtml).digest("hex");
    writeFileSync(bundlePath, JSON.stringify(bundle));
    expect(() => loadAndValidateBundle(bundlePath, root)).toThrow(/forbidden Checklist review substring/);

    checklist.bodyHtml = checklist.bodyHtml.replace(/<IFRAME[\s\S]*<\/IFRAME>/, "") + "\n## Raw Markdown";
    checklist.bodySha256 = createHash("sha256").update(checklist.bodyHtml).digest("hex");
    writeFileSync(bundlePath, JSON.stringify(bundle));
    expect(() => loadAndValidateBundle(bundlePath, root)).toThrow(/raw Markdown/);
  });

  it("accepts exact current and historical authority pairs but rejects mixed pins", () => {
    const { root, bundle, bundlePath } = fixture();

    expect(() => loadAndValidateBundle(bundlePath, root)).not.toThrow();

    bundle.authority = {
      releaseId: "DRG-LAW-CSB-4.26",
      sha256: "817dc22c9480a6a74051b7a36c1b616dc1eff7ef9d43265c15110167d58ece2c",
    };
    writeFileSync(bundlePath, JSON.stringify(bundle));
    expect(() => loadAndValidateBundle(bundlePath, root)).not.toThrow();

    bundle.authority.sha256 = "0ea34d352d875e030458e96fdd73b23053f32067477b250ac1895d378bbd6ed3";
    writeFileSync(bundlePath, JSON.stringify(bundle));
    expect(() => loadAndValidateBundle(bundlePath, root)).toThrow(/wrong authority release\/hash pair/);

    bundle.authority = {
      releaseId: "DRG-LAW-CSB-4.22",
      sha256: "817dc22c9480a6a74051b7a36c1b616dc1eff7ef9d43265c15110167d58ece2c",
    };
    writeFileSync(bundlePath, JSON.stringify(bundle));
    expect(() => loadAndValidateBundle(bundlePath, root)).toThrow(/wrong authority release\/hash pair/);
  });

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
