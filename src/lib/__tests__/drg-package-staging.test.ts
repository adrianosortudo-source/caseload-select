import { createHash, createPrivateKey, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DRG_PACKAGE_VISIBILITY_CONTRACT,
  DRG_REQUIRED_DOCTRINE_PINS,
  DRG_SIXTEEN_PIECE_REGISTRY,
  canonicalJson,
  planDrgPackageStaging,
  projectReleaseAuthorizedDrgPublishingKit,
  reconcileDrgPackageStaging,
  sealDrgWeeklyPackage,
  type DrgPortalStagingSnapshot,
  type DrgWeeklyPackageDraft,
  type SealedDrgWeeklyPackage,
  type StagedDeliverableSnapshot,
} from "../drg-package-staging";
import {
  DRG_RELEASE_AUTHORIZATION_MAX_TTL_MS,
  computeDrgReleaseEvidenceSha256,
  createSignedDrgReleaseAuthorizationEnvelope,
  verifyDrgReleaseAuthorizationEnvelope,
  type DrgReleaseAuthorizationEnvelope,
  type DrgReleaseAuthorizationPath,
  type DrgReleaseAuthorizationPieceSnapshot,
  type VerifiedDrgReleaseAuthorizationEnvelope,
} from "../drg-release-authorization-envelope";

const TEST_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIJ1hsZ3v/VpguoRK9JLsLMREScVpezJpGXA7rAMcrn9g\n-----END PRIVATE KEY-----\n";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pin(id: string, version: string) {
  return { id, version, sha256: sha256(`${id}:${version}`) };
}

function makeDraft(): DrgWeeklyPackageDraft {
  return {
    schemaVersion: "drg-weekly-package/v1",
    packageId: "DRG-2026-W33",
    packageVersion: 1,
    firmId: "firm-drg",
    periodId: "period-2026-w33",
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
            storageKey: `offline/${piece.id}.pdf`,
            filename: `${piece.id}.pdf`,
            mimeType: "application/pdf" as const,
            byteSize: 1024,
            assetSha256: sha256(`pdf:${piece.id}`),
          }
        : { kind: "text" as const, bodyHtml: `<p>Approved source text for ${piece.id}</p>` },
    })),
  };
}

function makePackage(): SealedDrgWeeklyPackage {
  return sealDrgWeeklyPackage(makeDraft(), sha256);
}

function manuallyRehashPackage(
  pkg: SealedDrgWeeklyPackage,
  overrides: Partial<Pick<SealedDrgWeeklyPackage, "pieces" | "doctrine">>,
): SealedDrgWeeklyPackage {
  const pieces = overrides.pieces ?? pkg.pieces;
  const doctrine = overrides.doctrine ?? pkg.doctrine;
  const hashInput = {
    schemaVersion: pkg.schemaVersion,
    packageId: pkg.packageId,
    packageVersion: pkg.packageVersion,
    firmId: pkg.firmId,
    periodId: pkg.periodId,
    sources: pkg.sources,
    doctrine,
    pieces,
  };
  return {
    ...pkg,
    pieces,
    doctrine,
    packageSha256: sha256(canonicalJson(hashInput)),
  };
}

function exactRow(
  pkg: SealedDrgWeeklyPackage,
  index: number,
  approved = false,
): StagedDeliverableSnapshot {
  const piece = pkg.pieces[index];
  const registry = DRG_SIXTEEN_PIECE_REGISTRY.find((entry) => entry.id === piece.id)!;
  const deliverableId = `deliverable-${piece.id}`;
  const versionId = `version-${piece.id}-1`;
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
    approval: approved
      ? { decision: "approved", versionId, packageSha256: pkg.packageSha256 }
      : null,
  };
}

function makeSnapshot(pkg: SealedDrgWeeklyPackage, approved = false): DrgPortalStagingSnapshot {
  return {
    firmId: pkg.firmId,
    periodId: pkg.periodId,
    deliverables: pkg.pieces.map((_, index) => exactRow(pkg, index, approved)),
  };
}

