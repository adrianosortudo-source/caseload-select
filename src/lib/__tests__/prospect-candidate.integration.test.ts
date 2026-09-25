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
async function governedLegacyFirm(db: PoolClient, token: string) {
  const firmId = (await db.query<{ id: string }>(
    "INSERT INTO public.gta_prospect_firms(source_record_key,display_name,normalized_display_name,reconciliation_status) VALUES($1,$2,$2,'provisional_new') RETURNING id",
    [token, "Synthetic legacy " + token])).rows[0].id;
  const batchId = (await db.query<{ id: string }>(
    "INSERT INTO public.gta_prospect_import_batches(source_name,source_sha256,source_record_count,state,applied_at) VALUES($1,$2,1,'applied',now()) RETURNING id",
    [token, "b".repeat(64)])).rows[0].id;
  await db.query("INSERT INTO public.gta_prospect_import_audit(import_batch_id,source_record_key,source_record_sha256,validation_state,action_state,firm_id,canonical_record) VALUES($1,$2,$3,'accepted','created',$4,$5::jsonb)",
    [batchId, token, "a".repeat(64), firmId, JSON.stringify({ sourceRecordKey: token, firmName: "Synthetic legacy " + token })]);
  return { firmId, batchId };
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
      const sourceCandidates = async (cutoff: number | null = null) => {
        const result = await list(db, { text: key }, 100, null, cutoff);
        return { ...result, items: result.items.filter(item => item.identityNamespace === "source:candidate-integration") };
      };
      let cutoffBeforeSecond = 0;
      for (const [i, p] of packages.entries()) {
        const body = JSON.stringify(p.payload);
        await db.query(
          "INSERT INTO public.prospect_enrichment_packages(id,run_id,client_package_id,submitted_by,idempotency_key,raw_body,raw_body_sha256,payload,payload_sha256,schema_version,research_key,firm_id,identity_state,state,review_json,review_sha256,review_expires_at) VALUES($1,$2,$3,'candidate-integration',$4,$5,$6,$7::jsonb,$8,'prospect-enrichment/v1',$9,$10,'resolved','ready_for_review',$11::jsonb,$12,now()+interval '30 minutes')",
          [p.id, fixture.runId, p.clientId, "pe-v1-" + prospectEnrichmentProtocolHash(p.id), body, createHash("sha256").update(body).digest("hex"),
            JSON.stringify(p.payload), p.hash, key, p.firmId, JSON.stringify(p.review), p.reviewHash]);
        if (i === 0) expect((await sourceCandidates()).items[0].verifiedFirmId).toBeNull();
        await db.query("INSERT INTO public.prospect_enrichment_events(package_id,event_key,event_type,actor,details) VALUES($1,$2,'reviewed',$3,$4::jsonb)",
          [p.id, "review:" + p.reviewHash, operator, JSON.stringify({ payloadSha256: p.hash, reviewSha256: p.reviewHash })]);
        await db.query("SELECT set_config('app.prospect_enrichment_mutation','apply',true)");
        const receipt = { schemaVersion: "prospect-enrichment-apply-receipt/v1", packageId: p.id, firmId: p.firmId,
          payloadSha256: p.hash, reviewSha256: p.reviewHash, appliedBy: operator, items: [] };
        await db.query("UPDATE public.prospect_enrichment_packages SET state='applied',apply_receipt=$2::jsonb,applied_at=now() WHERE id=$1", [p.id, JSON.stringify(receipt)]);
        const page = await sourceCandidates();
        if (i === 0) {
          expect(page.items[0]).toMatchObject({ identityState: "resolved", verifiedFirmId: p.firmId });
          await db.query("INSERT INTO public.prospect_enrichment_profile_choices(firm_id,field_key,target_table,target_id,source_selector,selected_value,selected_provenance,package_id,reviewed_by,rationale) VALUES($1,'syntheticStatus','prospect_enrichment_packages',$2,'/payload/originalResearch/content/status','\"selected\"','{}',$2,$3,'Synthetic selected historical evidence')",
            [p.firmId, p.id, operator]);
          const readChoice = async (cutoff: number | null = null) => (await db.query<{ data: { profileChoices: { selected_value: string; evidenceState: string; retractions: { replacementSourceState: string }[] }[]; coverageRevision: number } }>(
            "SELECT public.get_prospect_research_candidate_v1($1,$2) data", [page.items[0].id, cutoff])).rows[0].data;
          const beforeRetraction = await readChoice();
          expect(beforeRetraction.profileChoices[0]).toMatchObject({ selected_value: "selected", evidenceState: "retained", retractions: [] });
          await db.query("INSERT INTO public.prospect_enrichment_events(package_id,event_key,event_type,actor,details) VALUES($1,'synthetic-retraction','evidence_retracted',$2,$3::jsonb)",
            [p.id, operator, JSON.stringify({ targetTable: "prospect_enrichment_packages", targetId: p.id, rationale: "Synthetic source correction", sourceIds: [] })]);
          expect((await readChoice()).profileChoices[0]).toMatchObject({ selected_value: "selected", evidenceState: "retracted", retractions: [{ replacementSourceState: "not_recorded" }] });
          expect((await readChoice(beforeRetraction.coverageRevision)).profileChoices[0]).toMatchObject({ evidenceState: "retained", retractions: [] });
          cutoffBeforeSecond = page.coverageRevision;
        } else expect(page.items[0]).toMatchObject({ identityState: "conflict", verifiedFirmId: null });
      }
      const fresh = await sourceCandidates();
      expect(fresh.items).toHaveLength(1);
      expect(fresh.items[0].originalStatuses).toEqual(expect.arrayContaining(["selected", "not_selected"]));
      expect(fresh.items[0].qualificationStates).toEqual(["needs_evidence"]);
      const historical = await sourceCandidates(cutoffBeforeSecond);
      expect(historical.items[0]).toMatchObject({ identityState: "resolved", verifiedFirmId: firmIds[0] });
      const revisions = await history(db, fresh.items[0].id);
      expect(revisions.items.filter(x => x.itemKind === "identity_link")).toHaveLength(2);
      expect(revisions.items.some(x => x.itemKind === "package_event")).toBe(true);
      expect(revisions.items.some(x => x.fields.some(f => f.value === "https://synthetic.example/source-only"))).toBe(true);
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 60_000);

  it("unions separate producers only through a proven canonical firm and preserves frozen candidate counts", async () => {
    const db = await pool!.connect(); await db.query("BEGIN");
    try {
      const token = "firmunion" + randomUUID().replaceAll("-", "");
      const { firmId } = await governedLegacyFirm(db, token);
      const other = await governedLegacyFirm(db, token + "other");
      const serviceId = (await db.query<{ id: string }>("INSERT INTO public.prospect_service_observations(firm_id,service_name,matter_fit,source_url,observed_at,source_observed_on,source_observed_precision) VALUES($1,$2,'strong-match',$3,NULL,'2026-09-20','date_only') RETURNING id",
        [firmId, "alphaservice" + token, "https://synthetic.example/alpha"])).rows[0].id;
      await db.query("INSERT INTO public.prospect_opportunity_observations(firm_id,opportunity_type,finding,recommendation_hypothesis,source_url,observed_at,confidence) VALUES($1,'other',$2,'Synthetic gap','https://synthetic.example/beta',now(),'high')",
        [firmId, "betafinding" + token]);
      await db.query("INSERT INTO public.prospect_service_observations(firm_id,service_name,matter_fit,source_url,observed_at) VALUES($1,$2,'strong-match','https://synthetic.example/other',now())",
        [other.firmId, "alphaservice" + token]);
      const filters = { text: "alphaservice" + token + " betafinding" + token, firmId };
      const scoped = await list(db, filters);
      expect(scoped.items.length).toBeGreaterThanOrEqual(4);
      expect(scoped.items.every(item => item.verifiedFirmId === firmId)).toBe(true);
      expect(scoped.filteredCount).toBe(scoped.items.length);
      expect(new Set(scoped.items.map(item => item.identityNamespace)).size).toBeGreaterThanOrEqual(3);
      const global = await list(db, { text: filters.text });
      expect(global.items.map(item => item.id).sort()).toEqual(scoped.items.map(item => item.id).sort());
      expect((await list(db, { ...filters, firmId: other.firmId })).items).toEqual([]);
      const source = scoped.items.find(item => item.identityKey === serviceId)!;
      const sourceRevision = (await history(db, source.id)).items.find(item => item.itemKind === "research_revision")!;
      expect(sourceRevision.originalJson).toMatchObject({ id: serviceId, service_name: "alphaservice" + token, source_observed_on: "2026-09-20" });
      expect(sourceRevision.fields).toEqual(expect.arrayContaining([expect.objectContaining({ pointer: "/service_name", observedAt: "2026-09-20" })]));
      expect((await list(db, { firmId, sourceUrl: "https://synthetic.example/alpha", observedFrom: "2026-09-20", observedTo: "2026-09-20" })).items.length).toBe(scoped.items.length);
      await db.query("INSERT INTO public.prospect_source_captures(firm_id,requested_url,retrieval_method,observed_at,policy_state) VALUES($1,'https://synthetic.example/new','synthetic',now(),'allowed')", [firmId]);
      const frozen = await list(db, filters, 100, null, scoped.coverageRevision);
      expect(frozen.filteredCount).toBe(scoped.filteredCount);
      expect((await list(db, filters)).filteredCount).toBe(scoped.filteredCount + 1);
      await expectRejected(db, "SELECT public.list_prospect_research_candidates_v1($1,10,NULL,NULL)", [JSON.stringify({ firmId: "claimed-name" })]);
      expect((await list(db, { firmId: firmId.toUpperCase() })).items.every(item => item.verifiedFirmId === firmId)).toBe(true);
      const licenseeId = (await db.query<{ id: string }>("INSERT INTO public.prospect_lso_licensees(source_system,regulator_licensee_id,display_name,status,source_snapshot_id,observed_at) VALUES('synthetic',$1,$2,'active','synthetic-snapshot',now()) RETURNING id", [token, "licenseefact" + token])).rows[0].id;
      const affiliationId = (await db.query<{ id: string }>("INSERT INTO public.prospect_firm_affiliations(licensee_id,firm_id,mapping_status,observed_at) VALUES($1,$2,'confirmed',now()) RETURNING id", [licenseeId, firmId])).rows[0].id;
      const withLicensee = await list(db, { firmId, text: "licenseefact" + token + " betafinding" + token });
      expect(withLicensee.items.length).toBeGreaterThan(scoped.items.length);
      expect(withLicensee.items.every(item => item.verifiedFirmId === firmId)).toBe(true);
      expect(withLicensee.items.some(item => item.identityNamespace === "legacy:prospect_lso_licensees")).toBe(false);
      const affiliation = withLicensee.items.find(item => item.identityKey === affiliationId)!;
      expect((await history(db, affiliation.id)).items.some(item => typeof item.originalJson === "object" && item.originalJson !== null && !Array.isArray(item.originalJson) && item.originalJson.id === licenseeId)).toBe(true);
      await db.query("UPDATE public.prospect_lso_licensees SET status='inactive' WHERE id=$1", [licenseeId]);
      const licenseeVersions = (await history(db, affiliation.id)).items.filter(item => item.itemKind === "provenance_revision" && typeof item.originalJson === "object" && item.originalJson !== null && !Array.isArray(item.originalJson) && item.originalJson.id === licenseeId);
      expect(licenseeVersions).toHaveLength(2);
      expect((await list(db, { firmId, fieldPointer: "/status", fieldValue: "inactive" })).items.some(item => item.id === affiliation.id)).toBe(true);
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 90_000);

  it("shows the Zarei qualification assessment only under its exact governed firm while preserving the failed Admin read-back state", async () => {
    const db = await pool!.connect(); await db.query("BEGIN");
    try {
      // This matches the production acceptance identity. The assessment FK is
      // the authority for the firm link; its name and source key are not used
      // to infer or repair identity.
      const firmId = "a9989dca-8626-4a6e-93ca-797a1cb7eed2";
      const sourceKey = "q50-whole-firm-zarei-qualified-2026-09-25-v1";
      const token = "zarei-profile" + randomUUID().replaceAll("-", "");
      const other = await governedLegacyFirm(db, token + "-other");
      await db.query("INSERT INTO public.gta_prospect_firms(id,source_record_key,display_name,normalized_display_name,reconciliation_status) VALUES($1,$2,'Zarei Law Professional Corporation','zarei law professional corporation','provisional_new')",
        [firmId, token]);
      const coreBatchId = (await db.query<{ id: string }>(
        "INSERT INTO public.gta_prospect_import_batches(source_name,source_sha256,source_record_count,state,applied_at) VALUES($1,$2,1,'applied',now()) RETURNING id",
        [token, "c".repeat(64)])).rows[0].id;
      await db.query("INSERT INTO public.gta_prospect_import_audit(import_batch_id,source_record_key,source_record_sha256,validation_state,action_state,firm_id,canonical_record) VALUES($1,$2,$3,'accepted','created',$4,$5::jsonb)",
        [coreBatchId, token, "d".repeat(64), firmId, JSON.stringify({ sourceRecordKey: token, firmName: "Zarei Law Professional Corporation" })]);
      await db.query("INSERT INTO public.gta_prospect_stable_identity_registry(firm_id,stable_firm_id,canonical_domain,source_url,observed_on,confidence,adjudication_basis) VALUES($1,'FIRM-00000000000000000000000000','zarei-synthetic.example','https://zarei-synthetic.example/identity','2026-09-25','high','Synthetic provisional identity; not adjudicated for shared use')", [firmId]);
      const supplementalBatchId = (await db.query<{ id: string }>(
        "INSERT INTO public.gta_prospect_supplemental_evidence_import_batches(package_id,package_sha256,source_record_count,state,applied_at) VALUES($1,$2,1,'applied',now()) RETURNING id",
        [token, "e".repeat(64)])).rows[0].id;
      const failedReadback = { state: "admin-prospects-readback-failed" };
      const assessmentId = (await db.query<{ id: string }>(
        "INSERT INTO public.gta_prospect_qualification_assessments(firm_id,evidence_import_batch_id,assessment_id,qualification_state,qualification_cohort,assessed_on,criteria,evidence_urls,raw_assessment) VALUES($1,$2,$3,'qualified','q50_whole_firm_2026_09_25_v1','2026-09-25',$4::jsonb,'[]'::jsonb,$5::jsonb) RETURNING id",
        [firmId, supplementalBatchId, sourceKey, JSON.stringify({ lawyerCount: true, downtownGeometry: true, sharedIdentity: true, ownerContact: true, advertisingActivity: true, gbpEvidence: true, websiteIntake: true }), JSON.stringify({ sourceRecordKey: sourceKey, adminProspectsReadback: failedReadback })])).rows[0].id;
      const siblingAssessmentId = (await db.query<{ id: string }>(
        "INSERT INTO public.gta_prospect_qualification_assessments(firm_id,evidence_import_batch_id,assessment_id,qualification_state,qualification_cohort,assessed_on,criteria,evidence_urls,raw_assessment) VALUES($1,$2,$3,'needs_evidence','q50_whole_firm_2026_09_25_v1','2026-09-25',$4::jsonb,'[]'::jsonb,$5::jsonb) RETURNING id",
        [firmId, supplementalBatchId, token + "-sibling-assessment", JSON.stringify({ differentAssessment: true }), JSON.stringify({ sourceRecordKey: token + "-sibling", note: "same firm, distinct source assessment" })])).rows[0].id;

      const exactFirm = await list(db, { firmId, fieldPointer: "/assessment_id", fieldValue: sourceKey });
      expect(exactFirm.items).toHaveLength(1);
      const candidate = exactFirm.items[0];
      expect(candidate).toMatchObject({
        identityNamespace: "legacy:gta_prospect_qualification_assessments",
        identityKey: assessmentId,
        verifiedFirmId: firmId,
        identityState: "resolved",
        qualificationStates: ["qualified"],
      });
      expect((await list(db, { firmId: other.firmId, fieldPointer: "/assessment_id", fieldValue: sourceKey })).items).toEqual([]);
      const global = await list(db, { fieldPointer: "/assessment_id", fieldValue: sourceKey });
      expect(global.items.map(item => item.id)).toEqual([candidate.id]);
      expect(global.items[0].verifiedFirmId).toBe(firmId);
      const profileInventory = await list(db, { firmId });
      expect(profileInventory.items.map(item => item.identityKey)).toEqual(expect.arrayContaining([assessmentId, siblingAssessmentId]));
      expect(profileInventory.items.find(item => item.identityKey === siblingAssessmentId)).toMatchObject({
        identityNamespace: "legacy:gta_prospect_qualification_assessments",
        verifiedFirmId: firmId,
      });

      const supplementalProfileRow = (await db.query<{ source_record_key: string; database_firm_id: string; firm_id: string | null }>(
        "SELECT source_record_key,database_firm_id,firm_id FROM public.list_gta_prospect_supplemental_evidence_for_operator_v3() WHERE source_record_key=$1",
        [token])).rows[0];
      expect(supplementalProfileRow).toEqual({ source_record_key: token, database_firm_id: firmId, firm_id: null });
      expect(supplementalProfileRow.database_firm_id).not.toBe(supplementalProfileRow.firm_id);

      const retained = (await history(db, candidate.id)).items.find(item => item.itemKind === "research_revision")!;
      expect(retained.originalJson).toMatchObject({
        id: assessmentId,
        assessment_id: sourceKey,
        firm_id: firmId,
        evidence_import_batch_id: supplementalBatchId,
        raw_assessment: { sourceRecordKey: sourceKey, adminProspectsReadback: failedReadback },
      });
      // Firm-profile visibility proves a candidate projection only. It does
      // not issue the independent protected intake receipt or mark read-back synced.
      expect(retained.originalJson).toMatchObject({ raw_assessment: { adminProspectsReadback: { state: "admin-prospects-readback-failed" } } });
      expect(candidate.processingDispositions).not.toContain("synced");
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 90_000);

  it("retains provisional, rejected, null-ID and claimed-ID legacy candidates without inventing firm linkage", async () => {
    const db = await pool!.connect(); await db.query("BEGIN");
    try {
      const token = "legacyholds" + randomUUID().replaceAll("-", "");
      const governed = await governedLegacyFirm(db, token);
      const provisionalId = (await db.query<{ id: string }>("INSERT INTO public.gta_prospect_firms(source_record_key,display_name,normalized_display_name,reconciliation_status) VALUES($1,'Synthetic provisional','synthetic provisional','provisional_new') RETURNING id", [token + "provisional"])).rows[0].id;
      const provisional = (await list(db, { fieldPointer: "/id", fieldValue: provisionalId })).items[0];
      expect(provisional).toMatchObject({ identityState: "unresolved", verifiedFirmId: null });
      expect(provisional.readWarnings).toContain("legacy_identity_unverified");
      const records = [
        { sourceRecordKey: token + "one", firmName: "Synthetic provisional", firmId: governed.firmId, status: "not_selected", qualifier: null, unrecognizedFact: false },
        { sourceRecordKey: token + "two", firmName: "Synthetic missing key", firmId: null, status: "rejected", qualificationState: "needs_evidence", gap: "missing authority" },
      ];
      const draftId = (await db.query<{ id: string }>("INSERT INTO public.gta_prospect_agent_import_drafts(submitted_by,source_name,idempotency_key,payload_sha256,review_sha256,import_source_sha256,record_count,records,review_records,review_summary,state) VALUES('candidate-integration',$1,$1,$2,$2,$2,2,$3::jsonb,$4::jsonb,'{}','review_required') RETURNING id",
        [token, "e".repeat(64), JSON.stringify(records), JSON.stringify([{ sourceRecordKey: token + "one", disposition: "review_required", reason: "Unreviewed" }, { sourceRecordKey: token + "unmatched", disposition: "invalid", reason: "Source absent" }])])).rows[0].id;
      const drafts = (await list(db, { fieldPointer: "/envelope/id", fieldValue: draftId })).items;
      expect(drafts).toHaveLength(3);
      expect(drafts.every(item => item.verifiedFirmId === null)).toBe(true);
      const held = drafts.find(item => item.identityKey.endsWith("/records/0"))!;
      expect(held.originalStatuses).toEqual(["not_selected"]);
      const retained = (await history(db, held.id)).items.find(item => item.itemKind === "research_revision")!;
      expect(retained.originalJson).toMatchObject({ record: records[0], sourcePointer: "/records/0" });
      expect(retained.fields).toEqual(expect.arrayContaining([expect.objectContaining({ pointer: "/record/unrecognizedFact", value: false })]));
      expect((await list(db, { firmId: governed.firmId })).items.some(item => drafts.some(draft => draft.id === item.id))).toBe(false);
      const mapId = (await db.query<{ id: string }>("INSERT INTO public.prospect_source_record_map(source_system,source_record_id,firm_id,mapping_status,identity_decision_id,reviewed_at) VALUES('synthetic',$1,$2,'confirmed','synthetic-reviewed-decision',now()) RETURNING id", [token, governed.firmId])).rows[0].id;
      const before = await list(db, { fieldPointer: "/id", fieldValue: mapId });
      const mapping = before.items.find(item => item.identityKey === mapId)!;
      expect(mapping.verifiedFirmId).toBe(governed.firmId);
      await db.query("UPDATE public.prospect_source_record_map SET mapping_status='conflict' WHERE id=$1", [mapId]);
      const after = await list(db, { fieldPointer: "/id", fieldValue: mapId });
      expect(after.items.find(item => item.identityKey === mapId)).toMatchObject({ verifiedFirmId: null, identityState: "unresolved" });
      expect((await list(db, { fieldPointer: "/id", fieldValue: mapId }, 100, null, before.coverageRevision)).items.find(item => item.identityKey === mapId)?.verifiedFirmId).toBe(governed.firmId);
      await db.query("UPDATE public.prospect_source_record_map SET mapping_status='confirmed' WHERE id=$1", [mapId]);
      const restored = (await list(db, { fieldPointer: "/id", fieldValue: mapId })).items.find(item => item.identityKey === mapId)!;
      expect(restored.verifiedFirmId).toBe(governed.firmId);
      expect((await history(db, mapping.id)).items.filter(item => item.itemKind === "research_revision")).toHaveLength(3);
      // A changed authority dependency invalidates the link even with identical source bytes.
      await db.query("UPDATE public.gta_prospect_import_batches SET state='failed',applied_at=NULL WHERE id=$1", [governed.batchId]);
      expect((await list(db, { fieldPointer: "/id", fieldValue: mapId })).items.find(item => item.identityKey === mapId)?.verifiedFirmId).toBeNull();
      await db.query("UPDATE public.gta_prospect_import_batches SET state='applied',applied_at=now() WHERE id=$1", [governed.batchId]);
      expect((await list(db, { fieldPointer: "/id", fieldValue: mapId })).items.find(item => item.identityKey === mapId)?.verifiedFirmId).toBe(governed.firmId);
      await db.query("ALTER TABLE public.prospect_source_captures DISABLE TRIGGER candidate_legacy_projection");
      await db.query("INSERT INTO public.prospect_source_captures(requested_url,retrieval_method,observed_at,policy_state) VALUES('https://synthetic.example/unprojected','synthetic',now(),'allowed')");
      const missing = await list(db);
      expect(missing.complete).toBe(false);
      expect(missing.readWarnings).toContain("legacy_source_rows_unprojected:prospect_source_captures:1");
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 90_000);

  it("invalidates a worker link after a later reviewed hold and preserves the prior cutoff", async () => {
    const db = await pool!.connect(); await db.query("BEGIN");
    try {
      const token = "workerlink" + randomUUID().replaceAll("-", "");
      const { firmId } = await governedLegacyFirm(db, token);
      const stableId = "FIRM-" + randomUUID().replaceAll("-", "").slice(0, 26).toUpperCase();
      const domain = token + ".example";
      await db.query("INSERT INTO public.gta_prospect_stable_identity_registry(firm_id,stable_firm_id,canonical_domain,source_url,observed_on,adjudication_basis) VALUES($1,$2,$3,'https://synthetic.example/identity','2026-09-20','Synthetic reviewed identity')", [firmId, stableId, domain]);
      const workId = (await db.query<{ id: string }>("INSERT INTO public.gta_prospect_research_work_items(source_system,source_payload_sha256,source_record_key,candidate_name,source_urls,candidate_snapshot,candidate_snapshot_sha256) VALUES('synthetic',$1,$2,'Synthetic worker','[\"https://synthetic.example/worker\"]','{}',$1) RETURNING id", ["a".repeat(64), token])).rows[0].id;
      const draftId = (await db.query<{ id: string }>("INSERT INTO public.gta_prospect_worker_evidence_drafts(work_item_id,worker_id,observation_sha256,observed_on,candidate_canonical_domain,identity_state,qualification_state,hold_states,source_artifacts,canonical_observation) VALUES($1,'synthetic',$2,'2026-09-20',$3,'confirmed','needs_evidence','[]','[]','{}') RETURNING id", [workId, "c".repeat(64), domain])).rows[0].id;
      await db.query("INSERT INTO public.gta_prospect_worker_evidence_reconciliations(draft_id,reconciliation_state,firm_id,stable_firm_id,reconciliation_note,created_at) VALUES($1,'linked',$2,$3,'Synthetic reviewed link','2026-09-24T01:00:00Z')", [draftId, firmId, stableId]);
      const linked = await list(db, { fieldPointer: "/id", fieldValue: draftId });
      const candidate = linked.items.find(item => item.identityNamespace === "legacy:gta_prospect_worker_evidence_drafts")!;
      expect(candidate.verifiedFirmId).toBe(firmId);
      await db.query("INSERT INTO public.gta_prospect_worker_evidence_reconciliations(draft_id,reconciliation_state,hold_state,reconciliation_note,created_at) VALUES($1,'identity_hold','identity_unresolved','Synthetic later identity hold','2026-09-24T02:00:00Z')", [draftId]);
      const current = await list(db, { fieldPointer: "/id", fieldValue: draftId });
      expect(current.items.find(item => item.id === candidate.id)?.verifiedFirmId).toBeNull();
      expect((await list(db, { fieldPointer: "/id", fieldValue: draftId }, 100, null, linked.coverageRevision)).items.find(item => item.id === candidate.id)?.verifiedFirmId).toBe(firmId);
      expect((await list(db, { firmId })).items.some(item => item.id === candidate.id)).toBe(false);
    } finally { await db.query("ROLLBACK"); db.release(); }
  }, 90_000);

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
