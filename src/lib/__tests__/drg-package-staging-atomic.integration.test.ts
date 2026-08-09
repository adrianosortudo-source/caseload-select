/**
 * Fresh-Postgres proof for the DRG package staging RPC. This suite is skipped
 * outside the CI Supabase job because transaction serialization and database
 * constraints cannot be established with a mocked client.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DRG_REQUIRED_DOCTRINE_PINS,
  DRG_SIXTEEN_PIECE_REGISTRY,
  canonicalJson,
  planDrgPackageStaging,
  sealDrgWeeklyPackage,
  type DrgWeeklyPackageDraft,
} from "../drg-package-staging";

const DB_URL = process.env.DIRECT_DATABASE_URL;

function connectionOptions(url: string) {
  const trimmed = url.trim();
  const unquoted = trimmed.length >= 2 && (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) ? trimmed.slice(1, -1) : trimmed;
  const parsed = new URL(unquoted);
  return {
    host: decodeURIComponent(parsed.hostname),
    port: parsed.port ? Number(parsed.port) : undefined,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || undefined,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe.skipIf(!DB_URL)("stage_drg_weekly_package_atomic (real Postgres)", () => {
  let Client: typeof import("pg").Client;
  let connA: import("pg").Client;
  let connB: import("pg").Client;
  const firmId = randomUUID();
  const periodId = randomUUID();
  const actorId = randomUUID();
  const authorizationId = randomUUID();

  const pin = (id: string, version: string) => ({ id, version, sha256: sha256(`${id}:${version}`) });
  const draft: DrgWeeklyPackageDraft = {
    schemaVersion: "drg-weekly-package/v1",
    packageId: `DRG-INTEGRATION-${periodId}`,
    packageVersion: 1,
    firmId,
    periodId,
    sources: {
      topicSelection: pin("topic-selection", "integration"),
      researchEvidence: pin("research-evidence", "integration"),
      contentManifest: pin("content-manifest", "integration"),
    },
    doctrine: DRG_REQUIRED_DOCTRINE_PINS.map((item) => ({ ...item })),
    pieces: DRG_SIXTEEN_PIECE_REGISTRY.map((piece) => ({
      id: piece.id,
      locale: piece.locale,
      title: `Integration ${piece.id}`,
      sourceSha256: sha256(`source:${piece.id}`),
      payload: piece.contentKind === "pdf"
        ? {
            kind: "pdf" as const,
            storageKey: `${firmId}/integration/${piece.id}.pdf`,
            filename: `${piece.id}.pdf`,
            mimeType: "application/pdf" as const,
            byteSize: 100,
            assetSha256: sha256(`asset:${piece.id}`),
          }
        : { kind: "text" as const, bodyHtml: `<p>Integration ${piece.id}</p>` },
    })),
  };
  const pkg = sealDrgWeeklyPackage(draft, sha256);
  const emptySnapshot = { firmId, periodId, deliverables: [] } as const;
  const plan = planDrgPackageStaging(pkg, emptySnapshot, sha256);
  if (plan.kind !== "atomic_plan") throw new Error("integration fixture must create an atomic plan");
  const canonicalPackage = canonicalJson({
    schemaVersion: pkg.schemaVersion,
    packageId: pkg.packageId,
    packageVersion: pkg.packageVersion,
    firmId: pkg.firmId,
    periodId: pkg.periodId,
    sources: pkg.sources,
    doctrine: pkg.doctrine,
    pieces: pkg.pieces,
  });

  beforeAll(async () => {
    ({ Client } = await import("pg"));
    connA = new Client(connectionOptions(DB_URL!));
    connB = new Client(connectionOptions(DB_URL!));
    await connA.connect();
    await connB.connect();
    await connA.query(
      `insert into intake_firms (id, name, custom_domain, subdomain)
       values ($1, 'DRG staging integration fixture', null, $2)`,
      [firmId, `drg-staging-${firmId}`],
    );
    await connA.query(
      `insert into content_periods (id, firm_id, starts_on, ends_on, theme, created_by_role)
       values ($1, $2, current_date, current_date + 4, 'DRG staging integration', 'operator')`,
      [periodId, firmId],
    );
    for (const piece of pkg.pieces.filter((candidate) => candidate.payload.kind === "pdf")) {
      if (piece.payload.kind !== "pdf") continue;
      await connA.query(
        `insert into storage.objects (bucket_id, name, metadata)
         values ('firm-files', $1, jsonb_build_object(
           'mimetype', 'application/pdf', 'size', $2::bigint
         ))`,
        [piece.payload.storageKey, piece.payload.byteSize],
      );
    }
  }, 30_000);

  afterAll(async () => {
    if (connA) await connA.end();
    if (connB) await connB.end();
  });

  it("rolls back all prior piece inserts when stored PDF byte evidence mismatches", async () => {
    const now = Date.now();
    const rejectedAuthorization = {
      schemaVersion: "drg-package-staging-execution-authorization/v1",
      executionAuthorizationId: randomUUID(),
      firmId,
      periodId,
      packageId: pkg.packageId,
      packageVersion: pkg.packageVersion,
      packageSha256: pkg.packageSha256,
      operatorRole: "operator",
      operatorId: actorId,
      operatorName: "Integration Operator",
      authorizedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 10 * 60_000).toISOString(),
      signingKeyId: "drg-integration-lawyer-key",
      signingPublicKeySha256: "a".repeat(64),
      authorizationEnvelopeSha256: "b".repeat(64),
      authorizationSignatureBase64: "c2lnbmF0dXJl",
    };
    const keys = pkg.pieces.filter((piece) => piece.payload.kind === "pdf").map((piece) => piece.payload.kind === "pdf" ? piece.payload.storageKey : "");
    const identities = await connA.query(
      `select public.read_drg_pdf_storage_identities($1::text[]) as identities`,
      [keys],
    );
    const identityByKey = new Map(identities.rows[0].identities.map((item: { storageKey: string }) => [item.storageKey, item]));
    const evidence = pkg.pieces.filter((piece) => piece.payload.kind === "pdf").map((piece) => {
      if (piece.payload.kind !== "pdf") throw new Error("fixture topology drift");
      return {
        pieceId: piece.id,
        storageKey: piece.payload.storageKey,
        ...(identityByKey.get(piece.payload.storageKey) as object),
        assetSha256: piece.payload.assetSha256,
        byteSize: piece.payload.byteSize,
        mimeType: piece.payload.mimeType,
      };
    });
    const mismatchedEvidence = evidence.map((item, index) => index === 0 ? { ...item, assetSha256: "0".repeat(64) } : item);
    await expect(connA.query(
      `select public.stage_drg_weekly_package_atomic($1::jsonb, $2::text, $3::jsonb, $4::jsonb, $5::jsonb)`,
      [JSON.stringify(pkg), canonicalPackage, JSON.stringify(plan), JSON.stringify(rejectedAuthorization), JSON.stringify(mismatchedEvidence)],
    )).rejects.toThrow(/byte evidence mismatch/i);
    const afterRejection = await connA.query(
      `select
         (select count(*)::int from drg_package_staging_operations where firm_id = $1 and period_id = $2) as operations,
         (select count(*)::int from content_deliverables where firm_id = $1 and period_id = $2 and drg_piece_id is not null) as deliverables,
         (select count(*)::int from deliverable_versions where firm_id = $1 and drg_package_sha256 = $3) as versions`,
      [firmId, periodId, pkg.packageSha256],
    );
    expect(afterRejection.rows[0]).toEqual({ operations: 0, deliverables: 0, versions: 0 });

    const releaseFieldAuthorization = {
      ...rejectedAuthorization,
      executionAuthorizationId: randomUUID(),
      authorizerRole: "lawyer",
    };
    await expect(connA.query(
      `select public.stage_drg_weekly_package_atomic($1::jsonb, $2::text, $3::jsonb, $4::jsonb, $5::jsonb)`,
      [JSON.stringify(pkg), canonicalPackage, JSON.stringify(plan), JSON.stringify(releaseFieldAuthorization), JSON.stringify(evidence)],
    )).rejects.toThrow(/execution authorization/i);

  }, 30_000);

  it("serializes concurrent identical calls into one commit and one zero-write replay", async () => {
    const now = Date.now();
    const authorization = {
      schemaVersion: "drg-package-staging-execution-authorization/v1",
      executionAuthorizationId: authorizationId,
      firmId,
      periodId,
      packageId: pkg.packageId,
      packageVersion: pkg.packageVersion,
      packageSha256: pkg.packageSha256,
      operatorRole: "operator",
      operatorId: actorId,
      operatorName: "Integration Operator",
      authorizedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 10 * 60_000).toISOString(),
      signingKeyId: "drg-integration-lawyer-key",
      signingPublicKeySha256: "a".repeat(64),
      authorizationEnvelopeSha256: "b".repeat(64),
      authorizationSignatureBase64: "c2lnbmF0dXJl",
    };
    const keys = pkg.pieces.filter((piece) => piece.payload.kind === "pdf").map((piece) => piece.payload.kind === "pdf" ? piece.payload.storageKey : "");
    const identities = await connA.query(`select public.read_drg_pdf_storage_identities($1::text[]) as identities`, [keys]);
    const identityByKey = new Map(identities.rows[0].identities.map((item: { storageKey: string }) => [item.storageKey, item]));
    const evidence = pkg.pieces.filter((piece) => piece.payload.kind === "pdf").map((piece) => {
      if (piece.payload.kind !== "pdf") throw new Error("fixture topology drift");
      return {
        pieceId: piece.id,
        storageKey: piece.payload.storageKey,
        ...(identityByKey.get(piece.payload.storageKey) as object),
        assetSha256: piece.payload.assetSha256,
        byteSize: piece.payload.byteSize,
        mimeType: piece.payload.mimeType,
      };
    });
    const sql = `select public.stage_drg_weekly_package_atomic($1::jsonb, $2::text, $3::jsonb, $4::jsonb, $5::jsonb) as receipt`;
    const args = [JSON.stringify(pkg), canonicalPackage, JSON.stringify(plan), JSON.stringify(authorization), JSON.stringify(evidence)];
    const [left, right] = await Promise.all([connA.query(sql, args), connB.query(sql, args)]);
    const receipts = [left.rows[0].receipt, right.rows[0].receipt];

    expect(receipts.map((item) => item.replay).sort()).toEqual([false, true]);
    expect(receipts.find((item) => item.replay === false)).toMatchObject({
      schemaVersion: "drg-package-staging-execution-receipt/v1",
      packageSha256: pkg.packageSha256,
      operatorRole: "operator",
      operatorId: actorId,
      signingKeyId: "drg-integration-lawyer-key",
      signingPublicKeySha256: "a".repeat(64),
      authorizationEnvelopeSha256: "b".repeat(64),
      addedCount: 16,
      newVersionCount: 0,
      skippedCount: 0,
      writesPerformed: 16,
    });
    expect(receipts.find((item) => item.replay === true)?.writesPerformed).toBe(0);

    const counts = await connA.query(
      `select
         (select count(*)::int from drg_package_staging_operations where firm_id = $1 and period_id = $2) as operations,
         (select count(*)::int from content_deliverables where firm_id = $1 and period_id = $2 and drg_piece_id is not null) as deliverables,
         (select count(*)::int from deliverable_versions where firm_id = $1 and drg_package_sha256 = $3) as versions`,
      [firmId, periodId, pkg.packageSha256],
    );
    expect(counts.rows[0]).toEqual({ operations: 1, deliverables: 16, versions: 16 });

    const snapshot = await connA.query(
      `select public.read_drg_package_staging_snapshot($1, $2) as snapshot`,
      [firmId, periodId],
    );
    expect(snapshot.rows[0].snapshot.deliverables).toHaveLength(16);
    expect(snapshot.rows[0].snapshot.deliverables.every((row: { currentVersionId: string | null }) => Boolean(row.currentVersionId))).toBe(true);
  }, 30_000);

  it("rejects authorization drift without changing the committed topology", async () => {
    const operation = await connA.query(
      `select package_canonical, receipt, authorization_payload, pdf_evidence from drg_package_staging_operations
       where firm_id = $1 and period_id = $2`,
      [firmId, periodId],
    );
    const prior = operation.rows[0];
    const drifted = { ...prior.authorization_payload, operatorName: "Different Operator" };
    await expect(connA.query(
      `select public.stage_drg_weekly_package_atomic($1::jsonb, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
      [JSON.stringify(pkg), prior.package_canonical, JSON.stringify(plan), JSON.stringify(drifted), JSON.stringify(prior.pdf_evidence)],
    )).rejects.toThrow(/replay drifted/i);
    const counts = await connA.query(
      `select count(*)::int as operations from drg_package_staging_operations where firm_id = $1 and period_id = $2`,
      [firmId, periodId],
    );
    expect(counts.rows[0].operations).toBe(1);
  });
});
