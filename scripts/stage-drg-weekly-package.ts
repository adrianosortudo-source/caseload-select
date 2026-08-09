#!/usr/bin/env node
/**
 * Trusted, server-only operator entrypoint for the DRG sixteen-piece package.
 *
 * Default mode is read-only planning. The only write path requires --execute,
 * an independently signed authorization envelope, and (for production) a
 * second acknowledgement bound to the exact sealed package SHA. This file is
 * intentionally not imported by any HTTP route or browser bundle.
 */

import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import {
  constants as fsConstants,
  link,
  lstat,
  open,
  readFile,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  canonicalJson,
  planDrgPackageStaging,
  reconcileDrgPackageStaging,
  sealDrgWeeklyPackage,
  type DrgPortalStagingSnapshot,
  type DrgStagingPlan,
  type DrgWeeklyPackageDraft,
  type SealedDrgWeeklyPackage,
} from "../src/lib/drg-package-staging";
import {
  DRG_TRUSTED_STAGING_AUTHORIZATION_SIGNERS,
  type DrgTrustedStagingAuthorizationSigner,
} from "../src/lib/drg-package-staging-authority";
import {
  readLiveDrgStagingSnapshot,
  stageAuthorizedDrgPackage,
  validateDrgPackageStagingAuthorization,
  type AuthorizedDrgStagingResult,
  type DrgPackageStagingAuthorization,
  type DrgPackageStagingAuthorizationEvidence,
  type DrgPackageStagingRpcClient,
  type DrgPackageStorageClient,
} from "../src/lib/drg-package-staging-adapter";

