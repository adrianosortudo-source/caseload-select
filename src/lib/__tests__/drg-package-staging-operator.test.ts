import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DRG_REQUIRED_DOCTRINE_PINS,
  DRG_SIXTEEN_PIECE_REGISTRY,
  planDrgPackageStaging,
  sealDrgWeeklyPackage,
  type DrgPortalStagingSnapshot,
  type DrgWeeklyPackageDraft,
  type SealedDrgWeeklyPackage,
} from "../drg-package-staging";
import {
  type DrgPackageStagingAuthorization,
  type DrgPackageStagingRpcClient,
  type DrgPackageStorageClient,
  type DrgStagingOperationReceipt,
  stageAuthorizedDrgPackage,
} from "../drg-package-staging-adapter";
import {
  authorizationEnvelopeSigningPayload,
  parseDrgOperatorArgs,
  runDrgStagingOperator,
  type SignedDrgStagingAuthorizationEnvelope,
} from "../../../scripts/stage-drg-weekly-package";

const FIRM_ID = "11111111-1111-4111-8111-111111111111";
const PERIOD_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const AUTHORIZER_ID = "55555555-5555-4555-8555-555555555555";
const AUTHORIZATION_ID = "drg-auth-2026-w33";
const NOW = new Date("2026-08-09T15:00:00.000Z");
const tempFolders: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const folder of tempFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function makePackage(packageId = "DRG-2026-W33"): SealedDrgWeeklyPackage {
  const pin = (id: string, version: string) => ({ id, version, sha256: sha256Text(`${id}:${version}`) });
  const draft: DrgWeeklyPackageDraft = {
    schemaVersion: "drg-weekly-package/v1",
    packageId,
    packageVersion: 1,
    firmId: FIRM_ID,
    periodId: PERIOD_ID,
    sources: {
      topicSelection: pin("TOPIC_SELECTION", "DRG-2026-W33"),
      researchEvidence: pin("RESEARCH_EVIDENCE", "DRG-2026-W33"),
      contentManifest: pin("CONTENT_MANIFEST", "DRG-2026-W33"),
    },
    doctrine: DRG_REQUIRED_DOCTRINE_PINS,
    pieces: DRG_SIXTEEN_PIECE_REGISTRY.map((piece) => ({
      id: piece.id,
      locale: piece.locale,
      title: `${piece.id} title`,
      sourceSha256: sha256Text(`source:${piece.id}`),
      payload: piece.contentKind === "pdf"
        ? {
            kind: "pdf" as const,
            storageKey: `drg/${FIRM_ID}/${PERIOD_ID}/${piece.id}.pdf`,
            filename: `${piece.id}.pdf`,
            mimeType: "application/pdf" as const,
            byteSize: 32,
            assetSha256: sha256Text(`pdf:${piece.id}`),
          }
        : { kind: "text" as const, bodyHtml: `<p>${piece.id} body</p>` },
    })),
  };
  return sealDrgWeeklyPackage(draft, sha256Text);
}

function emptySnapshot(pkg: SealedDrgWeeklyPackage): DrgPortalStagingSnapshot {
  return { firmId: pkg.firmId, periodId: pkg.periodId, deliverables: [] };
}

interface FixtureOptions {
  readonly packageId?: string;
  readonly authorizedAt?: string;
  readonly expiresAt?: string;
  readonly mutateAuthorization?: (authorization: DrgPackageStagingAuthorization) => DrgPackageStagingAuthorization;
}

