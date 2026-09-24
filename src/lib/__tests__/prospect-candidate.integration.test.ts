import { afterAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { prospectEnrichmentProtocolHash, stableProspectEnrichmentJson } from "@/lib/prospect-enrichment-hash";

// These tests are executable only by the pushed-branch disposable CI lane.
// Merely having a local/production URL configured never authorizes a connection.
const enabled = process.env.CI === "true" && process.env.PROSPECT_ENRICHMENT_REQUIRE_DATABASE_URL === "1";
const rawUrl = (process.env.DIRECT_DATABASE_URL ?? process.env.PROSPECT_ENRICHMENT_TEST_DATABASE_URL ?? "").trim().replace(/^["']|["']$/g, "");
if (enabled) {
  if (!rawUrl) throw new Error("Candidate integration requires the CI disposable database URL.");
  const url = new URL(rawUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "::1"].includes(url.hostname.replace(/^\[|\]$/g, "")) ||
      !url.port || url.pathname !== "/postgres") throw new Error("Candidate integration accepts only the CI disposable loopback database.");
}
const suite = enabled ? describe : describe.skip;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Summary = { id: string; identityKey: string; identityNamespace: string; verifiedFirmId: string | null; identityState: string;
  revisionCount: number; originalStatuses: string[]; selectionDispositions: string[]; qualificationStates: string[]; processingDispositions: string[]; readWarnings: string[] };
type Page = { items: Summary[]; nextAfterId: string | null; inventoryCount: number; filteredCount: number; coverageRevision: number; readWarnings: string[]; complete: boolean };
type History = { items: { id: string; candidateId: string; itemKind: string; originalJson: Json; originalStatus: string | null; selectionDisposition: string | null; qualificationState: string | null; observedAt: string | null;
  retrievedAt: string | null; payloadSha256: string; originalJsonSha256: string; readWarnings: string[]; fields: { pointer: string; scalarType: string; value: Json; observedAt: string | null; retrievedAt: string | null }[] }[];
  nextAfterId: string | null; coverageRevision: number; readWarnings: string[]; complete: boolean };
type Entry = { entryId: string; researchKey: string | null; clientPackageId: string | null; expectedPayloadSha256: string | null;
  itemCount: number; clientItems: Json[]; initialDisposition: string; source: { sourceRoot: string | null; relativePath: string; sourcePointer: string; fileSha256: string | null }; errorCodes: string[] };

async function list(db: PoolClient, filters: Record<string, Json> = {}, limit = 100, after: string | null = null, cutoff: number | null = null): Promise<Page> {
  return (await db.query<{ data: Page }>("SELECT public.list_prospect_research_candidates_v1($1::jsonb,$2,$3::uuid,$4::bigint) data",
    [JSON.stringify(filters), limit, after, cutoff])).rows[0].data;
}
async function fullRevision(db: PoolClient, candidateId: string, revisionId: string, cutoff: number) {
  type Chunk = { candidateId: string; revisionId: string; coverageRevision: number; offset: number; nextOffset: number | null;
    chunk: string; totalCharacters: number; contentSha256: string };
  let offset: number | null = 0;
  let content = "";
  let expectedHash = "";
  let total = 0;
  while (offset !== null) {
    const chunk: Chunk = (await db.query<{ data: Chunk }>(
      "SELECT public.get_prospect_research_candidate_revision_chunk_v1($1,$2,$3,$4) data", [candidateId, revisionId, offset, cutoff])).rows[0].data;
    expect(chunk.offset).toBe(offset);
    expect(Buffer.byteLength(JSON.stringify(chunk), "utf8")).toBeLessThan(1_048_576);
    expect(Array.from(chunk.chunk).length).toBeLessThanOrEqual(65_536);
    if (expectedHash) expect(chunk.contentSha256).toBe(expectedHash);
    expectedHash = chunk.contentSha256; total = chunk.totalCharacters;
    content += chunk.chunk; offset = chunk.nextOffset;
  }
  expect(Array.from(content).length).toBe(total);
  expect(createHash("sha256").update(content, "utf8").digest("hex")).toBe(expectedHash);
  return JSON.parse(content) as History["items"][number];
}
async function history(db: PoolClient, id: string, cutoff: number | null = null): Promise<History> {
  const data = (await db.query<{ data: History }>("SELECT public.list_prospect_research_candidate_history_v1($1,20,NULL,$2) data", [id, cutoff])).rows[0].data;
  expect(Buffer.byteLength(JSON.stringify(data), "utf8")).toBeLessThan(1_048_576);
  for (const item of data.items) {
    expect(item).toMatchObject({ contentDeferred: true, originalJson: null, fields: [], unmappedPaths: [] });
  }
  data.items = await Promise.all(data.items.map(item => fullRevision(db, id, item.id, data.coverageRevision)));
  return data;
}
async function expectRejected(db: PoolClient, sql: string, values: unknown[] = [], pattern = /permission denied|append-only|invalid|requires/i) {
  await db.query("SAVEPOINT expected_denial");
  await expect(db.query(sql, values)).rejects.toThrow(pattern);
  await db.query("ROLLBACK TO SAVEPOINT expected_denial");
  await db.query("RELEASE SAVEPOINT expected_denial");
}
async function register(db: PoolClient, inputs: { key: string | null; raw?: Json; disposition?: string }[], packageEntries: Entry[] = []) {
  const runKey = "candidate-run-" + randomUUID().replaceAll("-", "");
  const actor = "candidate-integration";
  const fileHash = "e".repeat(64);
  const holds: { entry: Entry; evidence: Record<string, Json> }[] = [];
  const entries: Entry[] = [...packageEntries];
  for (const [index, input] of inputs.entries()) {
    const entryId = "entry-" + prospectEnrichmentProtocolHash([runKey, index]);
    const source = { sourceRoot: "synthetic-only", relativePath: "candidate-fixtures.json", sourcePointer: "/" + index, fileSha256: fileHash };
    const core = { schemaVersion: "prospect-enrichment-held-candidate-evidence/v1", entryId, researchKey: input.key ?? "",
      source, originalJson: stableProspectEnrichmentJson(input.raw ?? null), issues: [] };
    const evidenceSha256 = prospectEnrichmentProtocolHash(core);
    const entry: Entry = { entryId, researchKey: input.key, clientPackageId: null, expectedPayloadSha256: null,
      itemCount: 0, clientItems: [], initialDisposition: input.disposition ?? "hold_schema", source,
      errorCodes: input.key === null ? ["source_read_failed"] : ["__held_evidence_sha256:" + evidenceSha256] };
    entries.push(entry);
    if (input.key !== null) holds.push({ entry, evidence: { ...core, runId: runKey, evidenceSha256 } });
  }
  entries.sort((a, b) => a.entryId.localeCompare(b.entryId));
  const base = { schemaVersion: "prospect-enrichment-run-manifest/v1", runId: runKey, sourceSystem: "candidate-integration",
    sourceName: "synthetic-candidate-contract", sourceManifestSha256: fileHash, generatedAt: "2026-09-24T00:00:00.000Z",
    expectedPackageCount: packageEntries.length, entries };
  const chunk = { schemaVersion: "prospect-enrichment-run-manifest-chunk/v1", adapterVersion: "candidate-test/v1",
    runId: runKey, sourceSystem: base.sourceSystem, sourceName: base.sourceName, sourceManifestSha256: fileHash,
    runManifestSha256: prospectEnrichmentProtocolHash(base), generatedAt: base.generatedAt,
    expectedPackageCount: packageEntries.length, expectedEntryCount: entries.length, chunkIndex: 0, chunkCount: 1,
    chunkSha256: prospectEnrichmentProtocolHash(entries), entries };
  const registerChunk = async (finalize: boolean) => (await db.query<{ receipt: Record<string, Json> }>(
    "SELECT public.register_prospect_enrichment_manifest_chunk_v1($1,$2::jsonb,$3) receipt", [actor, JSON.stringify(chunk), finalize])).rows[0].receipt;
  await registerChunk(false);
  const beforeBodies = await list(db);
  for (const hold of holds) {
    await db.query("SELECT public.record_prospect_enrichment_manifest_hold_evidence_v1($1,$2,$3,$4::jsonb)",
      [actor, runKey, hold.entry.entryId, JSON.stringify(hold.evidence)]);
  }
  await registerChunk(true);
  const runId = (await db.query<{ id: string }>("SELECT id FROM public.prospect_enrichment_runs WHERE submitted_by=$1 AND run_key=$2", [actor, runKey])).rows[0].id;
  return { runId, runKey, entries, holds, beforeBodies, registerChunk };
}

suite("all-candidate immutable PostgreSQL projection", () => {
  const pool = enabled ? new Pool({ connectionString: rawUrl, max: 2 }) : null;
  afterAll(async () => { await pool?.end(); });

  it("retains all statuses, missing-key manifests, typed facts, sources, null dates, unknown fields, retractions, and exact replay", async () => {
    const db = await pool!.connect();
    await db.query("BEGIN");
    try {
      const group = "candidatefixture" + randomUUID().replaceAll("-", "");
      const statuses = ["selected", "held", "rejected", "incomplete", "not_selected"];
      const inputs: { key: string; raw: Json }[] = statuses.map((status): { key: string; raw: Json } => ({ key: group + ":" + status, raw: {
        firmName: "Synthetic Smith " + status, practiceArea: "Immigration", source: { status: "failed" }, fixtureGroup: group, status,
        selectionDisposition: status === "selected" ? "selected" : "verification-required",
        qualificationState: "needs_evidence", claimedFirmId: randomUUID(), observedAt: null, retrievedAt: null,
        weird: { "x/y~z": false, stringFalse: "false", nullValue: null, emptyArray: [], emptyObject: {}, unrecognizedResearchField: "retained insight" },
        channels: ["phone", { kind: "web-form", sourceUrl: "https://synthetic.example/intake", visibleFields: ["Name", "Matter type"] }],
        findings: [{ observedOn: "2026-09-20", retrievedAt: "2026-09-21T02:00:00Z", sourceUrl: "https://synthetic.example/team",
          lawyerCount: 3, evidenceState: "asserted" }, { observedOn: "2026-09-22", sourceUrl: "https://synthetic.example/team",
          lawyerCount: 4, evidenceState: "retracted", retractionReason: "Source correction" }]
      } }));
      const fixture = await register(db, [...inputs, { key: null, disposition: "source_read_failed" }]);
      expect(fixture.beforeBodies.complete).toBe(false);
      expect(fixture.beforeBodies.readWarnings.some(w => w.startsWith("manifest_hold_body_missing:"))).toBe(true);
      const page = await list(db, { fieldPointer: "/research/fixtureGroup", fieldValue: group });
      expect(page.filteredCount).toBe(5);
      expect(page.items.map(x => x.originalStatuses[0]).sort()).toEqual([...statuses].sort());
      for (const item of page.items) {
        expect(item.identityState).toBe("unresolved");
        expect(item.verifiedFirmId).toBeNull();
        expect(item.qualificationStates).toEqual(["needs_evidence"]);
        expect(item.revisionCount).toBe(2);
      }
      const missing = (await db.query<{ id: string }>(
        "SELECT id FROM public.prospect_research_candidates WHERE identity_namespace=$1", ["run:" + fixture.runId])).rows;
      expect(missing).toHaveLength(1);
      const missingDetail = (await db.query<{ data: { candidate: Summary; complete: boolean } }>(
        "SELECT public.get_prospect_research_candidate_v1($1,NULL) data", [missing[0].id])).rows[0].data;
      expect(missingDetail.candidate.readWarnings).toContain("missing_research_key");
      expect(missingDetail.complete).toBe(false);
      const chosen = page.items[0];
      const retained = (await history(db, chosen.id)).items.find(x => x.itemKind === "research_revision")!;
      expect(retained.originalJson).toEqual({ envelope: fixture.holds.find(h => h.entry.researchKey === chosen.identityKey)!.evidence,
        research: inputs.find(i => i.key === chosen.identityKey)!.raw });
      expect(retained.originalJsonSha256).toBe(prospectEnrichmentProtocolHash(retained.originalJson));
      expect(retained.originalStatus).toBe(chosen.originalStatuses[0]);
      expect(retained.selectionDisposition).toBe(chosen.selectionDispositions[0]);
      expect(retained.qualificationState).toBe("needs_evidence");
      expect(retained.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ pointer: "/research/weird/x~1y~0z", scalarType: "boolean", value: false }),
        expect.objectContaining({ pointer: "/research/weird/nullValue", scalarType: "null", value: null }),
        expect.objectContaining({ pointer: "/research/weird/emptyArray", scalarType: "array", value: [] }),
        expect.objectContaining({ pointer: "/research/weird/emptyObject", scalarType: "object", value: {} }),
        expect.objectContaining({ pointer: "/research/findings/0/lawyerCount", value: 3, observedAt: "2026-09-20", retrievedAt: "2026-09-21T02:00:00Z" }),
        expect.objectContaining({ pointer: "/research/findings/1/lawyerCount", value: 4, observedAt: "2026-09-22" }),
        expect.objectContaining({ pointer: "/research/channels/1/visibleFields/1", value: "Matter type" })
      ]));
      expect((await list(db, { text: "Smith Immigration", fieldPointer: "/research/fixtureGroup", fieldValue: group })).filteredCount).toBe(5);
      expect(page.items.every(item => !item.originalStatuses.includes("failed"))).toBe(true);
      expect((await list(db, { text: "retained insight", fieldPointer: "/research/fixtureGroup", fieldValue: group })).filteredCount).toBe(5);
      expect((await list(db, { fieldPointer: "/research/weird/x~1y~0z", fieldValue: false })).items.some(x => x.id === chosen.id)).toBe(true);
      expect((await list(db, { fieldPointer: "/research/weird/x~1y~0z", fieldValue: "false" })).items.some(x => x.id === chosen.id)).toBe(false);
      expect((await list(db, { sourceUrl: "https://synthetic.example/team", observedFrom: "2026-09-22", observedTo: "2026-09-22" })).items.some(x => x.id === chosen.id)).toBe(true);
      expect((await list(db, { retrievedFrom: "2026-09-21", retrievedTo: "2026-09-21" })).items.some(x => x.id === chosen.id)).toBe(true);
      expect((await list(db, { observedUnknown: true, retrievedUnknown: true })).items.some(x => x.id === chosen.id)).toBe(true);
      const beforeReplay = await list(db);
      expect(await fixture.registerChunk(true)).toMatchObject({ outcome: "already_finalized" });
      // Exact evidence rows are retained; the existing RPC refuses new writes to a finalized run.
      // Replaying the original closed manifest must create no projected revision or field row.
      const afterReplay = await list(db);
      expect(afterReplay.coverageRevision).toBe(beforeReplay.coverageRevision);
      expect((await history(db, chosen.id)).items).toEqual((await history(db, chosen.id, beforeReplay.coverageRevision)).items);
      const counts = (await db.query<{ rows: string; distinct_rows: string }>(
        "SELECT count(*) rows,count(DISTINCT (revision_id,pointer)) distinct_rows FROM public.prospect_research_candidate_fields")).rows[0];
      expect(counts.rows).toBe(counts.distinct_rows);
      await expectRejected(db, "UPDATE public.prospect_research_candidate_history SET original_json='{}' WHERE candidate_id=$1", [chosen.id]);
      await expectRejected(db, "DELETE FROM public.prospect_research_candidate_fields WHERE candidate_id=$1", [chosen.id]);
      await expectRejected(db, "SELECT public.list_prospect_research_candidates_v1($1,10,NULL,NULL)", [JSON.stringify({ fieldValue: false })]);
      await expectRejected(db, "SELECT public.list_prospect_research_candidates_v1($1,10,NULL,NULL)", [JSON.stringify({ observedFrom: "2026-02-31" })]);
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 60_000);

  it("keeps page counts and candidate histories fixed under a returned coverage revision", async () => {
    const db = await pool!.connect(); await db.query("BEGIN");
    try {
      const group = "snapshotfixture" + randomUUID().replaceAll("-", "");
      await register(db, Array.from({ length: 4 }, (_, i) => ({ key: group + i, raw: { fixtureGroup: group, status: "held" } })));
      const filters = { fieldPointer: "/research/fixtureGroup", fieldValue: group };
      const first = await list(db, filters, 2);
      expect(first.items).toHaveLength(2); expect(first.nextAfterId).not.toBeNull(); expect(first.filteredCount).toBe(4);
      const original = await history(db, first.items[0].id, first.coverageRevision);
      await register(db, [{ key: group + "new", raw: { fixtureGroup: group, status: "not_selected" } },
        { key: first.items[0].identityKey, raw: { fixtureGroup: group, status: "rejected", observedAt: "not-a-date", retrievedAt: "yesterday" } }]);
      const second = await list(db, filters, 2, first.nextAfterId, first.coverageRevision);
      expect(second.filteredCount).toBe(4); expect(second.inventoryCount).toBe(first.inventoryCount);
      expect(new Set([...first.items, ...second.items].map(x => x.id)).size).toBe(4);
      expect(second.nextAfterId).toBeNull();
      expect((await history(db, first.items[0].id, first.coverageRevision)).items).toEqual(original.items);
      const fresh = await list(db, filters);
      expect(fresh.filteredCount).toBe(5);
      const changed = fresh.items.find(x => x.id === first.items[0].id)!;
      expect(changed.originalStatuses).toEqual(expect.arrayContaining(["held", "rejected"]));
      expect(changed.readWarnings).toContain("invalid_source_date");
      expect((await history(db, changed.id)).items.some(x => x.readWarnings.includes("invalid_source_date"))).toBe(true);
      await expectRejected(db, "SELECT public.list_prospect_research_candidates_v1('{}',10,$1,NULL)", [first.nextAfterId]);
      await expectRejected(db, "SELECT public.list_prospect_research_candidate_history_v1($1,21,NULL,NULL)", [changed.id]);
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 60_000);



  it("requires exact applied review receipts and retains conflicting confirmed firm links", async () => {
    const db = await pool!.connect(); await db.query("BEGIN");
    try {
      const key = "identityfixture" + randomUUID().replaceAll("-", "");
      const operator = randomUUID();
      const firmIds: string[] = [];
      for (let i = 0; i < 2; i++) {
        firmIds.push((await db.query<{ id: string }>(
          "INSERT INTO public.gta_prospect_firms(source_record_key,display_name,normalized_display_name,reconciliation_status) VALUES($1,$2,$3,'update_existing') RETURNING id",
          [key + i, "Synthetic Identity " + i, "synthetic identity " + i])).rows[0].id);
      }
      const packages = firmIds.map((firmId, i) => {
        const id = randomUUID(); const clientId = "candidate-" + id;
        const payload: Json = { schemaVersion: "prospect-enrichment/v1", subject: { researchKey: key, displayName: "Synthetic identity", databaseFirmId: firmId },
          sources: [{ url: "https://synthetic.example/source-only", observedAt: null, retrievedAt: null }],
          originalResearch: { content: { status: i ? "not_selected" : "selected", qualificationState: "needs_evidence" }, unmappedPaths: [] } };
        const hash = prospectEnrichmentProtocolHash(payload);
        const review: Json = { identity: { choice: "existing", firmId, coreInput: null } };
        return { id, clientId, payload, hash, review, reviewHash: prospectEnrichmentProtocolHash(review), firmId };
      });
      const entries: Entry[] = packages.map(p => ({ entryId: "entry-" + p.id, researchKey: key, clientPackageId: p.clientId,
        expectedPayloadSha256: p.hash, itemCount: 0, clientItems: [], initialDisposition: "ready_for_review",
        source: { sourceRoot: "synthetic", relativePath: "identity.json", sourcePointer: "", fileSha256: "a".repeat(64) }, errorCodes: [] }));
      const fixture = await register(db, [], entries);
      let cutoffBeforeSecond = 0;
      for (const [i, p] of packages.entries()) {
        const body = JSON.stringify(p.payload);
        await db.query(
          "INSERT INTO public.prospect_enrichment_packages(id,run_id,client_package_id,submitted_by,idempotency_key,raw_body,raw_body_sha256,payload,payload_sha256,schema_version,research_key,firm_id,identity_state,state,review_json,review_sha256,review_expires_at) VALUES($1,$2,$3,'candidate-integration',$4,$5,$6,$7::jsonb,$8,'prospect-enrichment/v1',$9,$10,'resolved','ready_for_review',$11::jsonb,$12,now()+interval '30 minutes')",
          [p.id, fixture.runId, p.clientId, "pe-v1-" + prospectEnrichmentProtocolHash(p.id), body, createHash("sha256").update(body).digest("hex"),
            JSON.stringify(p.payload), p.hash, key, p.firmId, JSON.stringify(p.review), p.reviewHash]);
        if (i === 0) expect((await list(db, { text: key })).items[0].verifiedFirmId).toBeNull();
        await db.query("INSERT INTO public.prospect_enrichment_events(package_id,event_key,event_type,actor,details) VALUES($1,$2,'reviewed',$3,$4::jsonb)",
          [p.id, "review:" + p.reviewHash, operator, JSON.stringify({ payloadSha256: p.hash, reviewSha256: p.reviewHash })]);
        await db.query("SELECT set_config('app.prospect_enrichment_mutation','apply',true)");
        const receipt = { schemaVersion: "prospect-enrichment-apply-receipt/v1", packageId: p.id, firmId: p.firmId,
          payloadSha256: p.hash, reviewSha256: p.reviewHash, appliedBy: operator, items: [] };
        await db.query("UPDATE public.prospect_enrichment_packages SET state='applied',apply_receipt=$2::jsonb,applied_at=now() WHERE id=$1", [p.id, JSON.stringify(receipt)]);
        const page = await list(db, { text: key });
        if (i === 0) {
          expect(page.items[0]).toMatchObject({ identityState: "resolved", verifiedFirmId: p.firmId });
          cutoffBeforeSecond = page.coverageRevision;
        } else expect(page.items[0]).toMatchObject({ identityState: "conflict", verifiedFirmId: null });
      }
      const fresh = await list(db, { text: key });
      expect(fresh.items).toHaveLength(1);
      expect(fresh.items[0].originalStatuses).toEqual(expect.arrayContaining(["selected", "not_selected"]));
      expect(fresh.items[0].qualificationStates).toEqual(["needs_evidence"]);
      const historical = await list(db, { text: key }, 100, null, cutoffBeforeSecond);
      expect(historical.items[0]).toMatchObject({ identityState: "resolved", verifiedFirmId: firmIds[0] });
      const revisions = await history(db, fresh.items[0].id);
      expect(revisions.items.filter(x => x.itemKind === "identity_link")).toHaveLength(2);
      expect(revisions.items.some(x => x.itemKind === "package_event")).toBe(true);
      expect(revisions.items.some(x => x.fields.some(f => f.value === "https://synthetic.example/source-only"))).toBe(true);
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 60_000);

  it("reconstructs multiMiB and wide/deep raw evidence through bounded immutable chunks and reference facets", async () => {
    const db = await pool!.connect(); await db.query("BEGIN");
    try {
      const group = "largefixture" + randomUUID().replaceAll("-", "");
      const longKey = Array.from({ length: 150 }, () => randomUUID().replaceAll("-", "")).join("");
      const badDate = Array.from({ length: 160 }, () => randomUUID().replaceAll("-", "")).join("");
      const blob = Array.from({ length: 130_000 }, (_, i) => "uniqueword" + i).join(" ");
      const longUrl = "https://synthetic.example/" + "a".repeat(1985);
      const raw: Json = { firmName: "Large retained source", fixtureGroup: group, [longKey]: { exact: false },
        observedAt: badDate, sourceUrl: longUrl, blob, unicode: "😀 ".repeat(20_000), status: "held", qualificationState: null };
      const fixture = await register(db, [{ key: group, raw }]);
      const page = await list(db, { fieldPointer: "/research/fixtureGroup", fieldValue: group });
      expect(page.items).toHaveLength(1);
      const candidate = page.items[0];
      const revisions = await history(db, candidate.id);
      const retained = revisions.items.find(x => x.itemKind === "research_revision")!;
      expect(retained.originalJson).toEqual({ envelope: fixture.holds[0].evidence, research: raw });
      expect(retained.originalJsonSha256).toBe(prospectEnrichmentProtocolHash(retained.originalJson));
      const pointer = "/research/" + longKey + "/exact";
      expect(retained.fields).toEqual(expect.arrayContaining([expect.objectContaining({ pointer, value: false, observedAt: badDate })]));
      expect((await list(db, { fieldRefRevision: retained.id, fieldRefPointerSha256: createHash("sha256").update(pointer).digest("hex") })).items.some(x => x.id === candidate.id)).toBe(true);
      expect((await list(db, { sourceUrl: longUrl })).items.some(x => x.id === candidate.id)).toBe(true);
      expect((await list(db, { text: "uniqueword129999" })).items.some(x => x.id === candidate.id)).toBe(true);
      await expectRejected(db, "SELECT public.list_prospect_research_candidates_v1($1,10,NULL,NULL)",
        [JSON.stringify({ fieldRefRevision: retained.id, fieldRefPointerSha256: "0".repeat(64) })]);
      await expectRejected(db, "SELECT public.get_prospect_research_candidate_revision_chunk_v1($1,$2,1,$3)", [candidate.id, retained.id, page.coverageRevision]);
      const other = (await db.query<{ data: unknown }>("SELECT public.get_prospect_research_candidate_revision_chunk_v1($1,$2,0,$3) data",
        [randomUUID(), retained.id, page.coverageRevision])).rows[0].data;
      expect(other).toBeNull();
      let deep: Json = { retainedNeedle: "deepretainedneedle" };
      for (let i = 0; i < 80; i++) deep = { next: deep };
      await register(db, [{ key: group + "deep", raw: deep }, { key: group + "sourceonly", raw: { sources: [{ url: longUrl, observedAt: null, retrievedAt: null }] } },
        { key: group + "malformed", raw: "Malformed source text: {" }, { key: group + "blank", raw: { status: "", selectionDisposition: " " } }]);
      const deepCandidate = (await list(db, { text: "deepretainedneedle" })).items.find(x => x.identityKey === group + "deep")!;
      expect(deepCandidate).toBeDefined();
      expect(deepCandidate.readWarnings).toContain("held_original_json_requires_raw_review");
      expect(JSON.stringify((await history(db, deepCandidate.id)).items)).toContain("deepretainedneedle");
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 120_000);

  it("exposes only service read RPCs and denies direct candidate data access", async () => {
    const db = await pool!.connect(); await db.query("BEGIN");
    try {
      for (const role of ["anon", "authenticated", "service_role"]) {
        await db.query("SET LOCAL ROLE " + role);
        await expectRejected(db, "SELECT * FROM public.prospect_research_candidates");
        await expectRejected(db, "SELECT * FROM public.prospect_research_candidate_fields");
        await expectRejected(db, "SELECT prospect_candidate_private.project('prospect_enrichment_runs','{}')");
        if (role === "service_role") expect((await list(db)).items).toBeInstanceOf(Array);
        else await expectRejected(db, "SELECT public.list_prospect_research_candidates_v1('{}',10,NULL,NULL)");
        await db.query("RESET ROLE");
      }
      const security = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('prospect_research_candidates','prospect_research_candidate_history','prospect_research_candidate_fields','prospect_research_candidate_coverage','prospect_research_candidate_search_chunks','prospect_research_candidate_content_chunks','prospect_research_candidate_projection_issues')");
      expect(security.rows).toHaveLength(7);
      expect(security.rows.every(x => x.relrowsecurity && x.relforcerowsecurity)).toBe(true);
      const definer = await db.query<{ proname: string }>(
        "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('list_prospect_research_candidates_v1','get_prospect_research_candidate_v1','list_prospect_research_candidate_history_v1') AND prosecdef");
      expect(definer.rows).toHaveLength(0);
    } finally { await db.query("ROLLBACK"); db.release(); }
  });
});