const SHA256_RE = /^[0-9a-f]{64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const NON_PRODUCTION_MARKER_RE = /(?:^|[-_./])(fixture|dry[-_]?run|test|integration|sample|mock|example)(?:$|[-_./])/i;
const PRODUCTION_SUPABASE_PROJECT_REF = "ssxryjxifwiivghglqer";

export type DrgStagingTarget = "development" | "staging" | "production";

export interface DrgOperatorArgs {
  readonly packagePath: string;
  readonly packageFileSha256: string;
  readonly authorizationPath: string;
  readonly authorizationFileSha256: string;
  readonly receiptPath: string;
  readonly target: DrgStagingTarget;
  readonly execute: boolean;
  readonly productionAcknowledgement: string | null;
}

export interface SignedDrgStagingAuthorizationEnvelope {
  readonly schemaVersion: "drg-package-staging-authorization-envelope/v1";
  readonly packageFileSha256: string;
  readonly recordedAt: string;
  readonly signingKeyId: string;
  readonly signatureAlgorithm: "ed25519";
  readonly authorization: DrgPackageStagingAuthorization;
  readonly signatureBase64: string;
}

interface SupabaseClients {
  readonly rpc: DrgPackageStagingRpcClient;
  readonly storage: DrgPackageStorageClient;
}

export interface DrgOperatorReceipt {
  readonly schemaVersion: "drg-package-staging-operator-receipt/v1";
  readonly receiptId: string;
  readonly createdAt: string;
  readonly mode: "plan_only" | "execute";
  readonly target: DrgStagingTarget;
  readonly packageFileSha256: string;
  readonly authorizationFileSha256: string;
  readonly authorizationId: string;
  readonly actorId: string;
  readonly authorizerRole: "lawyer" | "client_authorized";
  readonly authorizerId: string;
  readonly authorizerName: string;
  readonly signingKeyId: string;
  readonly signingPublicKeySha256: string;
  readonly authorizationEnvelopeSha256: string;
  readonly firmId: string;
  readonly periodId: string;
  readonly packageId: string;
  readonly packageVersion: number;
  readonly packageSha256: string;
  readonly plan: {
    readonly packageIdempotencyKey: string;
    readonly addedCount: number;
    readonly newVersionCount: number;
    readonly skippedCount: number;
    readonly writesPerformed: 0;
  };
  readonly outcome:
    | {
        readonly status: "planned";
        readonly reconciliationStatus: "exact_match" | "not_reconciled" | "blocked";
        readonly writesPerformed: 0;
      }
    | {
        readonly status: "reconciled";
        readonly operationId: string;
        readonly replay: boolean;
        readonly writesPerformed: number;
      };
}

export interface RunDrgStagingOperatorOptions {
  readonly argv: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly terminal?: { readonly stdinIsTTY: boolean; readonly stdoutIsTTY: boolean };
  readonly now?: Date;
  readonly createClients?: (env: NodeJS.ProcessEnv) => SupabaseClients;
  readonly readSnapshot?: (input: {
    readonly pkg: SealedDrgWeeklyPackage;
    readonly rpc: DrgPackageStagingRpcClient;
  }) => Promise<DrgPortalStagingSnapshot>;
  readonly stagePackage?: typeof stageAuthorizedDrgPackage;
  readonly receiptId?: () => string;
  readonly trustedSigners?: readonly DrgTrustedStagingAuthorizationSigner[];
  readonly log?: (message: string) => void;
  readonly logError?: (message: string) => void;
}

export interface RunDrgStagingOperatorResult {
  readonly exitCode: 0 | 1;
  readonly receiptPath: string | null;
  readonly receipt: DrgOperatorReceipt | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${label} has unsupported or missing fields`);
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function parseRequiredSha(value: string | null, flag: string): string {
  if (!value || !SHA256_RE.test(value)) throw new Error(`${flag} requires a lowercase SHA-256`);
  return value;
}

function requiredAbsolutePath(value: string | null, flag: string): string {
  if (!value || !isAbsolute(value)) throw new Error(`${flag} requires an absolute file path`);
  return resolve(value);
}

export function parseDrgOperatorArgs(argv: readonly string[]): DrgOperatorArgs {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const valueFlags = new Set([
    "--package",
    "--package-sha256",
    "--authorization",
    "--authorization-sha256",
    "--receipt",
    "--target",
    "--ack-production-write",
  ]);
  const booleanFlags = new Set(["--execute"]);

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (booleanFlags.has(flag)) {
      if (booleans.has(flag)) throw new Error(`duplicate argument ${flag}`);
      booleans.add(flag);
      continue;
    }
    if (!valueFlags.has(flag)) throw new Error(`unknown argument ${flag}`);
    if (values.has(flag)) throw new Error(`duplicate argument ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }

  const target = values.get("--target");
  if (target !== "development" && target !== "staging" && target !== "production") {
    throw new Error("--target must be development, staging, or production");
  }
  const execute = booleans.has("--execute");
  const productionAcknowledgement = values.get("--ack-production-write") ?? null;
  if (!execute && productionAcknowledgement) {
    throw new Error("--ack-production-write is valid only with --execute");
  }
  if (target !== "production" && productionAcknowledgement) {
    throw new Error("--ack-production-write is valid only for production execution");
  }

  return {
    packagePath: requiredAbsolutePath(values.get("--package") ?? null, "--package"),
    packageFileSha256: parseRequiredSha(values.get("--package-sha256") ?? null, "--package-sha256"),
    authorizationPath: requiredAbsolutePath(values.get("--authorization") ?? null, "--authorization"),
    authorizationFileSha256: parseRequiredSha(values.get("--authorization-sha256") ?? null, "--authorization-sha256"),
    receiptPath: requiredAbsolutePath(values.get("--receipt") ?? null, "--receipt"),
    target,
    execute,
    productionAcknowledgement,
  };
}

