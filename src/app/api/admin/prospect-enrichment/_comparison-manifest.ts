import { prospectEnrichmentProtocolHash as hash } from "@/lib/prospect-enrichment-hash";
import type { ReadDatabase } from "./_package-read";
import { databaseRows, isRecord, ReadApiError, READ_UUID } from "./_read-common";

const WHOLE_FIRM_ADAPTER = "whole-firm-adapter/v1";
const MANIFEST_CHUNK_SCHEMA = "prospect-enrichment-run-manifest-chunk/v1";
const HELD_EVIDENCE_SCHEMA = "prospect-enrichment-held-candidate-evidence/v1";
function same(left: unknown, right: unknown): boolean { return hash(left) === hash(right); }
function marker(entry: Record<string, unknown>): string | null {
  const codes = Array.isArray(entry.errorCodes) ? entry.errorCodes.filter((value): value is string => typeof value === "string") : [];
  const values = codes.filter((value) => value.startsWith("__held_evidence_sha256:"));
  if (values.length > 1 || values.some((value) => !/^__held_evidence_sha256:[a-f0-9]{64}$/.test(value))) {
    throw new ReadApiError("The open run has an invalid held-evidence commitment.", 503);
  }
  return values[0]?.slice("__held_evidence_sha256:".length) ?? null;
}

export type RegisteredRunManifest = {
  runId: string;
  sourceSystem: string;
  sourceName: string;
  sourceManifestSha256: string;
  generatedAt: string;
  expectedPackageCount: number;
  entries: Record<string, unknown>[];
  manifestSha256: string;
};

function count(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new ReadApiError("The registered Admin run inventory is incomplete.", 503);
  }
  return Number(value);
}

/** Bind the uploaded, re-hashed request to the immutable inventory finalized in Admin. */
export async function requireRegisteredRunManifest(input: { manifest: RegisteredRunManifest; actor: string; client: ReadDatabase }): Promise<{ adminRunId: string }> {
  const { manifest, actor, client } = input;
  const rows = databaseRows(await client.from("prospect_enrichment_runs")
    .select("id,submitted_by,run_key,source_system,source_name,source_manifest_sha256,manifest_sha256,manifest_generated_at,manifest_expected_package_count,manifest_expected_entry_count,manifest_expected_chunk_count,manifest_registered_chunk_count,manifest_state")
    .eq("submitted_by", actor).eq("run_key", manifest.runId).limit(2));
  if (rows.length !== 1) throw new ReadApiError("The comparison request does not match one finalized Admin run.", 422);
  const run = rows[0];
  const expectedEntries = count(run.manifest_expected_entry_count);
  const expectedPackages = count(run.manifest_expected_package_count);
  const expectedChunks = count(run.manifest_expected_chunk_count);
  const registeredChunks = count(run.manifest_registered_chunk_count);
  if (run.submitted_by !== actor || run.run_key !== manifest.runId || run.source_system !== manifest.sourceSystem ||
      run.source_name !== manifest.sourceName || run.source_manifest_sha256 !== manifest.sourceManifestSha256 ||
      run.manifest_sha256 !== manifest.manifestSha256 || run.manifest_generated_at !== manifest.generatedAt ||
      run.manifest_state !== "finalized" || expectedChunks < 1 || registeredChunks !== expectedChunks ||
      expectedEntries !== manifest.entries.length || expectedPackages !== manifest.expectedPackageCount) {
    throw new ReadApiError("The comparison request does not match one complete finalized Admin run.", 422);
  }

  const registered: Record<string, unknown>[] = [];
  let after: string | null = null;
  while (true) {
    const page = databaseRows(await client.rpc("list_prospect_enrichment_run_manifest_items_v1", {
      p_run_id: run.id, p_after_entry_id: after, p_limit: 100,
    }));
    if (page.length > 100 || page.length === 0 && registered.length !== expectedEntries) throw new ReadApiError("The finalized Admin run inventory could not be read completely.", 503);
    for (const row of page) {
      const entryId = typeof row.entry_id === "string" ? row.entry_id : "";
      if (!entryId || after !== null && entryId <= after || !isRecord(row.manifest_entry) || row.manifest_entry.entryId !== entryId) {
        throw new ReadApiError("The finalized Admin run inventory is inconsistent.", 503);
      }
      registered.push(row.manifest_entry);
      after = entryId;
    }
    if (registered.length > expectedEntries) throw new ReadApiError("The finalized Admin run inventory contains unexpected entries.", 503);
    if (page.length < 100) break;
  }

  if (registered.length !== expectedEntries || hash(registered) !== hash(manifest.entries)) {
    throw new ReadApiError("The comparison request omits or changes entries from the finalized Admin run.", 422);
  }
  if (typeof run.id !== "string" || !READ_UUID.test(run.id)) throw new ReadApiError("The finalized Admin run identity is invalid.", 503);
  return { adminRunId: run.id };
}

