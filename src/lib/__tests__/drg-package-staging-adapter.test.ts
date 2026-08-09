import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  DRG_REQUIRED_DOCTRINE_PINS,
  DRG_SIXTEEN_PIECE_REGISTRY,
  sealDrgWeeklyPackage,
  type DrgPackageReleaseAuthorization,
  type DrgPortalStagingSnapshot,
  type DrgWeeklyPackageDraft,
  type SealedDrgWeeklyPackage,
} from "../drg-package-staging";
import {
  projectLiveApprovedDrgPublishingKit,
  stageExecutionAuthorizedDrgPackage,
  type DrgPackageStagingExecutionAuthorizationEvidence,
  type DrgPackageStagingRpcClient,
  type DrgPackageStorageClient,
} from "../drg-package-staging-adapter";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function makePackage(): SealedDrgWeeklyPackage {
  const firmId = randomUUID();
  const periodId = randomUUID();
  const pin = (id: string, version: string) => ({ id, version, sha256: sha256(`${id}:${version}`) });
  const draft: DrgWeeklyPackageDraft = {
    schemaVersion: "drg-weekly-package/v1",
    packageId: "DRG-2026-W33",
    packageVersion: 1,
    firmId,
    periodId,
    sources: {
      topicSelection: pin("topic-selection", "2026-W33"),
      researchEvidence: pin("research-evidence", "2026-W33"),
      contentManifest: pin("content-manifest", "1.0.0"),
    },
    doctrine: DRG_REQUIRED_DOCTRINE_PINS.map((authority) => ({ ...authority })),
    pieces: DRG_SIXTEEN_PIECE_REGISTRY.map((piece) => ({
      id: piece.id,
      locale: piece.locale,
      title: `Title for ${piece.id}`,
      sourceSha256: sha256(`source:${piece.id}`),
      payload: piece.contentKind === "pdf"
        ? {
            kind: "pdf" as const,
            storageKey: `${firmId}/content/${piece.id}.pdf`,
            filename: `${piece.id}.pdf`,
            mimeType: "application/pdf" as const,
            byteSize: new TextEncoder().encode(`pdf:${piece.id}`).byteLength,
            assetSha256: sha256(`pdf:${piece.id}`),
          }
        : { kind: "text" as const, bodyHtml: `<p>Exact ${piece.id}</p>` },
    })),
  };
  return sealDrgWeeklyPackage(draft, sha256);
}

function pdfIdentities(pkg: SealedDrgWeeklyPackage) {
  return pkg.pieces.filter((piece) => piece.payload.kind === "pdf").map((piece) => ({
    storageKey: piece.payload.kind === "pdf" ? piece.payload.storageKey : "",
    storageObjectId: randomUUID(),
    objectUpdatedAt: "2026-08-09T15:59:00.000Z",
  }));
}

function storageFor(pkg: SealedDrgWeeklyPackage, tamperedPieceId?: string): DrgPackageStorageClient {
  return {
    from: () => ({
      download: async (path: string) => {
        const piece = pkg.pieces.find((candidate) => candidate.payload.kind === "pdf" && candidate.payload.storageKey === path);
        if (!piece || piece.payload.kind !== "pdf") return { data: null, error: { message: "not found" } };
        const bytes = new TextEncoder().encode(tamperedPieceId === piece.id ? `tampered:${piece.id}` : `pdf:${piece.id}`);
        return {
          data: {
            type: "application/pdf",
            arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
          },
          error: null,
        };
      },
    }),
  };
}

function executionAuthorization(pkg: SealedDrgWeeklyPackage): DrgPackageStagingExecutionAuthorizationEvidence {
  return {
    schemaVersion: "drg-package-staging-execution-authorization/v1",
    executionAuthorizationId: randomUUID(),
    firmId: pkg.firmId,
    periodId: pkg.periodId,
    packageId: pkg.packageId,
    packageVersion: pkg.packageVersion,
    packageSha256: pkg.packageSha256,
    operatorRole: "operator",
    operatorId: randomUUID(),
    operatorName: "Test Operator",
    authorizedAt: "2026-08-09T15:55:00.000Z",
    expiresAt: "2026-08-09T16:15:00.000Z",
    signingKeyId: "drg-test-operator-key",
    signingPublicKeySha256: "a".repeat(64),
    authorizationEnvelopeSha256: "b".repeat(64),
    authorizationSignatureBase64: "c2lnbmF0dXJl",
  };
}