function decodeJson(bytes: Uint8Array, label: string): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} is not strict UTF-8 JSON`);
  }
}

function assertProductionPackage(pkg: SealedDrgWeeklyPackage): void {
  const identities = [
    pkg.packageId,
    pkg.sources.topicSelection.id,
    pkg.sources.topicSelection.version,
    pkg.sources.researchEvidence.id,
    pkg.sources.researchEvidence.version,
    pkg.sources.contentManifest.id,
    pkg.sources.contentManifest.version,
    ...pkg.pieces.flatMap((piece) => piece.payload.kind === "pdf" ? [piece.payload.storageKey] : []),
  ];
  if (identities.some((identity) => NON_PRODUCTION_MARKER_RE.test(identity))) {
    throw new Error("fixture, sample, test, mock, example, integration, and dry-run packages are forbidden");
  }
}

function parseExactSealedPackage(raw: unknown): SealedDrgWeeklyPackage {
  if (!isRecord(raw)) throw new Error("sealed package file must contain one JSON object");
  let sealed: SealedDrgWeeklyPackage;
  try {
    sealed = sealDrgWeeklyPackage(raw as unknown as DrgWeeklyPackageDraft, sha256Text);
  } catch {
    throw new Error("sealed package file failed canonical package validation");
  }
  if (canonicalJson(raw) !== canonicalJson(sealed)) {
    throw new Error("package file is not the exact canonical sealed package");
  }
  assertProductionPackage(sealed);
  return sealed;
}

export function authorizationEnvelopeSigningPayload(
  envelope: Omit<SignedDrgStagingAuthorizationEnvelope, "signatureBase64">,
): string {
  return canonicalJson(envelope);
}

function parseAuthorizationRecord(raw: unknown): DrgPackageStagingAuthorization {
  if (!isRecord(raw)) throw new Error("authorization record must be an object");
  assertExactKeys(raw, [
    "schemaVersion", "authorizationId", "firmId", "periodId", "packageId", "packageVersion",
    "packageSha256", "actorRole", "actorId", "actorName", "authorizerRole", "authorizerId",
    "authorizerName", "authorizedAt", "expiresAt",
  ], "authorization record");
  return raw as unknown as DrgPackageStagingAuthorization;
}

function parseSignedAuthorizationEnvelope(
  raw: unknown,
  env: NodeJS.ProcessEnv,
  pkg: SealedDrgWeeklyPackage,
  packageFileSha256: string,
  now: Date,
  trustedSigners: readonly DrgTrustedStagingAuthorizationSigner[],
): { envelope: SignedDrgStagingAuthorizationEnvelope; signingPublicKeySha256: string } {
  if (!isRecord(raw)) throw new Error("authorization file must contain one JSON object");
  assertExactKeys(raw, [
    "schemaVersion", "packageFileSha256", "recordedAt", "signingKeyId", "signatureAlgorithm",
    "authorization", "signatureBase64",
  ], "authorization envelope");
  const authorization = parseAuthorizationRecord(raw.authorization);
  const envelope = { ...raw, authorization } as unknown as SignedDrgStagingAuthorizationEnvelope;
  if (envelope.schemaVersion !== "drg-package-staging-authorization-envelope/v1") {
    throw new Error("unsupported authorization envelope schema");
  }
  if (envelope.packageFileSha256 !== packageFileSha256) {
    throw new Error("authorization envelope is not bound to the exact package file SHA-256");
  }
  if (envelope.signatureAlgorithm !== "ed25519") throw new Error("authorization signature algorithm must be ed25519");
  if (!envelope.signingKeyId.trim()) throw new Error("authorization signing key id is required");
  const recordedAt = Date.parse(envelope.recordedAt);
  if (!Number.isFinite(recordedAt) || envelope.recordedAt !== authorization.authorizedAt) {
    throw new Error("authorization recording timestamp must equal the authorized timestamp");
  }
  if (recordedAt > now.getTime() + 5 * 60_000) throw new Error("authorization recording timestamp is in the future");
  validateDrgPackageStagingAuthorization(authorization, pkg, now);

  const publicKeyPem = env.DRG_STAGING_AUTHORIZATION_PUBLIC_KEY_PEM;
  if (!publicKeyPem) throw new Error("trusted authorization public key is missing");
  if (!BASE64_RE.test(envelope.signatureBase64)) throw new Error("authorization signature is malformed");
  const signature = Buffer.from(envelope.signatureBase64, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== envelope.signatureBase64) {
    throw new Error("authorization signature is malformed");
  }
  const signedFields: Omit<SignedDrgStagingAuthorizationEnvelope, "signatureBase64"> = {
    schemaVersion: envelope.schemaVersion,
    packageFileSha256: envelope.packageFileSha256,
    recordedAt: envelope.recordedAt,
    signingKeyId: envelope.signingKeyId,
    signatureAlgorithm: envelope.signatureAlgorithm,
    authorization: envelope.authorization,
  };
  let signatureValid = false;
  let publicKey: ReturnType<typeof createPublicKey>;
  let signingPublicKeySha256 = "";
  try {
    publicKey = createPublicKey(publicKeyPem);
    const spki = publicKey.export({ type: "spki", format: "der" });
    signingPublicKeySha256 = sha256Bytes(Uint8Array.from(spki));
    const trustedSigner = trustedSigners.find((signer) =>
      signer.signingKeyId === envelope.signingKeyId &&
      signer.spkiSha256 === signingPublicKeySha256 &&
      signer.authorizerRoles.includes(authorization.authorizerRole)
    );
    if (!trustedSigner) throw new Error("untrusted signer");
    signatureValid = verify(
      null,
      new TextEncoder().encode(authorizationEnvelopeSigningPayload(signedFields)),
      publicKey,
      Uint8Array.from(signature),
    );
  } catch {
    throw new Error("authorization signer is not pinned by repository authority configuration");
  }
  if (!signatureValid) throw new Error("authorization signature verification failed");
  return { envelope, signingPublicKeySha256 };
}

async function assertAppendOnlyReceiptDestination(receiptPath: string): Promise<void> {
  const parent = dirname(receiptPath);
  let parentStat;
  try {
    parentStat = await lstat(parent);
  } catch {
    throw new Error("receipt parent directory does not exist");
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error("receipt parent must be a real directory");
  }
  try {
    await lstat(receiptPath);
    throw new Error("receipt destination already exists; receipts are append-only");
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : null;
    if (code !== "ENOENT") throw error;
  }
}

export async function writeAppendOnlyReceipt(receiptPath: string, receipt: DrgOperatorReceipt): Promise<void> {
  const temporaryPath = `${receiptPath}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
  let linked = false;
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    await link(temporaryPath, receiptPath);
    linked = true;
  } finally {
    try { await handle.close(); } catch { /* already closed */ }
    try { await unlink(temporaryPath); } catch {
      if (!linked) throw new Error("failed to clean an incomplete receipt file");
    }
  }
}