function makeFixture(options: FixtureOptions = {}) {
  const folder = mkdtempSync(join(tmpdir(), "drg-stage-operator-"));
  tempFolders.push(folder);
  const packagePath = join(folder, "sealed-package.json");
  const authorizationPath = join(folder, "authorization.json");
  const receiptPath = join(folder, "receipt.json");
  const pkg = makePackage(options.packageId);
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  const packageFileSha256 = sha256File(packagePath);
  const keys = generateKeyPairSync("ed25519");
  const baseAuthorization: DrgPackageStagingAuthorization = {
    schemaVersion: "drg-package-staging-authorization/v1",
    authorizationId: AUTHORIZATION_ID,
    firmId: pkg.firmId,
    periodId: pkg.periodId,
    packageId: pkg.packageId,
    packageVersion: pkg.packageVersion,
    packageSha256: pkg.packageSha256,
    actorRole: "operator",
    actorId: ACTOR_ID,
    actorName: "DRG automation operator",
    authorizerRole: "lawyer",
    authorizerId: AUTHORIZER_ID,
    authorizerName: "DRG Law approving lawyer",
    authorizedAt: options.authorizedAt ?? "2026-08-09T14:55:00.000Z",
    expiresAt: options.expiresAt ?? "2026-08-09T15:30:00.000Z",
  };
  const authorization = options.mutateAuthorization?.(baseAuthorization) ?? baseAuthorization;
  const signedFields: Omit<SignedDrgStagingAuthorizationEnvelope, "signatureBase64"> = {
    schemaVersion: "drg-package-staging-authorization-envelope/v1",
    packageFileSha256,
    recordedAt: authorization.authorizedAt,
    signingKeyId: "drg-operator-test-key",
    signatureAlgorithm: "ed25519",
    authorization,
  };
  const signatureBase64 = sign(
    null,
    Buffer.from(authorizationEnvelopeSigningPayload(signedFields), "utf8"),
    keys.privateKey,
  ).toString("base64");
  writeFileSync(authorizationPath, `${JSON.stringify({ ...signedFields, signatureBase64 }, null, 2)}\n`, "utf8");
  const authorizationFileSha256 = sha256File(authorizationPath);
  const signingPublicKeySha256 = createHash("sha256")
    .update(keys.publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  const trustedSigners = [{
    signingKeyId: signedFields.signingKeyId,
    spkiSha256: signingPublicKeySha256,
    firmId: pkg.firmId,
    authorizerRole: "lawyer" as const,
    authorizerId: AUTHORIZER_ID,
    authorizerName: "DRG Law approving lawyer",
  }];
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    DRG_STAGING_TARGET: "staging",
    DRG_STAGING_AUTHORIZATION_PUBLIC_KEY_PEM: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    NEXT_PUBLIC_SUPABASE_URL: "https://safe-project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-secret",
  };
  const args = [
    "--package", packagePath,
    "--package-sha256", packageFileSha256,
    "--authorization", authorizationPath,
    "--authorization-sha256", authorizationFileSha256,
    "--receipt", receiptPath,
    "--target", "staging",
  ];
  return { folder, pkg, packagePath, authorizationPath, receiptPath, packageFileSha256, authorizationFileSha256, env, args, trustedSigners, signingPublicKeySha256 };
}

function fakeClients(): { rpc: DrgPackageStagingRpcClient; storage: DrgPackageStorageClient } {
  return {
    rpc: { rpc: vi.fn() } as unknown as DrgPackageStagingRpcClient,
    storage: { from: vi.fn() } as unknown as DrgPackageStorageClient,
  };
}

function operationReceipt(pkg: SealedDrgWeeklyPackage, writesPerformed: number, replay: boolean): DrgStagingOperationReceipt {
  return {
    schemaVersion: "drg-package-staging-receipt/v1",
    operationId: "44444444-4444-4444-8444-444444444444",
    idempotencyKey: "drg-stage-idempotency-key",
    authorizationId: AUTHORIZATION_ID,
    authorizerRole: "lawyer",
    authorizerId: AUTHORIZER_ID,
    authorizerName: "DRG Law approving lawyer",
    signingKeyId: "drg-operator-test-key",
    signingPublicKeySha256: "a".repeat(64),
    authorizationEnvelopeSha256: "b".repeat(64),
    firmId: pkg.firmId,
    periodId: pkg.periodId,
    packageId: pkg.packageId,
    packageVersion: pkg.packageVersion,
    packageSha256: pkg.packageSha256,
    committedAt: NOW.toISOString(),
    addedCount: replay ? 0 : 16,
    newVersionCount: 0,
    skippedCount: replay ? 16 : 0,
    pieces: pkg.pieces.map((piece, index) => ({
      pieceId: piece.id,
      action: replay ? "correct_skip" as const : "add" as const,
      deliverableId: `deliverable-${index}`,
      versionId: `version-${index}`,
      versionNumber: 1,
      pieceSha256: piece.pieceSha256,
    })),
    writesPerformed,
    replay,
  };
}