/** Bootstrap comparisons are permitted only before this actor has registered the source-derived run key. */
export async function requireUnregisteredRunManifest(input: { runId: string; actor: string; client: ReadDatabase }): Promise<void> {
  const rows = databaseRows(await input.client.from("prospect_enrichment_runs")
    .select("id,submitted_by,run_key,manifest_state").eq("submitted_by", input.actor).eq("run_key", input.runId).limit(2));
  if (rows.length !== 0) throw new ReadApiError("A bootstrap comparison requires an unregistered run key.", 409);
}

/**
 * Read-only recovery binding for a partially registered whole-firm manifest.
 * Only an exact open run and its contiguous, source-identical append-only prefix qualify.
 */
export async function requireResumableRunManifest(input: { manifest: RegisteredRunManifest; actor: string; client: ReadDatabase }): Promise<{ readSetSha256: string }> {
  const { manifest, actor, client } = input;
  const rows = databaseRows(await client.from("prospect_enrichment_runs")
    .select("id,submitted_by,run_key,source_system,source_name,source_manifest_sha256,manifest_sha256,manifest_generated_at,manifest_expected_package_count,manifest_expected_entry_count,manifest_expected_chunk_count,manifest_registered_chunk_count,manifest_state,manifest_finalized_at")
    .eq("submitted_by", actor).eq("run_key", manifest.runId).limit(2));
  if (rows.length !== 1) throw new ReadApiError("A resume comparison requires one existing open Admin run.", 409);
  const run = rows[0];
  const expectedEntries = count(run.manifest_expected_entry_count), expectedPackages = count(run.manifest_expected_package_count);
  const expectedChunks = count(run.manifest_expected_chunk_count), registeredChunks = count(run.manifest_registered_chunk_count);
  const sourceChunks: Record<string, unknown>[][] = [];
  let pending: Record<string, unknown>[] = [];
  for (const rawEntry of manifest.entries) {
    const entry = rawEntry as Record<string, unknown>;
    if (Buffer.byteLength(JSON.stringify(entry)) > 1_048_576) throw new ReadApiError("The requested manifest has an oversized source entry.", 422);
    if (pending.length && (pending.length >= 100 || Buffer.byteLength(JSON.stringify([...pending, entry])) > 1_048_576)) {
      sourceChunks.push(pending); pending = [];
    }
    pending.push(entry);
  }
  if (pending.length || !sourceChunks.length) sourceChunks.push(pending);
  if (run.submitted_by !== actor || run.run_key !== manifest.runId || run.source_system !== manifest.sourceSystem ||
      run.source_name !== manifest.sourceName || run.source_manifest_sha256 !== manifest.sourceManifestSha256 ||
      run.manifest_sha256 !== manifest.manifestSha256 || run.manifest_generated_at !== manifest.generatedAt ||
      run.manifest_state !== "open" || run.manifest_finalized_at !== null || expectedEntries !== manifest.entries.length ||
      expectedPackages !== manifest.expectedPackageCount || expectedChunks !== sourceChunks.length || expectedChunks < 1 || registeredChunks < 1 || registeredChunks > expectedChunks ||
      expectedEntries < manifest.entries.length || manifest.entries.some((entry) => !isRecord(entry))) {
    throw new ReadApiError("The open Admin run does not match the exact requested final manifest.", 409);
  }
  if (typeof run.id !== "string" || !READ_UUID.test(run.id)) throw new ReadApiError("The open Admin run identity is invalid.", 503);

  const chunks = databaseRows(await client.from("prospect_enrichment_run_manifest_chunks")
    .select("run_id,chunk_index,chunk_sha256,entry_count,chunk_body")
    .eq("run_id", run.id).order("chunk_index", { ascending: true }).limit(expectedChunks + 1));
  if (chunks.length !== registeredChunks || chunks.length > expectedChunks) throw new ReadApiError("The registered manifest chunk prefix is incomplete or unexpected.", 503);
  const prefixEntries: Record<string, unknown>[] = [];
  const chunkIndexByEntryId = new Map<string, number>();
  for (let index = 0; index < chunks.length; index++) {
    const row = chunks[index], body = row.chunk_body;
    if (row.run_id !== run.id || row.chunk_index !== index || !Number.isSafeInteger(row.entry_count) ||
        !isRecord(body) || !Array.isArray(body.entries) || body.entries.length !== row.entry_count) {
      throw new ReadApiError("The registered manifest chunk prefix is not contiguous.", 503);
    }
    const entries = sourceChunks[index];
    if (!entries || entries.length !== row.entry_count) throw new ReadApiError("The registered manifest chunk exceeds the requested source inventory.", 503);
    const expected = {
      schemaVersion: MANIFEST_CHUNK_SCHEMA, adapterVersion: WHOLE_FIRM_ADAPTER, runId: manifest.runId,
      sourceSystem: manifest.sourceSystem, sourceName: manifest.sourceName, sourceManifestSha256: manifest.sourceManifestSha256,
      runManifestSha256: manifest.manifestSha256, generatedAt: manifest.generatedAt,
      expectedPackageCount: manifest.expectedPackageCount, expectedEntryCount: manifest.entries.length,
      chunkIndex: index, chunkCount: expectedChunks, chunkSha256: hash(entries), entries,
    };
    if (!same(body, expected) || row.chunk_sha256 !== expected.chunkSha256) {
      throw new ReadApiError("A registered manifest chunk differs from the requested source prefix.", 409);
    }
    for (const entry of entries) chunkIndexByEntryId.set(String(entry.entryId), index);
    prefixEntries.push(...entries);
  }

  const sourceById = new Map(prefixEntries.map((entry) => [String(entry.entryId), entry]));
  if (sourceById.size !== prefixEntries.length) throw new ReadApiError("The requested manifest repeats an entry identity.", 409);
  const registeredItems: Record<string, unknown>[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunkEntries = (chunks[index].chunk_body as Record<string, unknown>).entries as Record<string, unknown>[];
    const page = databaseRows(await client.from("prospect_enrichment_run_manifest_items")
      .select("run_id,entry_id,client_package_id,research_key,expected_payload_sha256,item_count,client_items,initial_disposition,source_root,relative_path,source_pointer,file_sha256,error_codes,chunk_index,manifest_entry")
      .eq("run_id", run.id).eq("chunk_index", index).order("entry_id", { ascending: true }).limit(chunkEntries.length + 1));
    if (page.length !== chunkEntries.length || page.length > 100) throw new ReadApiError("The registered manifest item prefix is incomplete or oversized.", 503);
    if (page.some((row) => {
      const entry = sourceById.get(String(row.entry_id));
      if (!entry || !isRecord(entry.source) || row.run_id !== run.id || row.chunk_index !== index) return true;
      const source = entry.source;
      return !same(row.manifest_entry, entry) || row.client_package_id !== entry.clientPackageId || row.research_key !== entry.researchKey ||
        row.expected_payload_sha256 !== entry.expectedPayloadSha256 || row.item_count !== entry.itemCount || !same(row.client_items, entry.clientItems) ||
        row.initial_disposition !== entry.initialDisposition || row.source_root !== source.sourceRoot || row.relative_path !== source.relativePath ||
        row.source_pointer !== source.sourcePointer || row.file_sha256 !== source.fileSha256 || !same(row.error_codes, entry.errorCodes);
    })) throw new ReadApiError("A registered manifest item differs from the requested source prefix.", 409);
    registeredItems.push(...page);
  }

  const heldByEntry = new Map<string, { digest: string; entry: Record<string, unknown> }>();
  for (const entry of prefixEntries) {
    if (entry.clientPackageId === null && entry.researchKey !== null) {
      const digest = marker(entry);
      if (digest) heldByEntry.set(String(entry.entryId), { digest, entry });
    }
  }
  const heldRows: Record<string, unknown>[] = [];
  let afterEntryId: string | null = null;
  for (let pageIndex = 0; pageIndex <= 100; pageIndex++) {
    let query = client.from("prospect_enrichment_manifest_hold_evidence")
      .select("run_id,entry_id,evidence_sha256,evidence").eq("run_id", run.id);
    if (afterEntryId !== null) query = query.gt("entry_id", afterEntryId);
    const page = databaseRows(await query.order("entry_id", { ascending: true }).limit(100));
    if (page.length > 100 || heldRows.length + page.length > 10000) throw new ReadApiError("The registered held-evidence prefix exceeds the bounded read limit.", 503);
    heldRows.push(...page);
    if (page.length < 100) break;
    const last = page.at(-1)?.entry_id;
    if (typeof last !== "string" || last <= (afterEntryId ?? "")) throw new ReadApiError("The held-evidence read cursor is inconsistent.", 503);
    afterEntryId = last;
    if (pageIndex === 100) throw new ReadApiError("The registered held-evidence prefix exceeds the bounded page limit.", 503);
  }
  if (heldRows.some((row) => {
    const expected = heldByEntry.get(String(row.entry_id)), evidence = row.evidence;
    if (!expected || row.run_id !== run.id || row.evidence_sha256 !== expected.digest || !isRecord(evidence) ||
        evidence.schemaVersion !== HELD_EVIDENCE_SCHEMA || evidence.runId !== manifest.runId || evidence.entryId !== row.entry_id ||
        evidence.researchKey !== expected.entry.researchKey || typeof evidence.originalJson !== "string" || !Array.isArray(evidence.issues) ||
        !same(evidence.source, expected.entry.source) || evidence.evidenceSha256 !== expected.digest) return true;
    const core = { ...evidence }; delete core.evidenceSha256; delete core.runId;
    return hash(core) !== expected.digest;
  })) throw new ReadApiError("A registered held-evidence receipt differs from its source commitment.", 409);

  const packageRows = databaseRows(await client.from("prospect_enrichment_packages").select("id").eq("run_id", run.id).limit(1));
  if (packageRows.length !== 0) throw new ReadApiError("An open run with package rows cannot authorize a resume comparison.", 409);
  return { readSetSha256: hash({ run, chunks, registeredItems, heldRows, packageRows }) };
}