function exactSnapshot(pkg: SealedDrgWeeklyPackage, approved = false): DrgPortalStagingSnapshot {
  return {
    firmId: pkg.firmId,
    periodId: pkg.periodId,
    deliverables: pkg.pieces.map((piece, index) => {
      const registry = DRG_SIXTEEN_PIECE_REGISTRY[index];
      const deliverableId = randomUUID();
      const versionId = randomUUID();
      return {
        pieceId: piece.id,
        deliverableId,
        firmId: pkg.firmId,
        periodId: pkg.periodId,
        locale: registry.locale,
        contentKind: registry.contentKind,
        deliverableRole: registry.deliverableRole,
        destination: registry.destination,
        currentVersionId: versionId,
        approvedVersionId: approved ? versionId : null,
        currentVersion: {
          id: versionId,
          versionNumber: 1,
          packageId: pkg.packageId,
          packageVersion: pkg.packageVersion,
          packageSha256: pkg.packageSha256,
          pieceSha256: piece.pieceSha256,
          sourceSha256: piece.sourceSha256,
        },
        approval: approved ? { decision: "approved" as const, versionId, packageSha256: pkg.packageSha256 } : null,
      };
    }),
  };
}

function receipt(pkg: SealedDrgWeeklyPackage, auth: DrgPackageStagingExecutionAuthorizationEvidence, snapshot: DrgPortalStagingSnapshot) {
  return {
    schemaVersion: "drg-package-staging-execution-receipt/v1",
    operationKind: "deliverables_staging",
    releaseAuthorizationGranted: false,
    operationId: randomUUID(),
    idempotencyKey: "drg-stage/exact",
    executionAuthorizationId: auth.executionAuthorizationId,
    operatorRole: auth.operatorRole,
    operatorId: auth.operatorId,
    operatorName: auth.operatorName,
    signingKeyId: auth.signingKeyId,
    signingPublicKeySha256: auth.signingPublicKeySha256,
    authorizationEnvelopeSha256: auth.authorizationEnvelopeSha256,
    firmId: pkg.firmId,
    periodId: pkg.periodId,
    packageId: pkg.packageId,
    packageVersion: pkg.packageVersion,
    packageSha256: pkg.packageSha256,
    committedAt: "2026-08-09T16:00:00.000Z",
    addedCount: 16,
    newVersionCount: 0,
    skippedCount: 0,
    writesPerformed: 16,
    replay: false,
    pieces: snapshot.deliverables.map((row, index) => ({
      pieceId: row.pieceId,
      action: "add",
      deliverableId: row.deliverableId,
      versionId: row.currentVersionId,
      versionNumber: 1,
      pieceSha256: pkg.pieces[index].pieceSha256,
    })),
  };
}