function makeSignedReleaseAuthorization(
  pkg: SealedDrgWeeklyPackage,
  snapshot: DrgPortalStagingSnapshot,
  options: {
    path?: DrgReleaseAuthorizationPath;
    packageSha256?: string;
    mutatePiece?: (piece: Omit<DrgReleaseAuthorizationPieceSnapshot, "evidence_sha256">, index: number) => Omit<DrgReleaseAuthorizationPieceSnapshot, "evidence_sha256">;
    pieceCount?: number;
  } = {},
): DrgReleaseAuthorizationEnvelope {
  const path = options.path ?? "individual_approval";
  const packageSha256 = options.packageSha256 ?? pkg.packageSha256;
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const pieces = pkg.pieces.map((piece, index) => {
      const row = snapshot.deliverables.find((candidate) => candidate.pieceId === piece.id)!;
      const evidence: Omit<DrgReleaseAuthorizationPieceSnapshot, "evidence_sha256"> = {
        piece_id: piece.id,
        firm_id: pkg.firmId,
        period_id: pkg.periodId,
        package_id: pkg.packageId,
        package_version: pkg.packageVersion,
        package_sha256: packageSha256,
        deliverable_id: row.deliverableId,
        current_version_id: row.currentVersion!.id,
        version_number: row.currentVersion!.versionNumber,
        piece_sha256: piece.pieceSha256,
        source_sha256: piece.sourceSha256,
        asset_sha256s: piece.payload.kind === "pdf" ? [piece.payload.assetSha256] : [],
        path,
        approval_record_id: path === "individual_approval" ? `approval-${piece.id}` : null,
        standing_authorization_event_id: path === "standing_authorization" ? "standing-event-1" : null,
        standing_authorization_active: path === "standing_authorization",
        change_hold_active: false,
        requires_individual_review: false,
        revoked_at: null,
        evidence_recorded_at: issuedAt,
      };
      const mutated = options.mutatePiece?.(evidence, index) ?? evidence;
      return { ...mutated, evidence_sha256: computeDrgReleaseEvidenceSha256(mutated) };
    }).slice(0, options.pieceCount ?? 16);
  return createSignedDrgReleaseAuthorizationEnvelope({
    envelopeId: `release:${pkg.packageId}:v${pkg.packageVersion}:${packageSha256}`,
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + DRG_RELEASE_AUTHORIZATION_MAX_TTL_MS).toISOString(),
    package: { id: pkg.packageId, version: pkg.packageVersion, firm_id: pkg.firmId, period_id: pkg.periodId, package_sha256: packageSha256 },
    pieces,
    signer: {
      keyId: "drg-release-rfc8032-test-v1",
      publicKeySpkiSha256: "06e3fd8fda29bb60ab59557de61edb0aecdb231134be30e75b455f8e1b792fa9",
      sign: (payload) => sign(null, payload, createPrivateKey(TEST_PRIVATE_KEY)).toString("base64"),
    },
  });
}

function makeReleaseAuthorization(
  pkg: SealedDrgWeeklyPackage,
  snapshot: DrgPortalStagingSnapshot,
  options: Parameters<typeof makeSignedReleaseAuthorization>[2] = {},
): VerifiedDrgReleaseAuthorizationEnvelope {
  return verifyDrgReleaseAuthorizationEnvelope(makeSignedReleaseAuthorization(pkg, snapshot, options));
}

const INVALID_PROJECTION_TOPOLOGIES: ReadonlyArray<
  readonly [string, (snapshot: DrgPortalStagingSnapshot) => DrgPortalStagingSnapshot]
> = [
  ["wrong firm scope", (snapshot) => ({ ...snapshot, firmId: "other-firm" })],
  ["duplicate and unknown rows", (snapshot) => ({
    ...snapshot,
    deliverables: [
      ...snapshot.deliverables,
      snapshot.deliverables[0],
      { ...snapshot.deliverables[1], pieceId: "UNKNOWN-PIECE" },
    ],
  })],
  ["cross-wired locale", (snapshot) => ({
    ...snapshot,
    deliverables: [
      { ...snapshot.deliverables[0], locale: "pt-BR" },
      ...snapshot.deliverables.slice(1),
    ],
  })],
  ["cross-wired role and destination", (snapshot) => ({
    ...snapshot,
    deliverables: [
      {
        ...snapshot.deliverables[0],
        contentKind: "pdf",
        deliverableRole: "lead_magnet_pdf",
        destination: "email",
      },
      ...snapshot.deliverables.slice(1),
    ],
  })],
];

