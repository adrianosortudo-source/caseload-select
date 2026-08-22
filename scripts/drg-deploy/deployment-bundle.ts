/* eslint-disable @typescript-eslint/no-explicit-any -- deployment bundles are validated external JSON */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

export const EXPECTED_SLOTS = new Set([
  "counsel-note-en", "counsel-note-pt", "clause-en", "clause-pt", "minute-en",
  "gbp-counsel-note-en", "gbp-clause-en", "gbp-checklist-en",
  "lead-magnet-en", "lead-magnet-pt", "checklist-en", "checklist-pt",
  "linkedin-counsel-note-en", "linkedin-clause-en",
  "linkedin-post-counsel-note-en", "linkedin-post-clause-en",
]);
const HERO_SIGNED_URL_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;
const EXPECTED_TABLES = new Set(["content_periods", "content_deliverables", "deliverable_versions", "publishing_packages", "publishing_package_assets", "publishing_package_events", "drg_content_deployments"]);
const TRUSTED_AUTHORITY_PAIRS = new Map([
  ["DRG-LAW-CSB-4.26", "817dc22c9480a6a74051b7a36c1b616dc1eff7ef9d43265c15110167d58ece2c"],
  // Retained for byte-identical replay/proof of bundles created before 4.26.
  ["DRG-LAW-CSB-4.22", "0ea34d352d875e030458e96fdd73b23053f32067477b250ac1895d378bbd6ed3"],
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DeploymentBundle = Record<string, any>;
export type ExecutionAuthorization = Record<string, any>;
export type DeploymentHashes = { bundleFileSha256: string; bundleCanonicalSha256: string; authorizationSha256: string };

const PLACEMENT_CONTRACT_PATH = path.resolve(__dirname, "contracts/review-placement-contract.v1.json");
export const PINNED_PLACEMENT_CONTRACT_VERSION = "drg-review-placement-contract-v1";
export const PINNED_PLACEMENT_CONTRACT_CANONICAL_SHA256 = "22dddb194ccafddd2c1c820cb84b7c7f4214d04851cacd19c17eafeab3fc8369";
export const LEGACY_WEEK_7_EXISTING_VERIFICATION = Object.freeze({
  deploymentKey: "drg-2026-w35-v14-operator-review",
  fileSha256: "d70bda8c7ca32e0736bc820cd1c7fbf5c9a71bae45451740bdea9399deebb953",
  canonicalSha256: "0f6ef5048612055945fbc1dc16054754b366de706cc733014448efa549f38104",
});

type ReviewPlacementContract = {
  contractVersion: string;
  bundleSchemaVersion: string;
  placementPurpose: string;
  contentApprovalStatus: string;
  publicationAuthorized: boolean;
  expectedPieceCount: number;
  minimumAssetCount: number;
  decisionTool: {
    contentKind: string;
    minBodyLength: number;
    requiredHtmlMarkers: string[];
    legacyReviewTableMarker: string;
    guidedWorkbookMinimumCounts: Record<"h2" | "h3" | "ul" | "checkbox" | "strong", number>;
    forbiddenCaseInsensitiveSubstrings: string[];
    forbiddenRawMarkdownPattern: string;
  };
};

export function sha256Bytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hasCompleteDecisionToolStructure(body: string, contract: ReviewPlacementContract): boolean {
  if (body.includes(contract.decisionTool.legacyReviewTableMarker)) return true;
  const count = (marker: string) => body.split(marker).length - 1;
  const minimums = contract.decisionTool.guidedWorkbookMinimumCounts;
  return count("<h2>") >= minimums.h2
    && count("<h3>") >= minimums.h3
    && count("<ul>") >= minimums.ul
    && count("☐") >= minimums.checkbox
    && count("<strong>") >= minimums.strong;
}

function sortValue(value: any): any {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

export function canonicalJsonSha256(value: any): string {
  return sha256Bytes(JSON.stringify(sortValue(value)));
}

export function loadPinnedPlacementContract(): { contract: ReviewPlacementContract; canonicalSha256: string } {
  const contract = JSON.parse(readFileSync(PLACEMENT_CONTRACT_PATH, "utf8")) as ReviewPlacementContract;
  const canonicalSha256 = canonicalJsonSha256(contract);
  if (contract.contractVersion !== PINNED_PLACEMENT_CONTRACT_VERSION) {
    throw new Error(`local placement contract version is not pinned: ${contract.contractVersion ?? "missing"}`);
  }
  if (canonicalSha256 !== PINNED_PLACEMENT_CONTRACT_CANONICAL_SHA256) {
    throw new Error(`local placement contract hash is not pinned: ${canonicalSha256}`);
  }
  return { contract, canonicalSha256 };
}

function safePath(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`path escapes package root: ${relative}`);
  }
  return resolved;
}

type BundleValidationOptions = { allowExactLegacyWeek7ExistingVerification?: boolean };

export function isExactLegacyWeek7ExistingVerification(bundle: DeploymentBundle, fileSha256: string, canonicalSha256: string): boolean {
  return bundle.deploymentKey === LEGACY_WEEK_7_EXISTING_VERIFICATION.deploymentKey
    && fileSha256 === LEGACY_WEEK_7_EXISTING_VERIFICATION.fileSha256
    && canonicalSha256 === LEGACY_WEEK_7_EXISTING_VERIFICATION.canonicalSha256;
}

function loadAndValidateBundleInternal(bundlePath: string, packageRoot: string, options: BundleValidationOptions = {}): { bundle: DeploymentBundle; fileSha256: string; canonicalSha256: string } {
  const raw = readFileSync(bundlePath);
  const bundle = JSON.parse(raw.toString("utf8"));
  const fileSha256 = sha256Bytes(raw);
  const canonicalSha256 = canonicalJsonSha256(bundle);
  const placementContract = loadPinnedPlacementContract();
  const contract = placementContract.contract;
  const exactLegacyWeek7Verification = options.allowExactLegacyWeek7ExistingVerification === true
    && isExactLegacyWeek7ExistingVerification(bundle, fileSha256, canonicalSha256);
  const errors: string[] = [];
  if (!exactLegacyWeek7Verification && (bundle.placementContract?.contractVersion !== contract.contractVersion
    || bundle.placementContract?.canonicalSha256 !== placementContract.canonicalSha256)) {
    errors.push("bundle placement contract version/hash does not match the portal pin");
  }
  if (bundle.schemaVersion !== contract.bundleSchemaVersion) errors.push("unsupported schemaVersion");
  if (bundle.placementPurpose !== contract.placementPurpose) errors.push(`placementPurpose must be ${contract.placementPurpose}`);
  if (bundle.contentApprovalStatus !== contract.contentApprovalStatus) errors.push(`contentApprovalStatus must be ${contract.contentApprovalStatus}`);
  if (bundle.publicationAuthorized !== contract.publicationAuthorized) errors.push(`publicationAuthorized must be ${contract.publicationAuthorized}`);
  const trustedAuthoritySha256 = TRUSTED_AUTHORITY_PAIRS.get(bundle.authority?.releaseId);
  if (!trustedAuthoritySha256 || bundle.authority?.sha256 !== trustedAuthoritySha256) errors.push("wrong authority release/hash pair");
  for (const field of ["deploymentReceiptId", "packageEventId", "operationId"]) {
    if (!UUID_RE.test(bundle[field] ?? "")) errors.push(`${field} must be a deterministic UUID`);
  }
  const briefKeys = ["readerAndSituation", "workSupported", "whyThisWeek", "practicalAngle", "authorityAndEvidence", "websiteAndConversionRole"];
  if (!bundle.period?.strategyBrief || Object.keys(bundle.period.strategyBrief).sort().join("|") !== [...briefKeys].sort().join("|")) errors.push("period strategyBrief must contain the exact six strategic-record fields");
  if (JSON.stringify(bundle).includes("\uFFFD")) errors.push("Unicode replacement characters are forbidden");
  if (!Array.isArray(bundle.pieces) || bundle.pieces.length !== contract.expectedPieceCount) errors.push(`exactly ${contract.expectedPieceCount} pieces are required`);
  if (!Array.isArray(bundle.assets) || bundle.assets.length < contract.minimumAssetCount) errors.push(`at least ${contract.minimumAssetCount} approved assets are required`);
  const slots = new Set((bundle.pieces ?? []).map((piece: any) => piece.slotId));
  if (slots.size !== 16 || [...EXPECTED_SLOTS].some((slot) => !slots.has(slot))) errors.push("piece registry does not match the canonical sixteen slots");
  const ids = (bundle.pieces ?? []).flatMap((piece: any) => [piece.deliverableId, piece.versionId]);
  if (new Set(ids).size !== ids.length) errors.push("deliverable/version IDs must be unique");
  const assetIds = (bundle.assets ?? []).map((asset: any) => asset.assetId);
  if (new Set(assetIds).size !== assetIds.length) errors.push("asset IDs must be unique");
  const packageAssetIds = (bundle.assets ?? []).flatMap((asset: any) => (asset.placements ?? []).map((placement: any) => placement.packageAssetId).filter(Boolean));
  if (new Set(packageAssetIds).size !== packageAssetIds.length) errors.push("materialized package asset IDs must be unique");
  const globallyBoundIds = [bundle.period?.id, bundle.publishingPackageId, bundle.deploymentReceiptId, bundle.packageEventId, bundle.operationId, ...ids, ...assetIds, ...packageAssetIds];
  if (globallyBoundIds.some((value) => !UUID_RE.test(value ?? "")) || new Set(globallyBoundIds).size !== globallyBoundIds.length) errors.push("all deterministic deployment IDs must be valid and globally unique");

  for (const piece of bundle.pieces ?? []) {
    if (sha256Bytes(piece.bodyHtml) !== piece.bodySha256) errors.push(`${piece.slotId}: body hash mismatch`);
    const source = safePath(packageRoot, piece.source.path);
    if (!existsSync(source) || !statSync(source).isFile() || sha256Bytes(readFileSync(source)) !== piece.source.sha256) errors.push(`${piece.slotId}: source hash mismatch`);
    if (piece.formatFamily === "decision_tool") {
      if (piece.contentKind !== contract.decisionTool.contentKind) errors.push(`${piece.slotId}: Checklist must be a complete text deliverable, with its PDF attached separately`);
      if (typeof piece.bodyHtml !== "string" || piece.bodyHtml.length < contract.decisionTool.minBodyLength) errors.push(`${piece.slotId}: Checklist review body is incomplete`);
      for (const marker of contract.decisionTool.requiredHtmlMarkers) {
        if (!piece.bodyHtml.includes(marker)) errors.push(`${piece.slotId}: Checklist review body is missing ${marker}`);
      }
      if (!hasCompleteDecisionToolStructure(piece.bodyHtml, contract)) errors.push(`${piece.slotId}: Checklist review body is missing the legacy review table or guided-workbook decision structure`);
      const lowerBody = piece.bodyHtml.toLowerCase();
      for (const forbidden of contract.decisionTool.forbiddenCaseInsensitiveSubstrings) {
        if (lowerBody.includes(forbidden.toLowerCase())) errors.push(`${piece.slotId}: forbidden Checklist review substring ${forbidden}`);
      }
      const rawMarkdownPattern = contract.decisionTool.forbiddenRawMarkdownPattern.replace(/^\(\?m\)/, "");
      if (new RegExp(rawMarkdownPattern, "m").test(piece.bodyHtml)) errors.push(`${piece.slotId}: raw Markdown leaked into Checklist review HTML`);
    }
  }
  const approved = new Set((bundle.approvalEvidence ?? []).flatMap((item: any) => item.decision === "approved" ? item.scope : []));
  for (const approval of bundle.approvalEvidence ?? []) {
    const source = safePath(packageRoot, approval.source.path);
    if (!existsSync(source) || !statSync(source).isFile() || sha256Bytes(readFileSync(source)) !== approval.source.sha256) errors.push(`${approval.approvalId}: approval hash mismatch`);
  }
  const expectedPrefix = `deliverables/${bundle.firmId}/${bundle.deploymentKey}/`;
  if (bundle.writeAllowlist?.storageBucket !== "firm-files" || bundle.writeAllowlist?.storagePrefix !== expectedPrefix) errors.push("storage allowlist is not bound to firm and deployment key");
  const tables = new Set(bundle.writeAllowlist?.tables ?? []);
  if (tables.size !== EXPECTED_TABLES.size || [...EXPECTED_TABLES].some((table) => !tables.has(table))) errors.push("write table allowlist does not match the canonical deployment set");
  for (const asset of bundle.assets ?? []) {
    const local = safePath(packageRoot, asset.localPath);
    if (!existsSync(local) || !statSync(local).isFile()) errors.push(`${asset.assetId}: asset file missing`);
    else {
      if (sha256Bytes(readFileSync(local)) !== asset.sha256) errors.push(`${asset.assetId}: asset hash mismatch`);
      if (statSync(local).size !== asset.byteSize) errors.push(`${asset.assetId}: asset byte size mismatch`);
    }
    if (!asset.storagePath.startsWith(bundle.writeAllowlist.storagePrefix)) errors.push(`${asset.assetId}: storage path outside allowlist`);
    if (!approved.has(asset.assetId)) errors.push(`${asset.assetId}: asset is not in exact approval scope`);
    for (const placement of asset.placements ?? []) {
      if ((placement.packageAssetId == null) !== (placement.databaseRole == null)) errors.push(`${asset.assetId}: packageAssetId and databaseRole must both be set or both be null`);
    }
  }
  const bindings = [bundle.sourcePackage, bundle.period?.strategyBriefSource];
  for (const [index, binding] of bindings.entries()) {
    if (!binding?.path || !binding?.sha256) { errors.push(index === 0 ? "source package binding missing" : "strategy brief source binding missing"); continue; }
    const source = safePath(packageRoot, binding.path);
    if (!existsSync(source) || sha256Bytes(readFileSync(source)) !== binding.sha256) errors.push(index === 0 ? "source package hash mismatch" : "strategy brief source hash mismatch");
  }
  if (errors.length) throw new Error(errors.join("; "));
  return { bundle, fileSha256, canonicalSha256 };
}

export function loadAndValidateBundle(bundlePath: string, packageRoot: string): { bundle: DeploymentBundle; fileSha256: string; canonicalSha256: string } {
  return loadAndValidateBundleInternal(bundlePath, packageRoot);
}

export function loadBundleForExistingVerification(bundlePath: string, packageRoot: string): { bundle: DeploymentBundle; fileSha256: string; canonicalSha256: string } {
  return loadAndValidateBundleInternal(bundlePath, packageRoot, { allowExactLegacyWeek7ExistingVerification: true });
}

export function preflightDeploymentBundle(bundlePath: string, packageRoot: string) {
  const loaded = loadAndValidateBundle(bundlePath, packageRoot);
  const placementContract = loadPinnedPlacementContract();
  return {
    status: "preflight_passed",
    writesPerformed: 0,
    bundleFileSha256: loaded.fileSha256,
    bundleCanonicalSha256: loaded.canonicalSha256,
    placementContract: {
      contractVersion: placementContract.contract.contractVersion,
      canonicalSha256: placementContract.canonicalSha256,
    },
    pieces: loaded.bundle.pieces.length,
    assets: loaded.bundle.assets.length,
    placementPurpose: loaded.bundle.placementPurpose,
    contentApprovalStatus: loaded.bundle.contentApprovalStatus,
    publicationAuthorized: loaded.bundle.publicationAuthorized,
  };
}

export function touchedTargets(bundle: DeploymentBundle): { ids: Set<string>; records: Set<string>; plannedWrites: number } {
  const ids = new Set<string>([bundle.period.id, bundle.publishingPackageId, bundle.deploymentReceiptId, bundle.packageEventId, bundle.operationId]);
  const records = new Set<string>([
    `content_periods:${bundle.period.id}`,
    `publishing_packages:${bundle.publishingPackageId}`,
    `publishing_package_events:${bundle.packageEventId}`,
    `drg_content_deployments:${bundle.deploymentReceiptId}`,
  ]);
  for (const piece of bundle.pieces) {
    ids.add(piece.deliverableId); ids.add(piece.versionId);
    records.add(`content_deliverables:${piece.deliverableId}`); records.add(`deliverable_versions:${piece.versionId}`);
  }
  for (const asset of bundle.assets) {
    ids.add(asset.assetId);
    records.add(`storage:${bundle.writeAllowlist.storageBucket}:${asset.storagePath}`);
    for (const placement of asset.placements ?? []) {
      if (placement.packageAssetId) { ids.add(placement.packageAssetId); records.add(`publishing_package_assets:${placement.packageAssetId}`); }
    }
  }
  return { ids, records, plannedWrites: bundle.writeAllowlist.maxWrites };
}

export function validateAuthorization(auth: ExecutionAuthorization, bundle: DeploymentBundle, canonicalSha256: string, now = new Date()): string {
  if (auth.operation !== "deliverables_publishing_kit_placement") throw new Error("authorization operation mismatch");
  if (auth.planSha256 !== canonicalSha256) throw new Error("authorization plan hash mismatch");
  if (new Date(auth.expiresAt).getTime() <= now.getTime()) throw new Error("authorization expired");
  const touched = touchedTargets(bundle);
  const allowedIds = new Set<string>((auth.allowedTargetIds ?? []) as string[]);
  const allowedRecords = new Set<string>((auth.allowedDestinationRecords ?? []) as string[]);
  const extraIds = [...touched.ids].filter((id) => !allowedIds.has(id));
  const extraRecords = [...touched.records].filter((record) => !allowedRecords.has(record));
  const unusedIds = [...allowedIds].filter((id) => !touched.ids.has(id));
  const unusedRecords = [...allowedRecords].filter((record) => !touched.records.has(record));
  if (extraIds.length) throw new Error(`authorization misses target ids: ${extraIds.join(",")}`);
  if (extraRecords.length) throw new Error(`authorization misses destination records: ${extraRecords.join(",")}`);
  if (unusedIds.length) throw new Error(`authorization contains targets outside the exact deployment plan: ${unusedIds.join(",")}`);
  if (unusedRecords.length) throw new Error(`authorization contains destinations outside the exact deployment plan: ${unusedRecords.join(",")}`);
  if (touched.plannedWrites > auth.maxWriteCount) throw new Error("authorization write cap is below bundle plan");
  return canonicalJsonSha256(auth);
}

export function assertExistingDeploymentMatch(existing: any, hashes: DeploymentHashes): void {
  if (!existing) return;
  if (existing.bundle_sha256 !== hashes.bundleFileSha256 || existing.bundle_canonical_sha256 !== hashes.bundleCanonicalSha256 || existing.authorization_sha256 !== hashes.authorizationSha256) {
    throw new Error("deployment key already exists with different bundle bytes or authorization content hash");
  }
}

export async function prepareDeployment(supabase: SupabaseClient, bundle: DeploymentBundle, hashes?: DeploymentHashes) {
  const { data: existing, error } = await supabase.from("drg_content_deployments").select("id,bundle_sha256,bundle_canonical_sha256,authorization_sha256,writes_performed,receipt").eq("firm_id", bundle.firmId).eq("deployment_key", bundle.deploymentKey).maybeSingle();
  if (error) throw new Error(`deployment lookup failed: ${error.message}`);
  if (existing && hashes) assertExistingDeploymentMatch(existing, hashes);
  const { data: collision, error: collisionError } = await supabase.from("content_periods").select("id,week_number").eq("firm_id", bundle.firmId).eq("week_number", bundle.operatorWeekNumber).maybeSingle();
  if (collisionError) throw new Error(`period collision lookup failed: ${collisionError.message}`);
  if (collision && collision.id !== bundle.period.id) throw new Error("operator week number already belongs to another period");
  return { status: existing ? "existing" : "ready", writesPerformed: 0, existing, periodCollision: collision };
}

export async function uploadApprovedAssets(supabase: SupabaseClient, bundle: DeploymentBundle, packageRoot: string) {
  const bucket = bundle.writeAllowlist.storageBucket;
  const urls: Record<string, string> = {};
  let writes = 0;
  for (const asset of bundle.assets) {
    const bytes = readFileSync(safePath(packageRoot, asset.localPath));
    const { data: existing } = await supabase.storage.from(bucket).download(asset.storagePath);
    if (existing) {
      const existingBytes = Buffer.from(await existing.arrayBuffer());
      if (sha256Bytes(existingBytes) !== asset.sha256) throw new Error(`immutable storage collision at ${asset.storagePath}`);
    } else {
      const { error: uploadError } = await supabase.storage.from(bucket).upload(asset.storagePath, bytes, { contentType: asset.mimeType, upsert: false });
      if (uploadError) throw new Error(`asset upload failed for ${asset.storagePath}: ${uploadError.message}`);
      writes += 1;
    }
    if (asset.mimeType === "image/png") {
      const { data: signed, error: signedError } = await supabase.storage.from(bucket).createSignedUrl(asset.storagePath, HERO_SIGNED_URL_TTL_SECONDS);
      if (signedError || !signed?.signedUrl) throw new Error(`signed URL failed for ${asset.storagePath}`);
      for (const placement of asset.placements) urls[placement.slotId] ??= signed.signedUrl;
    }
  }
  return { storageWrites: writes, urls };
}

export async function applyDeployment(supabase: SupabaseClient, bundle: DeploymentBundle, bundleFileSha256: string, bundleCanonicalSha256: string, authorization: ExecutionAuthorization, authorizationSha256: string, packageRoot: string) {
  const prepared = await prepareDeployment(supabase, bundle, { bundleFileSha256, bundleCanonicalSha256, authorizationSha256 });
  if (prepared.status === "existing") return { status: "verified_noop", writesPerformed: 0, storageWrites: 0, totalWrites: 0, receipt: prepared.existing?.receipt };
  const uploaded = await uploadApprovedAssets(supabase, bundle, packageRoot);
  const { data, error } = await supabase.rpc("apply_drg_content_deployment", { p_bundle: bundle, p_bundle_sha256: bundleFileSha256, p_bundle_canonical_sha256: bundleCanonicalSha256, p_authorization: authorization, p_authorization_sha256: authorizationSha256, p_storage_urls: uploaded.urls });
  if (error) throw new Error(`deployment RPC failed: ${error.message}`);
  return { ...data, storageWrites: uploaded.storageWrites, totalWrites: Number(data.writesPerformed ?? 0) + uploaded.storageWrites };
}

export async function proveDeployment(supabase: SupabaseClient, bundle: DeploymentBundle, bundleFileSha256: string) {
  const { data: deployment, error } = await supabase.from("drg_content_deployments").select("*").eq("firm_id", bundle.firmId).eq("deployment_key", bundle.deploymentKey).maybeSingle();
  if (error || !deployment) throw new Error(`deployment receipt missing: ${error?.message ?? "not found"}`);
  if (deployment.bundle_sha256 !== bundleFileSha256) throw new Error("stored deployment bundle hash mismatch");
  const { data: period } = await supabase.from("content_periods").select("id,week_number").eq("id", bundle.period.id).maybeSingle();
  const { data: deliverables } = await supabase.from("content_deliverables").select("id,current_version_id,period_id,status,published_at").eq("period_id", bundle.period.id);
  const { data: assets } = await supabase.from("publishing_package_assets").select("sha256,storage_key,content_slot_id,asset_role,destination").eq("package_id", bundle.publishingPackageId);
  if (!period || period.week_number !== bundle.operatorWeekNumber) throw new Error("period proof failed");
  if ((deliverables ?? []).length !== 16) throw new Error(`deliverables proof expected 16, found ${(deliverables ?? []).length}`);
  if ((deliverables ?? []).some((row: any) => row.published_at || row.status === "approved")) throw new Error("placement incorrectly claimed publication or approval");
  const expectedShas = new Set(bundle.assets.map((asset: any) => asset.sha256));
  const observedShas = new Set((assets ?? []).map((asset: any) => asset.sha256));
  if ([...expectedShas].some((value) => !observedShas.has(value))) throw new Error("Publishing Kit asset proof is incomplete");
  return { status: "proved", writesPerformed: 0, deploymentId: deployment.id, periodId: period.id, deliverables: 16, distinctAssetHashes: observedShas.size, publicationAuthorized: false };
}

export async function verifyExistingDeployment(supabase: SupabaseClient, bundle: DeploymentBundle, bundleFileSha256: string, bundleCanonicalSha256: string) {
  if (bundle.publicationAuthorized !== false) throw new Error("existing deployment verification requires publicationAuthorized=false");

  const { data: deployment, error: deploymentError } = await supabase
    .from("drg_content_deployments")
    .select("id,bundle_sha256,bundle_canonical_sha256,period_id,package_id,receipt")
    .eq("firm_id", bundle.firmId)
    .eq("deployment_key", bundle.deploymentKey)
    .maybeSingle();
  if (deploymentError || !deployment) throw new Error(`deployment receipt missing: ${deploymentError?.message ?? "not found"}`);
  if (deployment.bundle_sha256 !== bundleFileSha256) throw new Error("stored deployment bundle file hash mismatch");
  if (deployment.bundle_canonical_sha256 !== bundleCanonicalSha256) throw new Error("stored deployment canonical hash mismatch");
  if (deployment.period_id !== bundle.period.id || deployment.package_id !== bundle.publishingPackageId) throw new Error("stored deployment period/package binding mismatch");
  if (deployment.receipt?.publication_authorized !== false) throw new Error("stored deployment receipt does not prove publicationAuthorized=false");

  const { data: period, error: periodError } = await supabase
    .from("content_periods")
    .select("id,week_number")
    .eq("id", bundle.period.id)
    .maybeSingle();
  if (periodError || !period || period.week_number !== bundle.operatorWeekNumber) throw new Error(`period proof failed: ${periodError?.message ?? "not found or mismatched"}`);

  const { data: deliverables, error: deliverablesError } = await supabase
    .from("content_deliverables")
    .select("id,current_version_id,period_id,status,published_at")
    .eq("period_id", bundle.period.id);
  if (deliverablesError) throw new Error(`deliverables proof failed: ${deliverablesError.message}`);
  const expectedVersions = new Map(bundle.pieces.map((piece: any) => [piece.deliverableId, piece.versionId]));
  if ((deliverables ?? []).length !== expectedVersions.size || expectedVersions.size !== 16) throw new Error(`deliverables proof expected 16, found ${(deliverables ?? []).length}`);
  for (const row of deliverables ?? []) {
    if (expectedVersions.get(row.id) !== row.current_version_id || row.period_id !== bundle.period.id) throw new Error("deliverables proof does not match the exact bundle IDs and versions");
    if (row.published_at || row.status === "approved") throw new Error("placement incorrectly claimed publication or approval");
  }

  const { data: assets, error: assetsError } = await supabase
    .from("publishing_package_assets")
    .select("sha256")
    .eq("package_id", bundle.publishingPackageId);
  if (assetsError) throw new Error(`Publishing Kit asset proof failed: ${assetsError.message}`);
  const expectedAssetShas = new Set<string>(bundle.assets.map((asset: any) => asset.sha256));
  const observedAssetShas = new Set<string>((assets ?? []).map((asset: any) => asset.sha256));
  if (expectedAssetShas.size !== bundle.assets.length
    || observedAssetShas.size !== expectedAssetShas.size
    || [...expectedAssetShas].some((sha) => !observedAssetShas.has(sha))) {
    throw new Error(`Publishing Kit asset proof expected ${expectedAssetShas.size} exact assets, found ${observedAssetShas.size}`);
  }

  return {
    status: "existing_deployment_verified",
    writes: 0,
    replayWrites: 0,
    deploymentId: deployment.id,
    periodId: period.id,
    deliverables: expectedVersions.size,
    assets: expectedAssetShas.size,
    bundleFileSha256,
    bundleCanonicalSha256,
    publicationAuthorized: false,
  };
}