function reconciledResult(pkg: SealedDrgWeeklyPackage, writesPerformed: number, replay: boolean) {
  const snapshot = emptySnapshot(pkg);
  const plan = planDrgPackageStaging(pkg, snapshot, sha256Text);
  if (plan.kind !== "atomic_plan") throw new Error("test fixture plan must be atomic");
  return {
    status: "reconciled" as const,
    plan,
    receipt: operationReceipt(pkg, writesPerformed, replay),
    snapshot,
    reconciliation: {
      status: "exact_match" as const,
      visible: true,
      writesPerformed: 0 as const,
      correctCount: 16,
      missingOrDriftedCount: 0,
      blockers: [],
    },
  };
}

describe("DRG staging operator argument contract", () => {
  it("requires exact named arguments and rejects unknown or duplicate arguments", () => {
    const fixture = makeFixture();
    const parsed = parseDrgOperatorArgs(fixture.args);
    expect(parsed).toMatchObject({ execute: false, target: "staging", receiptPath: fixture.receiptPath });
    expect(() => parseDrgOperatorArgs([...fixture.args, "--unknown"])).toThrow(/unknown argument/);
    expect(() => parseDrgOperatorArgs([...fixture.args, "--package", fixture.packagePath])).toThrow(/duplicate argument/);
  });

  it("rejects stdin-style and relative package, authorization, or receipt paths", () => {
    const fixture = makeFixture();
    const args = [...fixture.args];
    args[1] = "-";
    expect(() => parseDrgOperatorArgs(args)).toThrow(/absolute file path/);
  });
});