describe("DRG sixteen-piece registry", () => {
  it("pins exactly the canonical sixteen IDs and locales", () => {
    expect(DRG_SIXTEEN_PIECE_REGISTRY).toHaveLength(16);
    expect(DRG_SIXTEEN_PIECE_REGISTRY.map((piece) => piece.id)).toEqual([
      "CN-EN",
      "CN-PT",
      "CIM-EN",
      "CIM-PT",
      "CHECKLIST-LANDING-EN",
      "CHECKLIST-PDF-EN",
      "CHECKLIST-LANDING-PT",
      "CHECKLIST-PDF-PT",
      "MINUTE-EN",
      "LINKEDIN-CN-EN",
      "LINKEDIN-CIM-EN",
      "LINKEDIN-POST-CN-EN",
      "LINKEDIN-POST-CIM-EN",
      "GBP-CN-EN",
      "GBP-CIM-EN",
      "GBP-CHECKLIST-EN",
    ]);
    expect(DRG_SIXTEEN_PIECE_REGISTRY.filter((piece) => piece.locale === "pt-BR")).toHaveLength(4);
  });

  it("rejects a package with a missing piece instead of planning a partial batch", () => {
    const draft = makeDraft();
    const missing = { ...draft, pieces: draft.pieces.slice(0, -1) };
    expect(() => sealDrgWeeklyPackage(missing, sha256)).toThrow("exactly 16 pieces");
  });
});

