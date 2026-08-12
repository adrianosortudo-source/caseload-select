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
const AUTHORITY_SHA256 = "0ea34d352d875e030458e96fdd73b23053f32067477b250ac1895d378bbd6ed3";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DeploymentBundle = Record<string, any>;
export type ExecutionAuthorization = Record<string, any>;
export type DeploymentHashes = { bundleFileSha256: string; bundleCanonicalSha256: string; authorizationSha256: string };

export function sha256Bytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
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

function safePath(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`path escapes package root: ${relative}`);
  }
  return resolved;
}

export function loadAndValidateBundle(bundlePath: string, packageRoot: string): { bundle: DeploymentBundle; fileSha256: string; canonicalSha256: string } {
  const raw = readFileSync(bundlePath);
  const bundle = JSON.parse(raw.toString("utf8"));
  const errors: string[] = [];
  if (bundle.schemaVersion !== "drg-deployment-bundle-v1") errors.push("unsupported schemaVersion");
  if (bundle.publicationAuthorized !== false) errors.push("publicationAuthorized must be false");
  if (bundle.authority?.releaseId !== "DRG-LAW-CSB-4.22") errors.push("wrong authority release");
  if (bundle.authority?.sha256 !== AUTHORITY_SHA256) errors.push("wrong authority hash");
  for (const field of ["deploymentReceiptId", "packageEventId", "operationId"]) {
    if (!UUID_RE.test(bundle[field] ?? "")) errors.push(`${field} must be a deterministic UUID`);
  }
  const briefKeys = ["readerAndSituation", "workSupported", "whyThisWeek", "practicalAngle", "authorityAndEvidence", "websiteAndConversionRole"];
  if (!bundle.period?.strategyBrief || Object.keys(bundle.period.strategyBrief).sort().join("|") !== [...briefKeys].sort().join("|")) errors.push("period strategyBrief must contain the exact six strategic-record fields");
  if (JSON.stringify(bundle).includes("\uFFFD")) errors.push("Unicode replacement characters are forbidden");
  if (!Array.isArray(bundle.pieces) || bundle.pieces.length !== 16) errors.push("exactly 16 pieces are required");
  if (!Array.isArray(bundle.assets) || bundle.assets.length < 9) errors.push("at least 9 approved assets are required");
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
  return { bundle, fileSha256: sha256Bytes(raw), canonicalSha256: canonicalJsonSha256(bundle) };
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
