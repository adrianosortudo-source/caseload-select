import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import {
  buildProspectEnrichmentClientItems,
  parseProspectEnrichmentEnvelope,
  type ProspectEnrichmentEnvelope,
} from "../../src/lib/prospect-enrichment-contract";
import {
  prospectEnrichmentIdempotencyKey,
  prospectEnrichmentPayloadSha256,
  prospectEnrichmentProtocolHash,
  prospectEnrichmentSha256,
} from "../../src/lib/prospect-enrichment-hash";

type FixtureKind = "review" | "applied" | "held" | "conflict" | "intake";
type ManifestEntry = {
  entryId: string;
  researchKey: string;
  clientPackageId: string;
  expectedPayloadSha256: string;
  itemCount: number;
  clientItems: ReturnType<typeof buildProspectEnrichmentClientItems>;
  initialDisposition: "ready_for_review" | "identity_hold";
  source: { sourceRoot: string; relativePath: string; sourcePointer: string; fileSha256: string };
  errorCodes: string[];
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required for the disposable rendered fixture seed.");
  return value;
}

function assertLocalDatabase(raw: string): URL {
  const url = new URL(raw.replace(/^["']|["']$/g, ""));
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!(["postgres:", "postgresql:"].includes(url.protocol)) || !["127.0.0.1", "::1"].includes(host)
    || !url.port || url.pathname !== "/postgres") {
    throw new Error("Rendered fixture seeding requires direct Postgres on an explicit loopback address and the postgres database.");
  }
  return url;
}

function assertTemporaryOutput(file: string): string {
  const absolute = path.resolve(file);
  const tempRoot = path.resolve(os.tmpdir());
  const relative = path.relative(tempRoot, absolute);
  if (!path.isAbsolute(file) || !relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("PROSPECT_ENRICHMENT_RENDERED_MANIFEST must be an absolute path under the operating-system temporary directory.");
  }
  return absolute;
}

function makeEnvelope(input: {
  kind: FixtureKind;
  suffix: string;
  runId: string;
  sourceSystem: string;
  sourceName: string;
  sourceRecordKey: string;
  firmId: string;
  generatedAt: string;
}): ProspectEnrichmentEnvelope {
  const { kind, suffix, runId, sourceSystem, sourceName, sourceRecordKey, firmId, generatedAt } = input;
  const researchKey = `enrichment-fixture-${kind}-${suffix}`;
  const packageId = `enrichment-fixture-${kind}-${suffix.slice(0, 12)}`;
  const displayName = "Synthetic Enrichment Fixture";
  const fixtureContent = { synthetic: true, fixture: "prospect-enrichment-rendered/v1", kind, suffix };
  const resolved = kind === "review" || kind === "applied" || kind === "intake";
  const identityState = resolved ? "resolved" : kind === "conflict" ? "conflict" : "unresolved";
  const source = {
    sourceId: "fixture-source",
    url: `https://${suffix}.synthetic.test/team`,
    requestedUrl: `https://${suffix}.synthetic.test/team`,
    finalUrl: `https://${suffix}.synthetic.test/team`,
    policyState: "public-source" as const,
    publicationLabel: null,
    publicationPrecision: "unknown" as const,
    publisher: "Synthetic local acceptance fixture",
    observedAt: null,
    observedOn: generatedAt.slice(0, 10),
    retrievedAt: generatedAt,
    retrievalMethod: "synthetic-fixture",
    retrievalOutcome: "success-positive",
    httpStatus: 200,
    bodySha256: prospectEnrichmentSha256(`synthetic rendered fixture source ${kind} ${suffix}`),
    excerpt: `${displayName} appears on this synthetic team page. This local-only acceptance fixture records a clearly invented public source, a dated observation, and a complete provenance chain so the rendered review, evidence, and import states can be inspected without using any real firm's information. The fixture creates no contact, outreach, or external network request.`,
    missingProvenanceReason: null,
  };
  const observation = {
    observationId: "fixture-research-attempt",
    evidenceState: "asserted" as const,
    retractionReason: null,
    retractionSourceIds: [] as string[],
    missingProvenanceReason: null,
    kind: "research_attempt" as const,
    observedAt: null,
    observedOn: generatedAt.slice(0, 10),
    sourceIds: [source.sourceId],
    data: {
      provider: "Synthetic local fixture",
      queryOrUrl: source.url,
      outcome: "success-positive",
      coverage: "complete" as const,
      failureReason: null,
    },
    existingRecord: null,
  };
  const candidate = {
    schemaVersion: "prospect-enrichment/v1" as const,
    runId,
    packageId,
    supersedesPackageId: null,
    sourceSystem,
    sourceName,
    generatedAt,
    mode: "propose" as const,
    subject: {
      researchKey,
      databaseFirmId: resolved ? firmId : null,
      stableFirmId: null,
      sourceRecordKey: resolved ? sourceRecordKey : null,
      canonicalDomain: null,
      displayName,
      identityState,
    },
    sources: [source],
    observations: [observation],
    assessment: null,
    originalResearch: {
      sourcePath: `synthetic/rendered/${kind}.json`,
      sourceSha256: prospectEnrichmentProtocolHash(fixtureContent),
      sourcePointer: "/fixtures/0",
      contentSha256: prospectEnrichmentProtocolHash(fixtureContent),
      content: fixtureContent,
      unmappedPaths: [],
    },
    controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false },
  };
  const parsed = parseProspectEnrichmentEnvelope(candidate);
  if (!parsed.ok) throw new Error("Synthetic rendered envelope failed its shared protocol validator: " + parsed.issues.map((issue) => issue.path).join(", "));
  return parsed.envelope;
}

function manifestEntry(envelope: ProspectEnrichmentEnvelope, kind: FixtureKind, suffix: string): ManifestEntry {
  const clientItems = buildProspectEnrichmentClientItems(envelope);
  return {
    entryId: `entry-${kind}-${suffix}`,
    researchKey: envelope.subject.researchKey,
    clientPackageId: envelope.packageId,
    expectedPayloadSha256: prospectEnrichmentPayloadSha256(envelope),
    itemCount: clientItems.length,
    clientItems,
    initialDisposition: envelope.subject.identityState === "resolved" ? "ready_for_review" : "identity_hold",
    source: { sourceRoot: "synthetic-test-only", relativePath: `synthetic/rendered/${kind}.json`, sourcePointer: "/fixtures/0", fileSha256: envelope.originalResearch.sourceSha256 },
    errorCodes: [],
  };
}

function stageInputs(envelope: ProspectEnrichmentEnvelope) {
  const lineage = new Map(buildProspectEnrichmentClientItems(envelope).map((item) => [item.clientItemId, item]));
  const sources = envelope.sources.map((source) => {
    const item = lineage.get(`src:${source.sourceId}`)!;
    return {
      sourceId: source.sourceId, clientItemId: item.clientItemId, sourceEventKey: item.sourceEventKey,
      semanticSha256: item.semanticSha256, data: source, observedAt: source.observedAt, observedOn: source.observedOn,
      provenanceState: source.missingProvenanceReason || source.policyState === "policy-blocked" ? "partial" : "complete",
    };
  });
  const items = [
    ...envelope.observations.map((observation) => {
      const item = lineage.get(`obs:${observation.observationId}`)!;
      return {
        clientItemId: item.clientItemId, itemKind: item.itemKind, sourceEventKey: item.sourceEventKey,
        semanticSha256: item.semanticSha256, data: observation, sourceIds: observation.sourceIds,
        observedAt: observation.observedAt, observedOn: observation.observedOn,
        provenanceState: observation.missingProvenanceReason ? "partial" : "complete",
      };
    }),
    ...(envelope.assessment ? [(() => {
      const assessment = envelope.assessment!;
      const item = lineage.get(`assessment:${assessment.assessmentId}`)!;
      return {
        clientItemId: item.clientItemId, itemKind: item.itemKind, sourceEventKey: item.sourceEventKey,
        semanticSha256: item.semanticSha256, data: assessment, sourceIds: assessment.sourceIds,
        observedAt: assessment.assessedAt, observedOn: assessment.assessedOn,
        provenanceState: assessment.missingProvenanceReason ? "partial" : "complete",
      };
    })()] : []),
  ];
  return { sources, items };
}

async function stage(client: PoolClient, actor: string, envelope: ProspectEnrichmentEnvelope) {
  const input = stageInputs(envelope);
  const rawBody = JSON.stringify(envelope);
  const result = await client.query<{ receipt: Record<string, unknown> }>(
    `SELECT public.stage_prospect_enrichment_package_v1(
       $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14::jsonb,$15
     ) AS receipt`,
    [
      actor, envelope.runId, envelope.sourceSystem, envelope.sourceName, envelope.packageId,
      prospectEnrichmentIdempotencyKey(envelope.sourceSystem, envelope.runId, envelope.packageId),
      rawBody, prospectEnrichmentSha256(rawBody), JSON.stringify(envelope), prospectEnrichmentPayloadSha256(envelope),
      envelope.subject.researchKey, envelope.subject.identityState, JSON.stringify(input.items), JSON.stringify(input.sources),
      envelope.supersedesPackageId,
    ],
  );
  const receipt = result.rows[0]?.receipt;
  if (!receipt || receipt.outcome !== "created" || typeof receipt.packageId !== "string") {
    throw new Error("Synthetic package stage failed its exact database receipt check.");
  }
  return receipt;
}

async function seed() {
  if (required("PROSPECT_ENRICHMENT_DISPOSABLE_DATABASE_CONFIRMATION") !== "YES-LOCAL-DISPOSABLE-ONLY") {
    throw new Error("Set PROSPECT_ENRICHMENT_DISPOSABLE_DATABASE_CONFIRMATION=YES-LOCAL-DISPOSABLE-ONLY only for the disposable local/CI database.");
  }
  const portalSecret = required("PROSPECT_ENRICHMENT_TEST_PORTAL_SECRET");
  const agentToken = required("PROSPECT_ENRICHMENT_TEST_AGENT_TOKEN");
  if (!portalSecret.toLowerCase().includes("test") || !agentToken.toLowerCase().includes("test")) {
    throw new Error("Rendered fixture seeding requires test-only portal and agent credentials.");
  }
  const serviceRoleKey = required("PROSPECT_ENRICHMENT_TEST_SUPABASE_SERVICE_ROLE_KEY");
  const databaseUrl = assertLocalDatabase(required("PROSPECT_ENRICHMENT_TEST_DATABASE_URL"));
  const apiUrl = new URL(required("PROSPECT_ENRICHMENT_TEST_SUPABASE_URL"));
  if (apiUrl.protocol !== "http:" || !["127.0.0.1", "::1"].includes(apiUrl.hostname.replace(/^\[|\]$/g, "")) || !apiUrl.port) {
    throw new Error("Rendered fixture seeding requires an explicit HTTP loopback Supabase URL.");
  }
  if (!serviceRoleKey.trim()) throw new Error("A local Supabase service-role key is required by the rendered app.");
  const outputFile = assertTemporaryOutput(required("PROSPECT_ENRICHMENT_RENDERED_MANIFEST"));
  const stageEnvelopePath = path.join(path.dirname(outputFile), `stage-envelope-${randomUUID()}.json`);
  const comparisonRequestPath = path.join(path.dirname(outputFile), `comparison-request-${randomUUID()}.json`);
  const actor = (process.env.GTA_PROSPECT_AGENT_DRAFT_ACTOR?.trim().toLowerCase() || "authorized-agent");
  if (!/^[-_a-z0-9]{1,120}$/.test(actor)) throw new Error("GTA_PROSPECT_AGENT_DRAFT_ACTOR is invalid for the synthetic fixture.");
  const suffix = randomUUID().replaceAll("-", "");
  const runKey = `run-${suffix}`;
  const sourceSystem = "prospect-enrichment-rendered-test";
  const sourceName = "synthetic-rendered-acceptance-fixture";
  const sourceRecordKey = `seed-${suffix}`;
  const generatedAt = new Date().toISOString();
  const pool = new Pool({ connectionString: databaseUrl.toString(), max: 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 5_000 });
  const client = await pool.connect();
  try {
    const preflight = await client.query<{ database_name: string; current_user: string; migrations_present: boolean }>(
      `SELECT current_database() AS database_name, current_user,
        to_regclass('public.prospect_enrichment_runs') IS NOT NULL
        AND to_regclass('public.prospect_enrichment_run_manifest_items') IS NOT NULL
        AND to_regprocedure('public.stage_prospect_enrichment_package_v1(text,text,text,text,text,text,text,text,jsonb,text,text,text,jsonb,jsonb,text)') IS NOT NULL
        AND to_regprocedure('public.register_prospect_enrichment_manifest_chunk_v1(text,jsonb,boolean)') IS NOT NULL AS migrations_present`,
    );
    if (preflight.rows[0]?.database_name !== "postgres" || !preflight.rows[0]?.migrations_present) {
      throw new Error("The connected loopback database is not the expected migrated disposable Supabase database.");
    }

    await client.query("BEGIN");
    const portal = await client.query<{ id: string }>(
      `INSERT INTO public.intake_firms(name) VALUES ($1) RETURNING id`,
      [`Synthetic rendered-test operator ${suffix.slice(0, 10)}`],
    );
    const operator = await client.query<{ id: string }>(
      `INSERT INTO public.firm_lawyers(firm_id,email,name,role,disabled)
       VALUES ($1,$2,$3,'operator',false) RETURNING id`,
      [portal.rows[0].id, `rendered-${suffix}@synthetic.test`, "Synthetic Rendered Test Operator"],
    );
    const prospectFirm = await client.query<{ id: string }>(
      `INSERT INTO public.gta_prospect_firms(source_record_key,display_name,normalized_display_name,reconciliation_status)
       VALUES ($1,$2,$3,'update_existing') RETURNING id`,
      [sourceRecordKey, `Synthetic Enrichment Fixture ${suffix.slice(0, 8)}`, `synthetic enrichment fixture ${suffix.slice(0, 8)}`],
    );
    const firmId = prospectFirm.rows[0].id;
    const runEnvelopes = new Map<FixtureKind, ProspectEnrichmentEnvelope>();
    for (const kind of ["review", "applied", "held", "conflict", "intake"] as const) {
      runEnvelopes.set(kind, makeEnvelope({ kind, suffix, runId: runKey, sourceSystem, sourceName, sourceRecordKey, firmId, generatedAt }));
    }
    const entries = [...runEnvelopes].map(([kind, envelope]) => manifestEntry(envelope, kind, suffix)).sort((a, b) => a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0);
    const sourceManifestSha256 = prospectEnrichmentProtocolHash({ fixture: "prospect-enrichment-rendered/v1", suffix, entries: entries.map((entry) => entry.entryId) });
    const manifestBase = { schemaVersion: "prospect-enrichment-run-manifest/v1", runId: runKey, sourceSystem, sourceName, sourceManifestSha256, generatedAt, expectedPackageCount: entries.length, entries };
    const manifestSha256 = prospectEnrichmentProtocolHash(manifestBase);
    const comparisonRequest = {
      schemaVersion: "prospect-enrichment-comparison-request/v1",
      manifest: { ...manifestBase, manifestSha256 },
      packages: [...runEnvelopes.values()].map((envelope) => ({ envelope, payloadSha256: prospectEnrichmentPayloadSha256(envelope), legacyAssessmentProjectionClaims: [] })),
    };
    const chunk = {
      schemaVersion: "prospect-enrichment-run-manifest-chunk/v1",
      adapterVersion: "rendered-fixture/v1", runId: runKey, sourceSystem, sourceName,
      sourceManifestSha256, runManifestSha256: manifestSha256, generatedAt,
      expectedPackageCount: entries.length, expectedEntryCount: entries.length,
      chunkIndex: 0, chunkCount: 1, chunkSha256: prospectEnrichmentProtocolHash(entries), entries,
    };
    const register = async (finalize: boolean) => {
      const result = await client.query<{ receipt: Record<string, unknown> }>(
        `SELECT public.register_prospect_enrichment_manifest_chunk_v1($1,$2::jsonb,$3) AS receipt`,
        [actor, JSON.stringify(chunk), finalize],
      );
      return result.rows[0]?.receipt;
    };
    const stagedChunk = await register(false);
    if (stagedChunk?.outcome !== "chunk_registered" || stagedChunk.manifestState !== "open") throw new Error("Rendered fixture manifest chunk was not registered exactly.");
    const finalized = await register(true);
    if (finalized?.outcome !== "finalized" || finalized.manifestState !== "finalized"
      || finalized.manifestSha256 !== manifestSha256 || finalized.receivedEntryCount !== entries.length
      || finalized.receivedPackageCount !== entries.length || finalized.registeredChunkCount !== 1) {
      throw new Error("Rendered fixture manifest did not return the exact finalized receipt.");
    }

    const receipts = new Map<FixtureKind, Record<string, unknown>>();
    for (const kind of ["review", "applied", "held", "conflict"] as const) {
      receipts.set(kind, await stage(client, actor, runEnvelopes.get(kind)!));
    }

    for (const kind of ["review", "applied"] as const) {
      if (kind !== "applied") continue;
      const envelope = runEnvelopes.get(kind)!;
      const packageId = String(receipts.get(kind)!.packageId);
      const rows = await client.query<{ id: string }>(
        `SELECT id FROM public.prospect_enrichment_items WHERE package_id=$1 ORDER BY client_item_id`, [packageId],
      );
      const review = {
        payloadSha256: prospectEnrichmentPayloadSha256(envelope),
        identity: { choice: "existing", firmId, coreInput: null },
        items: rows.rows.map((row) => ({
          itemId: row.id,
          disposition: "retain_only",
          reason: "Synthetic rendered fixture evidence is retained without changing the profile.",
          profileChoice: null,
        })),
      };
      const reviewSha256 = prospectEnrichmentProtocolHash(review);
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const reviewed = await client.query<{ receipt: Record<string, unknown> }>(
        `SELECT public.review_prospect_enrichment_package_v1($1,$2,$3::jsonb,$4,$5,$6::timestamptz) AS receipt`,
        [packageId, prospectEnrichmentPayloadSha256(envelope), JSON.stringify(review), reviewSha256, operator.rows[0].id, expiresAt],
      );
      const reviewReceipt = reviewed.rows[0]?.receipt;
      if (!reviewReceipt || reviewReceipt.outcome !== "reviewed" || typeof reviewReceipt.expectedRevisionSha256 !== "string") {
        throw new Error("Synthetic applied fixture review failed its database receipt check.");
      }
      const applied = await client.query<{ receipt: Record<string, unknown> }>(
        `SELECT public.apply_prospect_enrichment_package_v1($1,$2,$3,$4) AS receipt`,
        [packageId, reviewSha256, reviewReceipt.expectedRevisionSha256, operator.rows[0].id],
      );
      if (applied.rows[0]?.receipt?.outcome !== "applied") throw new Error("Synthetic applied fixture failed its database apply receipt check.");
    }

    const run = await client.query<{ id: string }>(
      `SELECT id FROM public.prospect_enrichment_runs WHERE submitted_by=$1 AND run_key=$2`, [actor, runKey],
    );
    if (run.rows.length !== 1) throw new Error("Synthetic rendered run was not uniquely persisted.");
    await client.query("COMMIT");

    await mkdir(path.dirname(outputFile), { recursive: true });
    const intakeRaw = JSON.stringify(runEnvelopes.get("intake"), null, 2) + "\n";
    const rendered = {
      synthetic: true,
      operator: { firmId: portal.rows[0].id, lawyerId: operator.rows[0].id },
      firmId,
      runId: run.rows[0].id,
      sourceRunKey: runKey,
      stageEnvelopePath,
      comparisonRequestPath,
      packages: {
        review: receipts.get("review")!.packageId,
        applied: receipts.get("applied")!.packageId,
        held: receipts.get("held")!.packageId,
        conflict: receipts.get("conflict")!.packageId,
      },
    };
    await writeFile(stageEnvelopePath, intakeRaw, { flag: "wx" });
    await writeFile(comparisonRequestPath, JSON.stringify(comparisonRequest, null, 2) + "\n", { flag: "wx" });
    await writeFile(outputFile, JSON.stringify(rendered, null, 2) + "\n", { flag: "wx" });
    process.stdout.write(`Synthetic rendered fixtures seeded in the disposable local database.\nManifest: ${outputFile}\nStage envelope: ${stageEnvelopePath}\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  process.stderr.write(`Rendered fixture seed refused or failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
