import {
  canonicalJson,
  planDrgPackageStaging,
  projectApprovedDrgPublishingKit,
  reconcileDrgPackageStaging,
  type ApprovedPublishingKitProjection,
  type DrgPackageApproval,
  type DrgPackageReconciliation,
  type DrgPortalStagingSnapshot,
  type DrgStagingPlan,
  type SealedDrgWeeklyPackage,
  type Sha256Function,
} from "./drg-package-staging";

const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DrgPackageStagingAuthorization {
  readonly schemaVersion: "drg-package-staging-authorization/v1";
  readonly authorizationId: string;
  readonly firmId: string;
  readonly periodId: string;
  readonly packageId: string;
  readonly packageVersion: number;
  readonly packageSha256: string;
  readonly actorRole: "operator";
  readonly actorId: string;
  readonly actorName: string;
  readonly authorizedAt: string;
  readonly expiresAt: string;
}

export interface DrgStagingOperationReceipt {
  readonly schemaVersion: "drg-package-staging-receipt/v1";
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly authorizationId: string;
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

export interface DrgPackageStagingRpcClient {
  rpc(
    functionName: "stage_drg_weekly_package_atomic" | "read_drg_package_staging_snapshot",
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
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
  authorization: DrgPackageStagingAuthorization,
  pkg: SealedDrgWeeklyPackage,
  now: Date,
): void {
  if (authorization.schemaVersion !== "drg-package-staging-authorization/v1") {
    throw new Error("unsupported DRG package staging authorization schema");
  }
  if (!authorization.authorizationId.trim()) throw new Error("staging authorization id is required");
  if (!UUID_RE.test(authorization.actorId)) throw new Error("staging authorization requires an authenticated operator UUID");
  if (authorization.actorRole !== "operator" || !authorization.actorName.trim()) {
    throw new Error("staging authorization requires a named operator");
  }
  if (
    authorization.firmId !== pkg.firmId ||
    authorization.periodId !== pkg.periodId ||
    authorization.packageId !== pkg.packageId ||
    authorization.packageVersion !== pkg.packageVersion ||
    authorization.packageSha256 !== pkg.packageSha256
  ) {
    throw new Error("staging authorization is not bound to the exact package scope and SHA");
  }
  if (!SHA256_RE.test(authorization.packageSha256)) throw new Error("staging authorization package SHA-256 is malformed");
  const authorizedAt = Date.parse(authorization.authorizedAt);
  const expiresAt = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(authorizedAt) || !Number.isFinite(expiresAt) || expiresAt <= authorizedAt) {
    throw new Error("staging authorization timestamps are invalid");
  }
  if (authorizedAt > now.getTime() + 5 * 60_000) throw new Error("staging authorization timestamp is in the future");
  if (expiresAt <= now.getTime()) throw new Error("staging authorization has expired");
}

function parseSnapshot(data: unknown, pkg: SealedDrgWeeklyPackage): DrgPortalStagingSnapshot {
  const value = record(data);
  if (!value || value.firmId !== pkg.firmId || value.periodId !== pkg.periodId || !Array.isArray(value.deliverables)) {
    throw new Error("database returned a malformed or cross-scoped DRG staging snapshot");
  }
  return value as unknown as DrgPortalStagingSnapshot;
}

function parseReceipt(data: unknown, pkg: SealedDrgWeeklyPackage, authorization: DrgPackageStagingAuthorization): DrgStagingOperationReceipt {
  const value = record(data);
  if (
    !value ||
    value.schemaVersion !== "drg-package-staging-receipt/v1" ||
    value.authorizationId !== authorization.authorizationId ||
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

/**
 * The only live write adapter for the offline protocol. It validates the pure
 * plan before crossing the database boundary, executes one service-role RPC,
 * then performs the mandatory fresh, zero-write reconciliation.
 */
export async function stageAuthorizedDrgPackage(input: {
  readonly pkg: SealedDrgWeeklyPackage;
  readonly snapshot: DrgPortalStagingSnapshot;
  readonly authorization: DrgPackageStagingAuthorization;
  readonly sha256: Sha256Function;
  readonly rpc: DrgPackageStagingRpcClient;
  readonly now?: Date;
}): Promise<AuthorizedDrgStagingResult> {
  const plan = planDrgPackageStaging(input.pkg, input.snapshot, input.sha256);
  if (plan.kind === "no_plan") return { status: "blocked", plan, writesPerformed: 0 };
  validateAuthorization(input.authorization, input.pkg, input.now ?? new Date());

  const { data, error } = await input.rpc.rpc("stage_drg_weekly_package_atomic", {
    p_package: input.pkg,
    p_package_canonical: packageCanonicalInput(input.pkg),
    p_plan: plan,
    p_authorization: input.authorization,
  });
  if (error) throw new Error(`atomic DRG package staging failed: ${error.message ?? "unknown database error"}`);
  const receipt = parseReceipt(data, input.pkg, input.authorization);

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
  readonly approval: DrgPackageApproval;
  readonly sha256: Sha256Function;
  readonly rpc: DrgPackageStagingRpcClient;
}): Promise<ApprovedPublishingKitProjection> {
  const snapshot = await readSnapshot(input.rpc, input.pkg);
  return projectApprovedDrgPublishingKit(input.pkg, snapshot, input.approval, input.sha256);
}