function createServerClients(env: NodeJS.ProcessEnv): SupabaseClients {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Supabase server environment is incomplete");
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return {
    rpc: client as unknown as DrgPackageStagingRpcClient,
    storage: client.storage as unknown as DrgPackageStorageClient,
  };
}

function assertSupabaseTargetBinding(env: NodeJS.ProcessEnv, target: DrgStagingTarget): void {
  if (env.DRG_STAGING_TARGET !== target) {
    throw new Error("--target does not match the trusted DRG_STAGING_TARGET environment");
  }
  const rawUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) throw new Error("Supabase server environment is incomplete");
  let projectRef: string | null = null;
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    const suffix = ".supabase.co";
    projectRef = hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : null;
  } catch {
    throw new Error("Supabase server URL is malformed");
  }
  const pointsAtProduction = projectRef === PRODUCTION_SUPABASE_PROJECT_REF;
  if (target === "production" && !pointsAtProduction) {
    throw new Error("production target is not bound to the canonical production Supabase project");
  }
  if (target !== "production" && pointsAtProduction) {
    throw new Error("canonical production Supabase project cannot run under a non-production target label");
  }
}

function actionCounts(plan: Extract<DrgStagingPlan, { kind: "atomic_plan" }>) {
  return {
    addedCount: plan.actions.filter((action) => action.action === "add").length,
    newVersionCount: plan.actions.filter((action) => action.action === "new_version").length,
    skippedCount: plan.actions.filter((action) => action.action === "correct_skip").length,
  };
}