describe("sealed package identity", () => {
  it("is canonical, deterministic, and deeply immutable", () => {
    const first = makePackage();
    const second = makePackage();
    expect(first.packageSha256).toBe(second.packageSha256);
    expect(canonicalJson({ z: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"z":1}');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.pieces)).toBe(true);
    expect(Object.isFrozen(first.pieces[0].payload)).toBe(true);
  });

  it("pins content changes into both the piece hash and package hash", () => {
    const first = makePackage();
    const draft = makeDraft();
    const pieces = draft.pieces.map((piece, index) => index === 0
      ? { ...piece, payload: { kind: "text" as const, bodyHtml: "<p>Changed exact bytes</p>" } }
      : piece);
    const changed = sealDrgWeeklyPackage({ ...draft, pieces }, sha256);
    expect(changed.pieces[0].pieceSha256).not.toBe(first.pieces[0].pieceSha256);
    expect(changed.packageSha256).not.toBe(first.packageSha256);
  });

  it("normalizes transport permutations into registry order and one package SHA", () => {
    const draft = makeDraft();
    const reversed = sealDrgWeeklyPackage({ ...draft, pieces: [...draft.pieces].reverse() }, sha256);
    const canonical = sealDrgWeeklyPackage(draft, sha256);
    expect(reversed.packageSha256).toBe(canonical.packageSha256);
    expect(reversed.pieces.map((piece) => piece.id)).toEqual(canonical.pieces.map((piece) => piece.id));
  });

  it("rejects missing or replaced named doctrine authority pins", () => {
    const draft = makeDraft();
    const missingBrandBook = {
      ...draft,
      doctrine: draft.doctrine.filter((authority) => authority.id !== "DRGLaw_BrandBook"),
    };
    expect(() => sealDrgWeeklyPackage(missingBrandBook, sha256)).toThrow("DRGLaw_BrandBook version 13");

    const wrongDecisionRecord = {
      ...draft,
      doctrine: draft.doctrine.map((authority) => authority.id === "DECISION_RECORDS"
        ? pin("DECISION_RECORDS", "DR-117")
        : authority),
    };
    expect(() => sealDrgWeeklyPackage(wrongDecisionRecord, sha256)).toThrow("DECISION_RECORDS version DR-118");

    const wrongCsbHash = {
      ...draft,
      doctrine: draft.doctrine.map((authority) => authority.id === "DRGLaw_ContentStrategy"
        ? { ...authority, sha256: sha256("unapproved-csb-bytes") }
        : authority),
    };
    expect(() => sealDrgWeeklyPackage(wrongCsbHash, sha256)).toThrow("DRGLaw_ContentStrategy version 4.18 SHA-256");
  });

  it("rejects manually reordered sealed pieces even when the package SHA is recomputed", () => {
    const canonical = makePackage();
    const tampered = manuallyRehashPackage(canonical, { pieces: [...canonical.pieces].reverse() });
    const plan = planDrgPackageStaging(
      tampered,
      { firmId: tampered.firmId, periodId: tampered.periodId, deliverables: [] },
      sha256,
    );
    expect(plan.kind).toBe("no_plan");
    if (plan.kind !== "no_plan") throw new Error("expected no plan");
    expect(plan.blockers.some((blocker) => blocker.message.includes("canonical registry order"))).toBe(true);

    const canonicalSnapshot = makeSnapshot(canonical, true);
    const releaseAuthorization = makeReleaseAuthorization(canonical, canonicalSnapshot);
    const snapshot = makeSnapshot(tampered, true);
    const projection = projectReleaseAuthorizedDrgPublishingKit(tampered, snapshot, releaseAuthorization, sha256);
    expect(projection.status).toBe("blocked");
    if (projection.status !== "blocked") throw new Error("expected blocked projection");
    expect(projection.pieces).toEqual([]);
  });

  it("rejects manually reordered doctrine pins even when the package SHA is recomputed", () => {
    const canonical = makePackage();
    const tampered = manuallyRehashPackage(canonical, { doctrine: [...canonical.doctrine].reverse() });
    const plan = planDrgPackageStaging(
      tampered,
      { firmId: tampered.firmId, periodId: tampered.periodId, deliverables: [] },
      sha256,
    );
    expect(plan.kind).toBe("no_plan");
    if (plan.kind !== "no_plan") throw new Error("expected no plan");
    expect(plan.blockers.some((blocker) => blocker.message.includes("doctrine pins") && blocker.message.includes("canonical"))).toBe(true);
  });
});

describe("atomic Deliverables staging plan", () => {
  it("plans sixteen adds with stable natural idempotency keys on an empty snapshot", () => {
    const pkg = makePackage();
    const plan = planDrgPackageStaging(pkg, { firmId: pkg.firmId, periodId: pkg.periodId, deliverables: [] }, sha256);
    expect(plan.kind).toBe("atomic_plan");
    if (plan.kind !== "atomic_plan") throw new Error("expected atomic plan");
    expect(plan.actions).toHaveLength(16);
    expect(plan.actions.every((action) => action.action === "add")).toBe(true);
    expect(new Set(plan.actions.map((action) => action.deliverableIdempotencyKey)).size).toBe(16);
    expect(new Set(plan.actions.map((action) => action.versionIdempotencyKey)).size).toBe(16);
    expect(plan.packageIdempotencyKey).toContain(encodeURIComponent(pkg.packageSha256));
    expect(plan.visibility).toEqual(DRG_PACKAGE_VISIBILITY_CONTRACT);
    expect(plan.writesPerformed).toBe(0);
  });

  it("returns only correct_skip actions for the exact already-staged package", () => {
    const pkg = makePackage();
    const plan = planDrgPackageStaging(pkg, makeSnapshot(pkg), sha256);
    expect(plan.kind).toBe("atomic_plan");
    if (plan.kind !== "atomic_plan") throw new Error("expected atomic plan");
    expect(plan.actions).toHaveLength(16);
    expect(plan.actions.every((action) => action.action === "correct_skip")).toBe(true);
  });

  it("plans only the drifted piece as a new version while keeping one atomic batch", () => {
    const pkg = makePackage();
    const snapshot = makeSnapshot(pkg);
    const first = snapshot.deliverables[0];
    const drifted: DrgPortalStagingSnapshot = {
      ...snapshot,
      deliverables: [
        { ...first, currentVersion: { ...first.currentVersion!, pieceSha256: sha256("drift") } },
        ...snapshot.deliverables.slice(1),
      ],
    };
    const plan = planDrgPackageStaging(pkg, drifted, sha256);
    expect(plan.kind).toBe("atomic_plan");
    if (plan.kind !== "atomic_plan") throw new Error("expected atomic plan");
    expect(plan.actions.filter((action) => action.action === "new_version")).toHaveLength(1);
    expect(plan.actions.filter((action) => action.action === "correct_skip")).toHaveLength(15);
  });

  it("returns no plan when a natural piece identity is cross-wired", () => {
    const pkg = makePackage();
    const snapshot = makeSnapshot(pkg);
    const first = snapshot.deliverables[0];
    const unsafe: DrgPortalStagingSnapshot = {
      ...snapshot,
      deliverables: [{ ...first, locale: "pt-BR" }, ...snapshot.deliverables.slice(1)],
    };
    const plan = planDrgPackageStaging(pkg, unsafe, sha256);
    expect(plan.kind).toBe("no_plan");
    if (plan.kind !== "no_plan") throw new Error("expected no plan");
    expect(plan.actions).toEqual([]);
    expect(plan.blockers.some((blocker) => blocker.code === "deliverable_identity_mismatch")).toBe(true);
    expect(plan.writesPerformed).toBe(0);
  });

  it("returns no plan for malformed deliverable or version identifiers", () => {
    const pkg = makePackage();
    const snapshot = makeSnapshot(pkg);
    const first = snapshot.deliverables[0];
    const second = snapshot.deliverables[1];
    const malformed: DrgPortalStagingSnapshot = {
      ...snapshot,
      deliverables: [
        {
          ...first,
          deliverableId: "",
        },
        {
          ...second,
          currentVersionId: "",
          currentVersion: { ...second.currentVersion!, id: "", versionNumber: 0 },
        },
        ...snapshot.deliverables.slice(2),
      ],
    };
    const plan = planDrgPackageStaging(pkg, malformed, sha256);
    expect(plan.kind).toBe("no_plan");
    if (plan.kind !== "no_plan") throw new Error("expected no plan");
    expect(plan.blockers.some((blocker) => blocker.pieceId === "CN-EN" && blocker.code === "deliverable_identity_mismatch")).toBe(true);
    expect(plan.blockers.some((blocker) => blocker.pieceId === "CN-PT" && blocker.code === "current_version_unresolved")).toBe(true);
  });

  it("keeps a partially staged package hidden and plans the missing remainder", () => {
    const pkg = makePackage();
    const partial = makeSnapshot(pkg);
    const snapshot = { ...partial, deliverables: partial.deliverables.slice(0, 8) };
    const plan = planDrgPackageStaging(pkg, snapshot, sha256);
    expect(plan.kind).toBe("atomic_plan");
    if (plan.kind !== "atomic_plan") throw new Error("expected atomic plan");
    expect(plan.actions.filter((action) => action.action === "correct_skip")).toHaveLength(8);
    expect(plan.actions.filter((action) => action.action === "add")).toHaveLength(8);
    const reconciliation = reconcileDrgPackageStaging(pkg, snapshot, sha256);
    expect(reconciliation.status).toBe("not_reconciled");
    expect(reconciliation.visible).toBe(false);
    expect(reconciliation.writesPerformed).toBe(0);
  });
});

describe("zero-write second reconciliation", () => {
  it("reveals only a fresh exact sixteen-version match and is idempotent", () => {
    const pkg = makePackage();
    const snapshot = makeSnapshot(pkg);
    const first = reconcileDrgPackageStaging(pkg, snapshot, sha256);
    const second = reconcileDrgPackageStaging(pkg, snapshot, sha256);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "exact_match",
      visible: true,
      writesPerformed: 0,
      correctCount: 16,
      missingOrDriftedCount: 0,
    });
  });
});