describe("DRG staging operator plan-only safety", () => {
  it("defaults to a zero-write plan and creates one append-only receipt", async () => {
    const fixture = makeFixture();
    const stagePackage = vi.fn();
    const readSnapshot = vi.fn(async () => emptySnapshot(fixture.pkg));
    const result = await runDrgStagingOperator({
      argv: fixture.args,
      env: fixture.env,
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: false, stdoutIsTTY: false },
      createClients: fakeClients,
      readSnapshot,
      stagePackage,
      log: vi.fn(),
      logError: vi.fn(),
      receiptId: () => "receipt-plan",
    });
    expect(result.exitCode).toBe(0);
    expect(result.receipt?.mode).toBe("plan_only");
    expect(result.receipt?.outcome).toMatchObject({ status: "planned", writesPerformed: 0 });
    expect(result.receipt?.plan).toMatchObject({ addedCount: 16, newVersionCount: 0, skippedCount: 0, writesPerformed: 0 });
    expect(result.receipt).toMatchObject({
      authorizerRole: "lawyer",
      authorizerId: AUTHORIZER_ID,
      signingKeyId: "drg-operator-test-key",
      signingPublicKeySha256: fixture.signingPublicKeySha256,
      authorizationEnvelopeSha256: fixture.authorizationFileSha256,
    });
    expect(stagePackage).not.toHaveBeenCalled();
    expect(readSnapshot).toHaveBeenCalledOnce();
    expect(JSON.parse(readFileSync(fixture.receiptPath, "utf8"))).toEqual(result.receipt);
  });

  it("refuses mixed TTY state before file or client access", async () => {
    const fixture = makeFixture();
    const createClients = vi.fn(fakeClients);
    const result = await runDrgStagingOperator({
      argv: fixture.args,
      env: fixture.env,
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: true, stdoutIsTTY: false },
      createClients,
      log: vi.fn(),
      logError: vi.fn(),
    });
    expect(result.exitCode).toBe(1);
    expect(createClients).not.toHaveBeenCalled();
    expect(existsSync(fixture.receiptPath)).toBe(false);
  });

  it("refuses fixture or dry-run identity markers before any network boundary", async () => {
    const fixture = makeFixture({ packageId: "DRG-FIXTURE-2026-W33" });
    const createClients = vi.fn(fakeClients);
    const result = await runDrgStagingOperator({
      argv: fixture.args,
      env: fixture.env,
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: false, stdoutIsTTY: false },
      createClients,
      log: vi.fn(),
      logError: vi.fn(),
    });
    expect(result.exitCode).toBe(1);
    expect(createClients).not.toHaveBeenCalled();
    expect(existsSync(fixture.receiptPath)).toBe(false);
  });

  it("rejects changed package bytes and changed authorization bytes before any network or receipt write", async () => {
    const changedPackage = makeFixture();
    const changedAuthorization = makeFixture();
    writeFileSync(changedPackage.packagePath, `${readFileSync(changedPackage.packagePath, "utf8")} `, "utf8");
    writeFileSync(changedAuthorization.authorizationPath, `${readFileSync(changedAuthorization.authorizationPath, "utf8")} `, "utf8");
    for (const fixture of [changedPackage, changedAuthorization]) {
      const createClients = vi.fn(fakeClients);
      const result = await runDrgStagingOperator({
        argv: fixture.args,
        env: fixture.env,
        trustedSigners: fixture.trustedSigners,
        now: NOW,
        terminal: { stdinIsTTY: false, stdoutIsTTY: false },
        createClients,
        log: vi.fn(),
        logError: vi.fn(),
      });
      expect(result.exitCode).toBe(1);
      expect(createClients).not.toHaveBeenCalled();
      expect(existsSync(fixture.receiptPath)).toBe(false);
    }
  });

  it("rejects expired or package-mismatched signed authorization with no writes", async () => {
    const expired = makeFixture({
      authorizedAt: "2026-08-09T13:00:00.000Z",
      expiresAt: "2026-08-09T14:00:00.000Z",
    });
    const mismatched = makeFixture({
      mutateAuthorization: (authorization) => ({ ...authorization, packageSha256: "f".repeat(64) }),
    });
    for (const fixture of [expired, mismatched]) {
      const stagePackage = vi.fn();
      const createClients = vi.fn(fakeClients);
      const result = await runDrgStagingOperator({
        argv: fixture.args,
        env: fixture.env,
        trustedSigners: fixture.trustedSigners,
        now: NOW,
        terminal: { stdinIsTTY: false, stdoutIsTTY: false },
        createClients,
        stagePackage,
        log: vi.fn(),
        logError: vi.fn(),
      });
      expect(result.exitCode).toBe(1);
      expect(createClients).not.toHaveBeenCalled();
      expect(stagePackage).not.toHaveBeenCalled();
      expect(existsSync(fixture.receiptPath)).toBe(false);
    }
  });

  it("rejects an operator self-authorizing with a non-authoritative role", async () => {
    const fixture = makeFixture({
      mutateAuthorization: (authorization) => ({
        ...authorization,
        authorizerRole: "operator",
      } as unknown as DrgPackageStagingAuthorization),
    });
    const createClients = vi.fn(fakeClients);
    const result = await runDrgStagingOperator({
      argv: fixture.args,
      env: fixture.env,
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: false, stdoutIsTTY: false },
      createClients,
      log: vi.fn(),
      logError: vi.fn(),
    });
    expect(result.exitCode).toBe(1);
    expect(createClients).not.toHaveBeenCalled();
    expect(existsSync(fixture.receiptPath)).toBe(false);
  });

  it.each([
    ["role", (authorization: DrgPackageStagingAuthorization) => ({
      ...authorization,
      authorizerRole: "client_authorized" as const,
    })],
    ["id", (authorization: DrgPackageStagingAuthorization) => ({
      ...authorization,
      authorizerId: "77777777-7777-4777-8777-777777777777",
    })],
    ["name", (authorization: DrgPackageStagingAuthorization) => ({
      ...authorization,
      authorizerName: "Another approving lawyer",
    })],
    ["firm", (authorization: DrgPackageStagingAuthorization) => ({
      ...authorization,
      firmId: "88888888-8888-4888-8888-888888888888",
    })],
  ] satisfies ReadonlyArray<readonly [
    string,
    (authorization: DrgPackageStagingAuthorization) => DrgPackageStagingAuthorization,
  ]>)("rejects a valid trusted signature with mismatched authorizer %s", async (_field, mutateAuthorization) => {
    const fixture = makeFixture({ mutateAuthorization });
    const clients = fakeClients();
    const createClients = vi.fn(() => clients);
    const stagePackage = vi.fn();
    const result = await runDrgStagingOperator({
      argv: fixture.args,
      env: fixture.env,
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: false, stdoutIsTTY: false },
      createClients,
      stagePackage,
      log: vi.fn(),
      logError: vi.fn(),
    });
    expect(result.exitCode).toBe(1);
    expect(createClients).not.toHaveBeenCalled();
    expect(clients.rpc.rpc).not.toHaveBeenCalled();
    expect(stagePackage).not.toHaveBeenCalled();
    expect(existsSync(fixture.receiptPath)).toBe(false);
  });

  it("rejects a fresh valid key pair even when mutable runtime env supplies its matching PEM", async () => {
    const fixture = makeFixture();
    const forgedKeys = generateKeyPairSync("ed25519");
    const originalEnvelope = JSON.parse(readFileSync(fixture.authorizationPath, "utf8")) as SignedDrgStagingAuthorizationEnvelope;
    const forgedSignedFields: Omit<SignedDrgStagingAuthorizationEnvelope, "signatureBase64"> = {
      schemaVersion: originalEnvelope.schemaVersion,
      packageFileSha256: originalEnvelope.packageFileSha256,
      recordedAt: originalEnvelope.recordedAt,
      signingKeyId: originalEnvelope.signingKeyId,
      signatureAlgorithm: originalEnvelope.signatureAlgorithm,
      authorization: originalEnvelope.authorization,
    };
    const forgedSignature = sign(
      null,
      new TextEncoder().encode(authorizationEnvelopeSigningPayload(forgedSignedFields)),
      forgedKeys.privateKey,
    ).toString("base64");
    writeFileSync(
      fixture.authorizationPath,
      `${JSON.stringify({ ...forgedSignedFields, signatureBase64: forgedSignature }, null, 2)}\n`,
      "utf8",
    );
    const forgedAuthorizationSha = sha256File(fixture.authorizationPath);
    const args = [...fixture.args];
    args[args.indexOf("--authorization-sha256") + 1] = forgedAuthorizationSha;
    const env = {
      ...fixture.env,
      DRG_STAGING_AUTHORIZATION_KEY_ID: originalEnvelope.signingKeyId,
      DRG_STAGING_AUTHORIZATION_PUBLIC_KEY_PEM: forgedKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    };
    const createClients = vi.fn(fakeClients);
    const result = await runDrgStagingOperator({
      argv: args,
      env,
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: false, stdoutIsTTY: false },
      createClients,
      log: vi.fn(),
      logError: vi.fn(),
    });
    expect(result.exitCode).toBe(1);
    expect(createClients).not.toHaveBeenCalled();
    expect(existsSync(fixture.receiptPath)).toBe(false);
  });

  it("requires a new receipt destination and never overwrites the first receipt", async () => {
    const fixture = makeFixture();
    const first = await runDrgStagingOperator({
      argv: fixture.args,
      env: fixture.env,
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: false, stdoutIsTTY: false },
      createClients: fakeClients,
      readSnapshot: async () => emptySnapshot(fixture.pkg),
      log: vi.fn(),
      logError: vi.fn(),
    });
    const original = readFileSync(fixture.receiptPath, "utf8");
    const createClients = vi.fn(fakeClients);
    const second = await runDrgStagingOperator({
      argv: fixture.args,
      env: fixture.env,
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: false, stdoutIsTTY: false },
      createClients,
      log: vi.fn(),
      logError: vi.fn(),
    });
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(1);
    expect(createClients).not.toHaveBeenCalled();
    expect(readFileSync(fixture.receiptPath, "utf8")).toBe(original);
  });

  it("redacts service-role material from every emitted error", async () => {
    const fixture = makeFixture();
    const secret = "service-secret-that-must-never-appear";
    const env = { ...fixture.env, SUPABASE_SERVICE_ROLE_KEY: secret };
    const errors: string[] = [];
    const result = await runDrgStagingOperator({
      argv: fixture.args,
      env,
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: false, stdoutIsTTY: false },
      createClients: () => { throw new Error(`client failed with ${secret}`); },
      log: vi.fn(),
      logError: (message) => errors.push(message),
    });
    expect(result.exitCode).toBe(1);
    expect(errors.join("\n")).not.toContain(secret);
    expect(errors.join("\n")).toContain("[REDACTED]");
    expect(existsSync(fixture.receiptPath)).toBe(false);
  });
});