function redactSensitive(message: string, env: NodeJS.ProcessEnv): string {
  const secrets = Object.entries(env)
    .filter(([key, value]) => value && /(SECRET|TOKEN|PASSWORD|SERVICE_ROLE_KEY|PRIVATE_KEY)/i.test(key))
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
  return secrets.reduce((safe, secret) => safe.split(secret).join("[REDACTED]"), message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown operator failure";
}

function receiptForPlan(input: {
  readonly args: DrgOperatorArgs;
  readonly pkg: SealedDrgWeeklyPackage;
  readonly authorization: DrgPackageStagingAuthorizationEvidence;
  readonly plan: Extract<DrgStagingPlan, { kind: "atomic_plan" }>;
  readonly reconciliationStatus: "exact_match" | "not_reconciled" | "blocked";
  readonly authorizationFileSha256: string;
  readonly now: Date;
  readonly receiptId: string;
}): DrgOperatorReceipt {
  return {
    schemaVersion: "drg-package-staging-operator-receipt/v1",
    receiptId: input.receiptId,
    createdAt: input.now.toISOString(),
    mode: "plan_only",
    target: input.args.target,
    packageFileSha256: input.args.packageFileSha256,
    authorizationFileSha256: input.authorizationFileSha256,
    authorizationId: input.authorization.authorizationId,
    actorId: input.authorization.actorId,
    authorizerRole: input.authorization.authorizerRole,
    authorizerId: input.authorization.authorizerId,
    authorizerName: input.authorization.authorizerName,
    signingKeyId: input.authorization.signingKeyId,
    signingPublicKeySha256: input.authorization.signingPublicKeySha256,
    authorizationEnvelopeSha256: input.authorization.authorizationEnvelopeSha256,
    firmId: input.pkg.firmId,
    periodId: input.pkg.periodId,
    packageId: input.pkg.packageId,
    packageVersion: input.pkg.packageVersion,
    packageSha256: input.pkg.packageSha256,
    plan: { packageIdempotencyKey: input.plan.packageIdempotencyKey, ...actionCounts(input.plan), writesPerformed: 0 },
    outcome: { status: "planned", reconciliationStatus: input.reconciliationStatus, writesPerformed: 0 },
  };
}

function receiptForExecution(input: {
  readonly args: DrgOperatorArgs;
  readonly pkg: SealedDrgWeeklyPackage;
  readonly authorization: DrgPackageStagingAuthorizationEvidence;
  readonly plan: Extract<DrgStagingPlan, { kind: "atomic_plan" }>;
  readonly result: Extract<AuthorizedDrgStagingResult, { status: "reconciled" }>;
  readonly authorizationFileSha256: string;
  readonly now: Date;
  readonly receiptId: string;
}): DrgOperatorReceipt {
  return {
    schemaVersion: "drg-package-staging-operator-receipt/v1",
    receiptId: input.receiptId,
    createdAt: input.now.toISOString(),
    mode: "execute",
    target: input.args.target,
    packageFileSha256: input.args.packageFileSha256,
    authorizationFileSha256: input.authorizationFileSha256,
    authorizationId: input.authorization.authorizationId,
    actorId: input.authorization.actorId,
    authorizerRole: input.authorization.authorizerRole,
    authorizerId: input.authorization.authorizerId,
    authorizerName: input.authorization.authorizerName,
    signingKeyId: input.authorization.signingKeyId,
    signingPublicKeySha256: input.authorization.signingPublicKeySha256,
    authorizationEnvelopeSha256: input.authorization.authorizationEnvelopeSha256,
    firmId: input.pkg.firmId,
    periodId: input.pkg.periodId,
    packageId: input.pkg.packageId,
    packageVersion: input.pkg.packageVersion,
    packageSha256: input.pkg.packageSha256,
    plan: { packageIdempotencyKey: input.plan.packageIdempotencyKey, ...actionCounts(input.plan), writesPerformed: 0 },
    outcome: {
      status: "reconciled",
      operationId: input.result.receipt.operationId,
      replay: input.result.receipt.replay,
      writesPerformed: input.result.receipt.writesPerformed,
    },
  };
}

export async function runDrgStagingOperator(
  options: RunDrgStagingOperatorOptions,
): Promise<RunDrgStagingOperatorResult> {
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;
  const now = options.now ?? new Date();
  try {
    const terminal = options.terminal ?? {
      stdinIsTTY: process.stdin.isTTY === true,
      stdoutIsTTY: process.stdout.isTTY === true,
    };
    if (terminal.stdinIsTTY !== terminal.stdoutIsTTY) {
      throw new Error("ambiguous TTY mode is forbidden; stdin and stdout must both be TTY or both be non-TTY");
    }
    const args = parseDrgOperatorArgs(options.argv);
    await assertAppendOnlyReceiptDestination(args.receiptPath);

    const [packageBytes, authorizationBytes] = await Promise.all([
      readFile(args.packagePath),
      readFile(args.authorizationPath),
    ]);
    const immutablePackageBytes = Uint8Array.from(packageBytes);
    const immutableAuthorizationBytes = Uint8Array.from(authorizationBytes);
    const actualPackageFileSha256 = sha256Bytes(immutablePackageBytes);
    const actualAuthorizationFileSha256 = sha256Bytes(immutableAuthorizationBytes);
    if (actualPackageFileSha256 !== args.packageFileSha256) throw new Error("package file SHA-256 mismatch");
    if (actualAuthorizationFileSha256 !== args.authorizationFileSha256) throw new Error("authorization file SHA-256 mismatch");

    const pkg = parseExactSealedPackage(decodeJson(immutablePackageBytes, "package file"));
    const verified = parseSignedAuthorizationEnvelope(
      decodeJson(immutableAuthorizationBytes, "authorization file"),
      env,
      pkg,
      actualPackageFileSha256,
      now,
      options.trustedSigners ?? DRG_TRUSTED_STAGING_AUTHORIZATION_SIGNERS,
    );
    const envelope = verified.envelope;
    const authorization: DrgPackageStagingAuthorizationEvidence = {
      ...envelope.authorization,
      signingKeyId: envelope.signingKeyId,
      signingPublicKeySha256: verified.signingPublicKeySha256,
      authorizationEnvelopeSha256: actualAuthorizationFileSha256,
      authorizationSignatureBase64: envelope.signatureBase64,
    };
    assertSupabaseTargetBinding(env, args.target);
    if (args.execute && args.target === "production" && args.productionAcknowledgement !== pkg.packageSha256) {
      throw new Error("production execution requires --ack-production-write with the exact package SHA-256");
    }

    const clients = (options.createClients ?? createServerClients)(env);
    const snapshot = await (options.readSnapshot ?? readLiveDrgStagingSnapshot)({ pkg, rpc: clients.rpc });
    const plan = planDrgPackageStaging(pkg, snapshot, sha256Text);
    if (plan.kind !== "atomic_plan" || plan.actions.length !== 16) {
      throw new Error("exact sixteen-piece atomic plan is blocked");
    }

    let receipt: DrgOperatorReceipt;
    if (!args.execute) {
      const reconciliation = reconcileDrgPackageStaging(pkg, snapshot, sha256Text);
      receipt = receiptForPlan({
        args,
        pkg,
        authorization,
        plan,
        reconciliationStatus: reconciliation.status,
        authorizationFileSha256: actualAuthorizationFileSha256,
        now,
        receiptId: (options.receiptId ?? randomUUID)(),
      });
    } else {
      const result = await (options.stagePackage ?? stageAuthorizedDrgPackage)({
        pkg,
        snapshot,
        authorization,
        sha256: sha256Text,
        sha256Bytes,
        rpc: clients.rpc,
        storage: clients.storage,
        now,
      });
      if (result.status !== "reconciled") throw new Error("live adapter blocked the exact package");
      receipt = receiptForExecution({
        args,
        pkg,
        authorization,
        plan,
        result,
        authorizationFileSha256: actualAuthorizationFileSha256,
        now,
        receiptId: (options.receiptId ?? randomUUID)(),
      });
    }

    await writeAppendOnlyReceipt(args.receiptPath, receipt);
    log(`DRG staging operator ${receipt.mode} complete; receipt=${args.receiptPath}; packageSha256=${pkg.packageSha256}; writesPerformed=${receipt.outcome.writesPerformed}`);
    return { exitCode: 0, receiptPath: args.receiptPath, receipt };
  } catch (error) {
    logError(`DRG staging operator refused: ${redactSensitive(errorMessage(error), env)}`);
    return { exitCode: 1, receiptPath: null, receipt: null };
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  const result = await runDrgStagingOperator({ argv: process.argv.slice(2) });
  process.exitCode = result.exitCode;
}