describe("authorized DRG package staging adapter", () => {
  it("executes one atomic RPC and then a fresh zero-write exact reconciliation", async () => {
    const pkg = makePackage();
    const auth = executionAuthorization(pkg);
    const fresh = exactSnapshot(pkg);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: pdfIdentities(pkg), error: null })
      .mockResolvedValueOnce({ data: receipt(pkg, auth, fresh), error: null })
      .mockResolvedValueOnce({ data: fresh, error: null });

    const result = await stageExecutionAuthorizedDrgPackage({
      pkg,
      snapshot: { firmId: pkg.firmId, periodId: pkg.periodId, deliverables: [] },
      executionAuthorization: auth,
      sha256,
      sha256Bytes,
      rpc: { rpc } as DrgPackageStagingRpcClient,
      storage: storageFor(pkg),
      now: new Date("2026-08-09T16:00:00.000Z"),
    });

    expect(result.status).toBe("reconciled");
    expect(result.status === "reconciled" && result.receipt).toMatchObject({
      operationKind: "deliverables_staging",
      releaseAuthorizationGranted: false,
      operatorRole: "operator",
    });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls[0][0]).toBe("read_drg_pdf_storage_identities");
    expect(rpc.mock.calls[1][0]).toBe("stage_drg_weekly_package_atomic");
    expect(rpc.mock.calls[2][0]).toBe("read_drg_package_staging_snapshot");
    expect(result.status === "reconciled" && result.reconciliation).toMatchObject({
      status: "exact_match",
      visible: true,
      writesPerformed: 0,
      correctCount: 16,
    });
  });

  it("fails before any RPC when authorization drifts from package SHA", async () => {
    const pkg = makePackage();
    const auth = { ...executionAuthorization(pkg), packageSha256: "0".repeat(64) };
    const rpc = vi.fn();
    await expect(stageExecutionAuthorizedDrgPackage({
      pkg,
      snapshot: { firmId: pkg.firmId, periodId: pkg.periodId, deliverables: [] },
      executionAuthorization: auth,
      sha256,
      sha256Bytes,
      rpc: { rpc } as DrgPackageStagingRpcClient,
      storage: storageFor(pkg),
      now: new Date("2026-08-09T16:00:00.000Z"),
    })).rejects.toThrow(/exact package scope and SHA/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed operator execution identity before any RPC", async () => {
    const pkg = makePackage();
    const auth = {
      ...executionAuthorization(pkg),
      operatorId: "not-a-uuid",
    } as unknown as DrgPackageStagingExecutionAuthorizationEvidence;
    const rpc = vi.fn();
    await expect(stageExecutionAuthorizedDrgPackage({
      pkg,
      snapshot: { firmId: pkg.firmId, periodId: pkg.periodId, deliverables: [] },
      executionAuthorization: auth,
      sha256,
      sha256Bytes,
      rpc: { rpc } as DrgPackageStagingRpcClient,
      storage: storageFor(pkg),
      now: new Date("2026-08-09T16:00:00.000Z"),
    })).rejects.toThrow(/authenticated operator UUID/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a lawyer/client release field because staging is not release approval", async () => {
    const pkg = makePackage();
    const auth = {
      ...executionAuthorization(pkg),
      authorizerRole: "lawyer",
    } as unknown as DrgPackageStagingExecutionAuthorizationEvidence;
    const rpc = vi.fn();
    await expect(stageExecutionAuthorizedDrgPackage({
      pkg,
      snapshot: { firmId: pkg.firmId, periodId: pkg.periodId, deliverables: [] },
      executionAuthorization: auth,
      sha256,
      sha256Bytes,
      rpc: { rpc } as DrgPackageStagingRpcClient,
      storage: storageFor(pkg),
      now: new Date("2026-08-09T16:00:00.000Z"),
    })).rejects.toThrow(/must not carry lawyer or client release authorization/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects tampered downloaded PDF bytes before the write RPC even when object identity resolves", async () => {
    const pkg = makePackage();
    const auth = executionAuthorization(pkg);
    const firstPdf = pkg.pieces.find((piece) => piece.payload.kind === "pdf")!;
    const rpc = vi.fn().mockResolvedValueOnce({ data: pdfIdentities(pkg), error: null });
    await expect(stageExecutionAuthorizedDrgPackage({
      pkg,
      snapshot: { firmId: pkg.firmId, periodId: pkg.periodId, deliverables: [] },
      executionAuthorization: auth,
      sha256,
      sha256Bytes,
      rpc: { rpc } as DrgPackageStagingRpcClient,
      storage: storageFor(pkg, firstPdf.id),
      now: new Date("2026-08-09T16:00:00.000Z"),
    })).rejects.toThrow(/downloaded bytes do not match/);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("read_drg_pdf_storage_identities");
  });

  it("fails closed when the database receipt drifts after the transaction", async () => {
    const pkg = makePackage();
    const auth = executionAuthorization(pkg);
    const fresh = exactSnapshot(pkg);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: pdfIdentities(pkg), error: null })
      .mockResolvedValueOnce({ data: { ...receipt(pkg, auth, fresh), periodId: randomUUID() }, error: null });
    await expect(stageExecutionAuthorizedDrgPackage({
      pkg,
      snapshot: { firmId: pkg.firmId, periodId: pkg.periodId, deliverables: [] },
      executionAuthorization: auth,
      sha256,
      sha256Bytes,
      rpc: { rpc } as DrgPackageStagingRpcClient,
      storage: storageFor(pkg),
      now: new Date("2026-08-09T16:00:00.000Z"),
    })).rejects.toThrow(/malformed or drifted DRG staging receipt/);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("projects Publishing Kit only from exact standing release evidence, not staging", async () => {
    const pkg = makePackage();
    const snapshot = exactSnapshot(pkg);
    const releaseAuthorization: DrgPackageReleaseAuthorization = {
      releasePath: "standing_authorization",
      releaseEvidenceId: "standing-policy-event-2026-08-09",
      packageId: pkg.packageId,
      packageVersion: pkg.packageVersion,
      packageSha256: pkg.packageSha256,
      approvedAt: "2026-08-09T16:00:00.000Z",
      approvedBy: "DRG standing authorization policy",
      pieces: snapshot.deliverables.map((row, index) => ({
        pieceId: row.pieceId,
        deliverableId: row.deliverableId,
        versionId: row.currentVersionId!,
        versionNumber: row.currentVersion!.versionNumber,
        pieceSha256: pkg.pieces[index].pieceSha256,
        sourceSha256: pkg.pieces[index].sourceSha256,
        assetSha256: pkg.pieces[index].payload.kind === "pdf" ? pkg.pieces[index].payload.assetSha256 : null,
        releaseEvidenceSha256: sha256(`standing-evidence:${row.pieceId}`),
        changeHoldActive: false,
        requiresIndividualReview: false,
        standingAuthorizationEventId: "standing-policy-event-2026-08-09",
      })),
    };
    const rpc = vi.fn().mockResolvedValue({ data: snapshot, error: null });
    const ready = await projectLiveApprovedDrgPublishingKit({
      pkg,
      releaseAuthorization,
      sha256,
      rpc: { rpc } as DrgPackageStagingRpcClient,
    });
    expect(ready.status).toBe("ready");
    expect(ready.pieces).toHaveLength(16);

    const heldReleaseAuthorization = {
      ...releaseAuthorization,
      pieces: releaseAuthorization.pieces.map((piece, index) => index === 0
        ? { ...piece, changeHoldActive: true }
        : piece),
    };
    rpc.mockResolvedValueOnce({ data: snapshot, error: null });
    const blocked = await projectLiveApprovedDrgPublishingKit({
      pkg,
      releaseAuthorization: heldReleaseAuthorization,
      sha256,
      rpc: { rpc } as DrgPackageStagingRpcClient,
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.pieces).toEqual([]);
  });
});