describe("DRG staging operator explicit execution", () => {
  it("refuses production execution without the exact second package-SHA acknowledgement", async () => {
    const fixture = makeFixture();
    const args = fixture.args.map((value) => value === "staging" ? "production" : value);
    const env = {
      ...fixture.env,
      DRG_STAGING_TARGET: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://ssxryjxifwiivghglqer.supabase.co",
    };
    const createClients = vi.fn(fakeClients);
    const result = await runDrgStagingOperator({
      argv: [...args, "--execute"],
      env,
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: false, stdoutIsTTY: false },
      createClients,
      log: vi.fn(),
      logError: vi.fn(),
    });
    expect(result.exitCode).toBe(1);
    expect(createClients).not.toHaveBeenCalled();
    expect(existsSync(fixture.receiptPath)).toBe(false);
  });

  it("refuses a production URL mislabeled as staging before client creation", async () => {
    const fixture = makeFixture();
    const createClients = vi.fn(fakeClients);
    const result = await runDrgStagingOperator({
      argv: [...fixture.args, "--execute"],
      env: { ...fixture.env, NEXT_PUBLIC_SUPABASE_URL: "https://ssxryjxifwiivghglqer.supabase.co" },
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: false, stdoutIsTTY: false },
      createClients,
      log: vi.fn(),
      logError: vi.fn(),
    });
    expect(result.exitCode).toBe(1);
    expect(createClients).not.toHaveBeenCalled();
    expect(existsSync(fixture.receiptPath)).toBe(false);
  });

  it("passes the exact in-memory package, authorization, snapshot, hashers, RPC, and storage to the live adapter", async () => {
    const fixture = makeFixture();
    const clients = fakeClients();
    const stagePackage = vi.fn(async (input: Parameters<typeof stageAuthorizedDrgPackage>[0]) => {
      expect(input.pkg).toEqual(fixture.pkg);
      expect(input.authorization.authorizationId).toBe(AUTHORIZATION_ID);
      expect(input.snapshot).toEqual(emptySnapshot(fixture.pkg));
      expect(input.sha256("proof")).toBe(sha256Text("proof"));
      expect(input.sha256Bytes(new TextEncoder().encode("proof"))).toBe(sha256Text("proof"));
      expect(input.rpc).toBe(clients.rpc);
      expect(input.storage).toBe(clients.storage);
      return reconciledResult(fixture.pkg, 16, false);
    });
    const result = await runDrgStagingOperator({
      argv: [...fixture.args, "--execute"],
      env: fixture.env,
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: false, stdoutIsTTY: false },
      createClients: () => clients,
      readSnapshot: async () => emptySnapshot(fixture.pkg),
      stagePackage,
      log: vi.fn(),
      logError: vi.fn(),
    });
    expect(result.exitCode).toBe(0);
    expect(stagePackage).toHaveBeenCalledOnce();
    expect(result.receipt?.mode).toBe("execute");
    expect(result.receipt?.outcome).toMatchObject({ status: "reconciled", replay: false, writesPerformed: 16 });
  });

  it("records an idempotent database replay as a new append-only zero-write local receipt", async () => {
    const fixture = makeFixture();
    const secondReceipt = join(fixture.folder, "receipt-replay.json");
    const stagePackage = vi
      .fn()
      .mockResolvedValueOnce(reconciledResult(fixture.pkg, 16, false))
      .mockResolvedValueOnce(reconciledResult(fixture.pkg, 0, true));
    const common = {
      env: fixture.env,
      trustedSigners: fixture.trustedSigners,
      now: NOW,
      terminal: { stdinIsTTY: false, stdoutIsTTY: false } as const,
      createClients: fakeClients,
      readSnapshot: async () => emptySnapshot(fixture.pkg),
      stagePackage,
      log: vi.fn(),
      logError: vi.fn(),
    };
    const first = await runDrgStagingOperator({ ...common, argv: [...fixture.args, "--execute"] });
    const replayArgs = fixture.args.map((value) => value === fixture.receiptPath ? secondReceipt : value);
    const replay = await runDrgStagingOperator({ ...common, argv: [...replayArgs, "--execute"] });
    expect(first.receipt?.outcome).toMatchObject({ replay: false, writesPerformed: 16 });
    expect(replay.receipt?.outcome).toMatchObject({ replay: true, writesPerformed: 0 });
    expect(stagePackage).toHaveBeenCalledTimes(2);
    expect(existsSync(fixture.receiptPath)).toBe(true);
    expect(existsSync(secondReceipt)).toBe(true);
  });
});

describe("server-only boundary", () => {
  it("has no HTTP route and always wires execution through the byte-verifying live adapter", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "stage-drg-weekly-package.ts"), "utf8");
    expect(source).toContain("stageAuthorizedDrgPackage");
    expect(source).toContain("sha256Bytes");
    expect(source).not.toMatch(/src\/app\/api|NextRequest|NextResponse|fetch\s*\(/);
  });
});