describe("approved Publishing Kit projection", () => {
  it("projects all sixteen payloads only from each exact current approved version", () => {
    const pkg = makePackage();
    const snapshot = makeSnapshot(pkg, true);
    const releaseAuthorization = makeReleaseAuthorization(pkg, snapshot);
    const projection = projectReleaseAuthorizedDrgPublishingKit(pkg, snapshot, releaseAuthorization, sha256);
    expect(projection.status).toBe("ready");
    if (projection.status !== "ready") throw new Error("expected ready projection");
    expect(projection.pieces).toHaveLength(16);
    expect(projection.pieces.every((piece) => piece.packageSha256 === pkg.packageSha256)).toBe(true);
    expect(projection.pieces.map((piece) => piece.approvedVersionId)).toEqual(
      snapshot.deliverables.map((row) => row.currentVersionId),
    );
    expect(projection.writesPerformed).toBe(0);
  });

  it("projects standing-authorized pieces without approval records", () => {
    const pkg = makePackage();
    const snapshot = makeSnapshot(pkg, false);
    const projection = projectReleaseAuthorizedDrgPublishingKit(
      pkg,
      snapshot,
      makeReleaseAuthorization(pkg, snapshot, { path: "standing_authorization" }),
      sha256,
    );
    expect(projection.status).toBe("ready");
    expect(snapshot.deliverables.every((row) => row.approval === null)).toBe(true);
  });

  it("returns zero pieces when aggregate release authorization names another package SHA", () => {
    const pkg = makePackage();
    const snapshot = makeSnapshot(pkg, true);
    const releaseAuthorization = makeReleaseAuthorization(pkg, snapshot, { packageSha256: sha256("other-package") });
    const projection = projectReleaseAuthorizedDrgPublishingKit(pkg, snapshot, releaseAuthorization, sha256);
    expect(projection.status).toBe("blocked");
    if (projection.status !== "blocked") throw new Error("expected blocked projection");
    expect(projection.pieces).toEqual([]);
    expect(projection.blockers.some((blocker) => blocker.message.includes("exact package SHA"))).toBe(true);
    expect(projection.writesPerformed).toBe(0);
  });

  it("returns zero pieces when one approved version is no longer current", () => {
    const pkg = makePackage();
    const snapshot = makeSnapshot(pkg, true);
    const first = snapshot.deliverables[0];
    const superseded: DrgPortalStagingSnapshot = {
      ...snapshot,
      deliverables: [
        { ...first, currentVersionId: "version-CN-EN-2" },
        ...snapshot.deliverables.slice(1),
      ],
    };
    const projection = projectReleaseAuthorizedDrgPublishingKit(pkg, superseded, makeReleaseAuthorization(pkg, snapshot), sha256);
    expect(projection.status).toBe("blocked");
    if (projection.status !== "blocked") throw new Error("expected blocked projection");
    expect(projection.pieces).toEqual([]);
    expect(projection.blockers.some((blocker) => blocker.pieceId === "CN-EN")).toBe(true);
  });

  it("rejects partial signed release authorization before projection", () => {
    const pkg = makePackage();
    const snapshot = makeSnapshot(pkg, true);
    expect(() => verifyDrgReleaseAuthorizationEnvelope(
      makeSignedReleaseAuthorization(pkg, snapshot, { pieceCount: 15 }),
    )).toThrow("exactly sixteen");
  });

  it.each([
    ["active change hold", (piece: Omit<DrgReleaseAuthorizationPieceSnapshot, "evidence_sha256">) => ({ ...piece, change_hold_active: true })],
    ["individual-review exception", (piece: Omit<DrgReleaseAuthorizationPieceSnapshot, "evidence_sha256">) => ({ ...piece, requires_individual_review: true })],
    ["revoked standing event", (piece: Omit<DrgReleaseAuthorizationPieceSnapshot, "evidence_sha256">) => ({ ...piece, revoked_at: "2026-08-09T18:00:00.000Z" })],
  ] as const)("rejects a signed standing envelope with %s", (_label, mutatePiece) => {
    const pkg = makePackage();
    const snapshot = makeSnapshot(pkg, false);
    expect(() => makeReleaseAuthorization(pkg, snapshot, {
      path: "standing_authorization",
      mutatePiece: (piece, index) => index === 0 ? mutatePiece(piece) : piece,
    })).toThrow();
  });

  it("rejects forged evidence and signature before a branded result exists", () => {
    const pkg = makePackage();
    const snapshot = makeSnapshot(pkg, true);
    const forgedEvidence = structuredClone(makeSignedReleaseAuthorization(pkg, snapshot));
    (forgedEvidence.pieces[0] as { source_sha256: string }).source_sha256 = sha256("forged-source");
    expect(() => verifyDrgReleaseAuthorizationEnvelope(forgedEvidence)).toThrow("evidence SHA mismatch");
    const forgedSignature = structuredClone(makeSignedReleaseAuthorization(pkg, snapshot));
    (forgedSignature.signature as { signature_base64: string }).signature_base64 = Buffer.from("forged").toString("base64");
    expect(() => verifyDrgReleaseAuthorizationEnvelope(forgedSignature)).toThrow("signature verification failed");
  });

  it.each(INVALID_PROJECTION_TOPOLOGIES)("returns zero pieces when staging topology has %s", (_label, mutate) => {
    const pkg = makePackage();
    const snapshot = makeSnapshot(pkg, true);
    const projection = projectReleaseAuthorizedDrgPublishingKit(pkg, mutate(snapshot), makeReleaseAuthorization(pkg, snapshot), sha256);
    expect(projection.status).toBe("blocked");
    if (projection.status !== "blocked") throw new Error("expected blocked projection");
    expect(projection.pieces).toEqual([]);
    expect(projection.blockers.some((blocker) => blocker.message.includes("staging reconciliation"))).toBe(true);
  });
});
