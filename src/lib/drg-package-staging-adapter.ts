import {
  canonicalJson,
  planDrgPackageStaging,
  projectReleaseAuthorizedDrgPublishingKit,
  reconcileDrgPackageStaging,
  type DrgPackageReleaseAuthorization,
  type DrgPackageReconciliation,
  type DrgPortalStagingSnapshot,
  type ReleaseAuthorizedPublishingKitProjection,
  type DrgStagingPlan,
  type SealedDrgWeeklyPackage,
  type Sha256Function,
} from "./drg-package-staging";

const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Authorizes one operator to execute the already-sealed staging operation.
 * It is deliberately not client release authorization and cannot be used as
 * publication evidence.
 */
export interface DrgPackageStagingExecutionAuthorization {
  readonly schemaVersion: "drg-package-staging-execution-authorization/v1";
  readonly executionAuthorizationId: string;
  readonly firmId: string;
  readonly periodId: string;
  readonly packageId: string;
  readonly packageVersion: number;
  readonly packageSha256: string;
  readonly operatorRole: "operator";
  readonly operatorId: string;
  readonly operatorName: string;
  readonly authorizedAt: string;
  readonly expiresAt: string;
}

export interface DrgPackageStagingExecutionAuthorizationEvidence extends DrgPackageStagingExecutionAuthorization {
  readonly signingKeyId: string;
  readonly signingPublicKeySha256: string;
  readonly authorizationEnvelopeSha256: string;
  readonly authorizationSignatureBase64: string;
}

export interface DrgStagingOperationReceipt {
  readonly schemaVersion: "drg-package-staging-execution-receipt/v1";
  readonly operationKind: "deliverables_staging";
  /** Always false: client release authorization is a later, separate gate. */
  readonly releaseAuthorizationGranted: false;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly executionAuthorizationId: string;
  readonly operatorRole: "operator";
  readonly operatorId: string;
  readonly operatorName: string;
  readonly signingKeyId: string;
  readonly signingPublicKeySha256: string;
  readonly authorizationEnvelopeSha256: string;
  readonly firmId: string;
  readonly periodId: string;
  readonly packageId: string;
  readonly packageVersion: number;
  readonly packageSha256: string;
  readonly committedAt: string;
  readonly addedCount: number;
  readonly newVersionCount: number;
  readonly skippedCount: number;
  readonly pieces: readonly {
    readonly pieceId: string;
    readonly action: "add" | "new_version" | "correct_skip";
    readonly deliverableId: string;
    readonly versionId: string;
    readonly versionNumber: number;
    readonly pieceSha256: string;
  }[];
  /** Zero on a replay; otherwise the number of piece versions changed. */
  readonly writesPerformed: number;
  readonly replay: boolean;
}

export type Sha256BytesFunction = (bytes: Uint8Array) => string;

