import { prospectEnrichmentProtocolHash as hash } from "@/lib/prospect-enrichment-hash";
import type { ReadDatabase } from "./_package-read";
import { databaseRows, isRecord, ReadApiError, READ_UUID } from "./_read-common";

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
