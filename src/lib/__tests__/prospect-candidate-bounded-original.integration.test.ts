import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createProspectEnrichmentFixtures } from "../__fixtures__/prospect-enrichment-v1";
import { encodeBoundedProspectEnvelope } from "../prospect-enrichment-original-content";
import { prospectEnrichmentProtocolHash as hash, prospectEnrichmentSha256, prospectEnrichmentIdempotencyKey, stableProspectEnrichmentJson } from "../prospect-enrichment-hash";
import { buildProspectEnrichmentClientItems, parseProspectEnrichmentEnvelope, type JsonValue } from "../prospect-enrichment-contract";
import { loadCandidateRevision } from "../prospect-enrichment-candidate-content";
import { verifyBoundedOriginalForDisplay } from "../prospect-enrichment-original-display";

const enabled = process.env.CI === "true" && process.env.PROSPECT_ENRICHMENT_REQUIRE_DATABASE_URL === "1";
const raw = (process.env.DIRECT_DATABASE_URL ?? process.env.PROSPECT_ENRICHMENT_TEST_DATABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
if (enabled) {
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "::1"].includes(url.hostname.replace(/^\[|\]$/g, "")) || !url.port || url.pathname !== "/postgres") throw new Error("V2 integration requires an isolated disposable loopback database.");
}
const suite = enabled ? describe : describe.skip;
suite("bounded original v2 real PostgreSQL contract", () => {
  const pool = enabled ? new Pool({ connectionString: raw, max: 1 }) : null;
  afterAll(async () => { await pool?.end(); });

  it("matches Node canonical bytes and hashes across decimal and Unicode boundaries", async () => {
    const numbers = [0, -0, 5e-324, -5e-324, 1e-323, Number.MAX_VALUE, -Number.MAX_VALUE, 9.999999e-7, 1e-6, 1.000001e-6,
      1e20, 9.999999999999999e20, 1e21, 1.0000000000000001e21, 1000000000000000100, 1.2345678901234567];
    const values: JsonValue[] = [...numbers, { "": [], "\uFFFF": true, "\uE000": null, "\u{10000}": false, "😀": numbers,
      a: { aa: "quoted \" text \\ tab\t CR\r LF\n backspace\b formfeed\f control\u0001 line\u2028 paragraph\u2029 🧭" } }];
    const result = await pool!.query<{ text: string; hash: string }>(
      "SELECT prospect_candidate_private.transport_stable_json_v2(value) text, prospect_candidate_private.transport_hash_v2(value) hash FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY inputs(value,position) ORDER BY position", [JSON.stringify(values)]);
    expect(result.rows).toEqual(values.map(value => ({ text: stableProspectEnrichmentJson(value), hash: hash(value) })));
    const acl = await pool!.query<{ allowed: boolean }>("SELECT has_function_privilege('service_role','prospect_candidate_private.decode_original_nodes_v1(jsonb,text,text)','EXECUTE') allowed");
    expect(acl.rows[0].allowed).toBe(false);
  }, 30_000);

  it("stages and replays immutable transport, indexes logical fields and verifies the browser chunk reconstruction", async () => {
    const db = await pool!.connect(); await db.query("BEGIN");
    try {
      const token = randomUUID().replaceAll("-", ""), actor = "v2-integration-" + token;
      const base = structuredClone(createProspectEnrichmentFixtures()[0].envelope);
      const original: Record<string, JsonValue> = { status: "held", qualificationState: "needs_evidence", unknown: null, consent: false, crlfAnswer: "First line\r\nSecond line",
        "": "empty key", "slash/key~": [], "\uE000": 1e21, "😀": 1e-7, longFinding: "🧭".repeat(20_000) };
      let deepest = original;
      for (let i = 0; i < 16; i++) { deepest.receipt = {}; deepest = deepest.receipt as Record<string, JsonValue>; }
      deepest.answer = "Preserved questionnaire answer.";
      const envelope = encodeBoundedProspectEnvelope({ ...base, runId: "run-" + token, packageId: "package-" + token,
        sourceSystem: "v2-integration", sourceName: "bounded-original-fixture", sources: [], observations: [], assessment: null,
        subject: { ...base.subject, researchKey: "v2-" + token, sourceRecordKey: null, databaseFirmId: null, stableFirmId: null, canonicalDomain: null, identityState: "unresolved" },
        originalResearch: { ...base.originalResearch, content: original, contentSha256: hash(original) } });
      const payloadSha = hash(envelope), sourceSha = envelope.originalResearch.sourceSha256;
      const entry = { entryId: "entry-" + hash(token), researchKey: envelope.subject.researchKey, clientPackageId: envelope.packageId,
        expectedPayloadSha256: payloadSha, itemCount: 0, clientItems: [], initialDisposition: "ready_for_review",
        source: { sourceRoot: "synthetic-only", relativePath: envelope.originalResearch.sourcePath, sourcePointer: envelope.originalResearch.sourcePointer, fileSha256: sourceSha }, errorCodes: [] };
      const manifest = { schemaVersion: "prospect-enrichment-run-manifest/v1", runId: envelope.runId, sourceSystem: envelope.sourceSystem,
        sourceName: envelope.sourceName, sourceManifestSha256: sourceSha, generatedAt: envelope.generatedAt, expectedPackageCount: 1, entries: [entry] };
      const chunk = { ...manifest, schemaVersion: "prospect-enrichment-run-manifest-chunk/v1", adapterVersion: "v2-test/v1",
        runManifestSha256: hash(manifest), expectedEntryCount: 1, chunkIndex: 0, chunkCount: 1, chunkSha256: hash([entry]) };
      await db.query("SELECT public.register_prospect_enrichment_manifest_chunk_v1($1,$2::jsonb,true)", [actor, JSON.stringify(chunk)]);
      const body = JSON.stringify(envelope);
      const stage = async () => (await db.query<{ receipt: { outcome: string; packageId: string } }>(
        "SELECT public.stage_prospect_enrichment_package_v1($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14::jsonb,$15) receipt",
        [actor, envelope.runId, envelope.sourceSystem, envelope.sourceName, envelope.packageId,
          prospectEnrichmentIdempotencyKey(envelope.sourceSystem, envelope.runId, envelope.packageId), body,
          prospectEnrichmentSha256(body), JSON.stringify(envelope), payloadSha, envelope.subject.researchKey, "unresolved", "[]", "[]", null])).rows[0].receipt;
      await db.query("SET LOCAL ROLE service_role");
      const staged = await stage();
      expect(staged.outcome).toBe("created");
      expect(await stage()).toMatchObject({ outcome: "replayed", packageId: staged.packageId });
      await db.query("RESET ROLE");
      const stored = (await db.query("SELECT raw_body,payload,payload_sha256,schema_version FROM public.prospect_enrichment_packages WHERE id=$1", [staged.packageId])).rows[0];
      expect(stored).toEqual({ raw_body: body, payload: envelope, payload_sha256: payloadSha, schema_version: "prospect-enrichment/v2" });
      const candidate = (await db.query<{ id: string }>("SELECT id FROM public.prospect_research_candidates WHERE identity_namespace=$1 AND identity_key=$2", ["source:v2-integration", envelope.subject.researchKey])).rows[0];
      expect(candidate).toBeTruthy();
      const page = (await db.query<{ data: { items: { id: string; itemKind: string; originalStatus: string; qualificationState: string }[]; coverageRevision: number } }>(
        "SELECT public.list_prospect_research_candidate_history_v1($1,20,NULL,NULL) data", [candidate.id])).rows[0].data;
      const revision = page.items.find(item => item.itemKind === "research_revision")!;
      expect(revision).toMatchObject({ originalStatus: "held", qualificationState: "needs_evidence" });
      const request: typeof fetch = async input => {
        const offset = Number(new URL(String(input), "http://127.0.0.1").searchParams.get("offset"));
        const result = await db.query<{ data: unknown }>("SELECT public.get_prospect_research_candidate_revision_chunk_v1($1,$2,$3,$4) data", [candidate.id, revision.id, offset, page.coverageRevision]);
        return Response.json(result.rows[0].data);
      };
      const retained = await loadCandidateRevision(candidate.id, revision.id, page.coverageRevision, request);
      expect(retained.originalJson).toEqual(envelope);
      expect(retained.originalJsonSha256).toBe(payloadSha);
      expect(retained.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ pointer: "/originalResearch/content/unknown", value: null }),
        expect.objectContaining({ pointer: "/originalResearch/content/consent", value: false }),
        expect.objectContaining({ pointer: "/originalResearch/content/crlfAnswer", value: "First line\r\nSecond line" }),
        expect.objectContaining({ pointer: "/originalResearch/content/", value: "empty key" }),
        expect.objectContaining({ pointer: "/originalResearch/content/slash~1key~0", value: [] }),
        expect.objectContaining({ pointer: "/originalResearch/content" + "/receipt".repeat(16) + "/answer", value: "Preserved questionnaire answer." }),
      ]));
      expect((await verifyBoundedOriginalForDisplay(retained.originalJson, retained.originalJsonSha256)).content).toEqual(original);
      const tampered = { ...envelope, originalResearch: { ...envelope.originalResearch, representationSha256: "0".repeat(64) } };
      await db.query("SAVEPOINT expected_hash_denial");
      await expect(db.query("SELECT prospect_candidate_private.logical_enrichment_payload_v1($1::jsonb)", [JSON.stringify(tampered)])).rejects.toThrow("original_node_hash_mismatch");
      await db.query("ROLLBACK TO SAVEPOINT expected_hash_denial");
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 60_000);

  it("stages and replays typed v2 sources, observations and assessments with exact Node event hashes", async () => {
    const db = await pool!.connect(); await db.query("BEGIN");
    try {
      const token = randomUUID().replaceAll("-", ""), actor = "v2-typed-" + token;
      const base = structuredClone(createProspectEnrichmentFixtures()[0].envelope);
      const envelope = encodeBoundedProspectEnvelope({ ...base, runId: "run-" + token, packageId: "package-" + token,
        sourceSystem: "v2-integration", sourceName: "typed-bounded-original-fixture",
        subject: { ...base.subject, researchKey: "typed-v2-🧭-" + token, sourceRecordKey: null },
        sources: base.sources.map(source => ({ ...source, publisher: "Synthetic 🧭 Unicode publisher" })),
        assessment: { ...base.assessment!, legacyCriteria: { tiny: 1e-7, boundary: 1e21, precision: 1000000000000000100,
          "\uE000": null, "\u{10000}": false, "😀": "Preserved Unicode key" } } });
      expect(parseProspectEnrichmentEnvelope(envelope).ok).toBe(true);
      const clientItems = buildProspectEnrichmentClientItems(envelope);
      expect(clientItems.map(item => item.itemKind)).toEqual(["source", ...Array(6).fill("observation"), "assessment"]);
      const payloadSha = hash(envelope), sourceSha = envelope.originalResearch.sourceSha256;
      const entry = { entryId: "entry-" + hash(token), researchKey: envelope.subject.researchKey, clientPackageId: envelope.packageId,
        expectedPayloadSha256: payloadSha, itemCount: clientItems.length, clientItems, initialDisposition: "ready_for_review",
        source: { sourceRoot: "synthetic-only", relativePath: envelope.originalResearch.sourcePath, sourcePointer: envelope.originalResearch.sourcePointer, fileSha256: sourceSha }, errorCodes: [] };
      const manifest = { schemaVersion: "prospect-enrichment-run-manifest/v1", runId: envelope.runId, sourceSystem: envelope.sourceSystem,
        sourceName: envelope.sourceName, sourceManifestSha256: sourceSha, generatedAt: envelope.generatedAt, expectedPackageCount: 1, entries: [entry] };
      const chunk = { ...manifest, schemaVersion: "prospect-enrichment-run-manifest-chunk/v1", adapterVersion: "v2-test/v1",
        runManifestSha256: hash(manifest), expectedEntryCount: 1, chunkIndex: 0, chunkCount: 1, chunkSha256: hash([entry]) };
      await db.query("SELECT public.register_prospect_enrichment_manifest_chunk_v1($1,$2::jsonb,true)", [actor, JSON.stringify(chunk)]);
      const lineage = new Map(clientItems.map(item => [item.clientItemId, item]));
      const sources = envelope.sources.map(source => {
        const item = lineage.get("src:" + source.sourceId)!;
        return { sourceId: source.sourceId, clientItemId: item.clientItemId, sourceEventKey: item.sourceEventKey,
          semanticSha256: item.semanticSha256, data: source, observedAt: source.observedAt, observedOn: source.observedOn, provenanceState: "complete" };
      });
      const items = [
        ...envelope.observations.map(observation => ({ ...lineage.get("obs:" + observation.observationId)!, data: observation,
          sourceIds: observation.sourceIds, observedAt: observation.observedAt, observedOn: observation.observedOn, provenanceState: "complete" })),
        { ...lineage.get("assessment:" + envelope.assessment!.assessmentId)!, data: envelope.assessment,
          sourceIds: envelope.assessment!.sourceIds, observedAt: envelope.assessment!.assessedAt, observedOn: envelope.assessment!.assessedOn, provenanceState: "complete" },
      ];
      const body = JSON.stringify(envelope);
      const stage = async () => (await db.query<{ receipt: { outcome: string; packageId: string } }>(
        "SELECT public.stage_prospect_enrichment_package_v1($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14::jsonb,$15) receipt",
        [actor, envelope.runId, envelope.sourceSystem, envelope.sourceName, envelope.packageId,
          prospectEnrichmentIdempotencyKey(envelope.sourceSystem, envelope.runId, envelope.packageId), body,
          prospectEnrichmentSha256(body), JSON.stringify(envelope), payloadSha, envelope.subject.researchKey, "unresolved",
          JSON.stringify(items), JSON.stringify(sources), null])).rows[0].receipt;
      await db.query("SET LOCAL ROLE service_role");
      const staged = await stage(); expect(staged.outcome).toBe("created");
      expect(await stage()).toMatchObject({ outcome: "replayed", packageId: staged.packageId });
      await db.query("RESET ROLE");
      const stored = await db.query("SELECT i.client_item_id AS \"clientItemId\", i.item_kind AS \"itemKind\", e.source_event_key AS \"sourceEventKey\", e.semantic_sha256 AS \"semanticSha256\" FROM public.prospect_enrichment_items i JOIN public.prospect_enrichment_source_events e ON e.id=i.source_event_id WHERE i.package_id=$1 ORDER BY i.client_item_id", [staged.packageId]);
      const sorted = clientItems.map(item => ({ ...item, itemKind: item.itemKind === "observation"
        ? envelope.observations.find(observation => "obs:" + observation.observationId === item.clientItemId)!.kind : item.itemKind
      })).sort((a, b) => a.clientItemId < b.clientItemId ? -1 : a.clientItemId > b.clientItemId ? 1 : 0);
      expect(stored.rows).toEqual(sorted);
      expect((await db.query("SELECT count(*)::int count FROM public.prospect_enrichment_source_events WHERE first_package_id=$1", [staged.packageId])).rows[0].count).toBe(clientItems.length);
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 60_000);
});