export interface DrgPackageStagingRpcClient {
  rpc(
    functionName:
      | "stage_drg_weekly_package_atomic"
      | "read_drg_package_staging_snapshot"
      | "read_drg_pdf_storage_identities",
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export interface DrgPackageStorageClient {
  from(bucket: "firm-files"): {
    download(path: string): PromiseLike<{
      data: { arrayBuffer(): Promise<ArrayBuffer>; type: string } | null;
      error: { message?: string } | null;
    }>;
  };
}

export type AuthorizedDrgStagingResult =
  | {
      readonly status: "blocked";
      readonly plan: Extract<DrgStagingPlan, { kind: "no_plan" }>;
      readonly writesPerformed: 0;
    }
  | {
      readonly status: "reconciled";
      readonly plan: Extract<DrgStagingPlan, { kind: "atomic_plan" }>;
      readonly receipt: DrgStagingOperationReceipt;
      readonly snapshot: DrgPortalStagingSnapshot;
      readonly reconciliation: DrgPackageReconciliation & { readonly status: "exact_match" };
    };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function packageCanonicalInput(pkg: SealedDrgWeeklyPackage): string {
  return canonicalJson({
    schemaVersion: pkg.schemaVersion,
    packageId: pkg.packageId,
    packageVersion: pkg.packageVersion,
    firmId: pkg.firmId,
    periodId: pkg.periodId,
    sources: pkg.sources,
    doctrine: pkg.doctrine,
    pieces: pkg.pieces,
  });
}

function validateAuthorization(
  authorization: DrgPackageStagingExecutionAuthorization,
  pkg: SealedDrgWeeklyPackage,
  now: Date,
): void {
  if (authorization.schemaVersion !== "drg-package-staging-execution-authorization/v1") {
    throw new Error("unsupported DRG package staging execution authorization schema");
  }
  if (!authorization.executionAuthorizationId.trim()) throw new Error("staging execution authorization id is required");
  if (!UUID_RE.test(authorization.operatorId)) throw new Error("staging execution authorization requires an authenticated operator UUID");
  if (authorization.operatorRole !== "operator" || !authorization.operatorName.trim()) {
    throw new Error("staging execution authorization requires a named operator");
  }
  const legacyReleaseFields = authorization as unknown as Record<string, unknown>;
  if ("authorizerRole" in legacyReleaseFields || "authorizerId" in legacyReleaseFields || "authorizerName" in legacyReleaseFields) {
    throw new Error("staging execution authorization must not carry lawyer or client release authorization");
  }
  if (
    authorization.firmId !== pkg.firmId ||
    authorization.periodId !== pkg.periodId ||
    authorization.packageId !== pkg.packageId ||
    authorization.packageVersion !== pkg.packageVersion ||
    authorization.packageSha256 !== pkg.packageSha256
  ) {
    throw new Error("staging execution authorization is not bound to the exact package scope and SHA");
  }
  if (!SHA256_RE.test(authorization.packageSha256)) throw new Error("staging execution authorization package SHA-256 is malformed");
  const authorizedAt = Date.parse(authorization.authorizedAt);
  const expiresAt = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(authorizedAt) || !Number.isFinite(expiresAt) || expiresAt <= authorizedAt) {
    throw new Error("staging execution authorization timestamps are invalid");
  }
  if (authorizedAt > now.getTime() + 5 * 60_000) throw new Error("staging execution authorization timestamp is in the future");
  if (expiresAt <= now.getTime()) throw new Error("staging execution authorization has expired");
}

function parseSnapshot(data: unknown, pkg: SealedDrgWeeklyPackage): DrgPortalStagingSnapshot {
  const value = record(data);
  if (!value || value.firmId !== pkg.firmId || value.periodId !== pkg.periodId || !Array.isArray(value.deliverables)) {
    throw new Error("database returned a malformed or cross-scoped DRG staging snapshot");
  }
  return value as unknown as DrgPortalStagingSnapshot;
}

function parseReceipt(data: unknown, pkg: SealedDrgWeeklyPackage, authorization: DrgPackageStagingExecutionAuthorizationEvidence): DrgStagingOperationReceipt {
  const value = record(data);
  if (
    !value ||
    value.schemaVersion !== "drg-package-staging-execution-receipt/v1" ||
    value.operationKind !== "deliverables_staging" ||
    value.releaseAuthorizationGranted !== false ||
    value.executionAuthorizationId !== authorization.executionAuthorizationId ||
    value.operatorRole !== authorization.operatorRole ||
    value.operatorId !== authorization.operatorId ||
    value.operatorName !== authorization.operatorName ||
    value.signingKeyId !== authorization.signingKeyId ||
    value.signingPublicKeySha256 !== authorization.signingPublicKeySha256 ||
    value.authorizationEnvelopeSha256 !== authorization.authorizationEnvelopeSha256 ||
    value.firmId !== pkg.firmId ||
    value.periodId !== pkg.periodId ||
    value.packageId !== pkg.packageId ||
    value.packageVersion !== pkg.packageVersion ||
    value.packageSha256 !== pkg.packageSha256 ||
    !Array.isArray(value.pieces) ||
    value.pieces.length !== 16 ||
    !UUID_RE.test(String(value.operationId ?? "")) ||
    !Number.isFinite(Date.parse(String(value.committedAt ?? "")))
  ) {
    throw new Error("database returned a malformed or drifted DRG staging receipt");
  }
  return value as unknown as DrgStagingOperationReceipt;
}

async function readSnapshot(
  rpc: DrgPackageStagingRpcClient,
  pkg: SealedDrgWeeklyPackage,
): Promise<DrgPortalStagingSnapshot> {
  const { data, error } = await rpc.rpc("read_drg_package_staging_snapshot", {
    p_firm_id: pkg.firmId,
    p_period_id: pkg.periodId,
  });
  if (error) throw new Error(`DRG staging reconciliation read failed: ${error.message ?? "unknown database error"}`);
  return parseSnapshot(data, pkg);
}

async function verifyPdfBytes(input: {
  readonly pkg: SealedDrgWeeklyPackage;
  readonly rpc: DrgPackageStagingRpcClient;
  readonly storage: DrgPackageStorageClient;
  readonly sha256Bytes: Sha256BytesFunction;
}) {
  const pdfPieces = input.pkg.pieces.filter((piece) => piece.payload.kind === "pdf");
  const { data, error } = await input.rpc.rpc("read_drg_pdf_storage_identities", {
    p_storage_keys: pdfPieces.map((piece) => piece.payload.kind === "pdf" ? piece.payload.storageKey : ""),
  });
  if (error) throw new Error(`PDF object identity preflight failed: ${error.message ?? "unknown database error"}`);
  if (!Array.isArray(data) || data.length !== pdfPieces.length) {
    throw new Error("PDF object identity preflight did not resolve every exact package PDF");
  }
  const identityByKey = new Map(data.map((item) => {
    const value = record(item);
    return [String(value?.storageKey ?? ""), value] as const;
  }));

  return Promise.all(pdfPieces.map(async (piece) => {
    if (piece.payload.kind !== "pdf") throw new Error("PDF preflight topology drift");
    const identity = identityByKey.get(piece.payload.storageKey);
    if (
      !identity ||
      !UUID_RE.test(String(identity.storageObjectId ?? "")) ||
      !Number.isFinite(Date.parse(String(identity.objectUpdatedAt ?? "")))
    ) {
      throw new Error(`PDF object identity is malformed for ${piece.id}`);
    }
    const downloaded = await input.storage.from("firm-files").download(piece.payload.storageKey);
    if (downloaded.error || !downloaded.data) {
      throw new Error(`PDF byte download failed for ${piece.id}: ${downloaded.error?.message ?? "missing object"}`);
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const computedSha256 = input.sha256Bytes(bytes);
    if (!SHA256_RE.test(computedSha256)) throw new Error("PDF byte hasher returned a malformed SHA-256");
    if (
      computedSha256 !== piece.payload.assetSha256 ||
      bytes.byteLength !== piece.payload.byteSize ||
      downloaded.data.type !== piece.payload.mimeType
    ) {
      throw new Error(`PDF downloaded bytes do not match the sealed package for ${piece.id}`);
    }
    return {
      pieceId: piece.id,
      storageKey: piece.payload.storageKey,
      storageObjectId: identity.storageObjectId,
      objectUpdatedAt: identity.objectUpdatedAt,
      assetSha256: computedSha256,
      byteSize: bytes.byteLength,
      mimeType: downloaded.data.type,
    };
  }));
}

/**
 * The only live write adapter for the offline protocol. It validates the pure
 * plan before crossing the database boundary, executes one service-role RPC,
 * then performs the mandatory fresh, zero-write reconciliation.
 */
export async function stageExecutionAuthorizedDrgPackage(input: {
  readonly pkg: SealedDrgWeeklyPackage;
  readonly snapshot: DrgPortalStagingSnapshot;
  readonly executionAuthorization: DrgPackageStagingExecutionAuthorizationEvidence;
  readonly sha256: Sha256Function;
  readonly sha256Bytes: Sha256BytesFunction;
  readonly rpc: DrgPackageStagingRpcClient;
  readonly storage: DrgPackageStorageClient;
  readonly now?: Date;
}): Promise<AuthorizedDrgStagingResult> {
  const plan = planDrgPackageStaging(input.pkg, input.snapshot, input.sha256);
  if (plan.kind === "no_plan") return { status: "blocked", plan, writesPerformed: 0 };
  validateAuthorization(input.executionAuthorization, input.pkg, input.now ?? new Date());
  if (
    !input.executionAuthorization.signingKeyId.trim() ||
    !SHA256_RE.test(input.executionAuthorization.signingPublicKeySha256) ||
    !SHA256_RE.test(input.executionAuthorization.authorizationEnvelopeSha256) ||
    !BASE64_RE.test(input.executionAuthorization.authorizationSignatureBase64)
  ) {
    throw new Error("staging authorization signer evidence is malformed");
  }
  const pdfEvidence = await verifyPdfBytes(input);

  const { data, error } = await input.rpc.rpc("stage_drg_weekly_package_atomic", {
    p_package: input.pkg,
    p_package_canonical: packageCanonicalInput(input.pkg),
    p_plan: plan,
    p_authorization: input.executionAuthorization,
    p_pdf_evidence: pdfEvidence,
  });
  if (error) throw new Error(`atomic DRG package staging failed: ${error.message ?? "unknown database error"}`);
  const receipt = parseReceipt(data, input.pkg, input.executionAuthorization);

  const snapshot = await readSnapshot(input.rpc, input.pkg);
  const reconciliation = reconcileDrgPackageStaging(input.pkg, snapshot, input.sha256);
  if (reconciliation.status !== "exact_match") {
    throw new Error("atomic staging committed but mandatory fresh reconciliation did not prove all sixteen exact versions; package remains hidden");
  }
  const exactReconciliation = { ...reconciliation, status: "exact_match" as const };
  return { status: "reconciled", plan, receipt, snapshot, reconciliation: exactReconciliation };
}

/** Read-only Publishing Kit projection. No database mutation is possible. */
export async function projectLiveApprovedDrgPublishingKit(input: {
  readonly pkg: SealedDrgWeeklyPackage;
  readonly releaseAuthorization: DrgPackageReleaseAuthorization;
  readonly sha256: Sha256Function;
  readonly rpc: DrgPackageStagingRpcClient;
}): Promise<ReleaseAuthorizedPublishingKitProjection> {
  const snapshot = await readSnapshot(input.rpc, input.pkg);
  return projectReleaseAuthorizedDrgPublishingKit(input.pkg, snapshot, input.releaseAuthorization, input.sha256);
}
