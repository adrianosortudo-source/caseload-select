import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/client-import-server", () => ({ validateSameOrigin: vi.fn(() => true) }));
import { requireRegisteredRunManifest, requireResumableRunManifest, requireUnregisteredRunManifest, type RegisteredRunManifest } from "../_comparison-manifest";
import { prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";
import type { ReadDatabase } from "../_package-read";

const actor = "prospect-enrichment-agent-v1";
const entry = (entryId: string, clientPackageId: string | null) => ({ entryId, researchKey: clientPackageId ? "research:" + clientPackageId : null, clientPackageId, expectedPayloadSha256: clientPackageId ? "a".repeat(64) : null, itemCount: 0, clientItems: [], initialDisposition: clientPackageId ? "ready_for_review" : "hold_schema", source: { sourceRoot: "synthetic", relativePath: entryId, sourcePointer: "", fileSha256: null }, errorCodes: clientPackageId ? [] : ["hold_schema"] });
const manifest: RegisteredRunManifest = { runId: "synthetic-run", sourceSystem: "synthetic", sourceName: "synthetic-inventory", sourceManifestSha256: "b".repeat(64), generatedAt: "2026-09-23T12:00:00.000Z", expectedPackageCount: 1, entries: [entry("entry-a", "package-a"), entry("entry-b", null)], manifestSha256: "c".repeat(64) };
const runRow = (overrides: Record<string, unknown> = {}) => ({ id: "00000000-0000-4000-8000-000000000001", submitted_by: actor, run_key: manifest.runId, source_system: manifest.sourceSystem, source_name: manifest.sourceName, source_manifest_sha256: manifest.sourceManifestSha256, manifest_sha256: manifest.manifestSha256, manifest_generated_at: manifest.generatedAt, manifest_expected_entry_count: 2, manifest_expected_package_count: 1, manifest_expected_chunk_count: 1, manifest_registered_chunk_count: 1, manifest_state: "finalized", ...overrides });
function client(options: { row?: Record<string, unknown> | null; entries?: Record<string, unknown>[] } = {}) {
  const row = options.row === undefined ? runRow() : options.row;
  const entries = options.entries ?? manifest.entries.map((manifest_entry) => ({ entry_id: manifest_entry.entryId, manifest_entry }));
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), limit: vi.fn(async () => ({ data: row ? [row] : [], error: null })) };
  const rpc = vi.fn(async (_name: string, args: { p_after_entry_id: string | null; p_limit: number }) => ({ data: entries.filter((value) => typeof value.entry_id === "string" && (!args.p_after_entry_id || value.entry_id > args.p_after_entry_id)).slice(0, args.p_limit), error: null }));
  return { db: { from: vi.fn(() => query), rpc } as unknown as ReadDatabase, rpc };
}

function resumableClient(options: { manifest?: RegisteredRunManifest; registeredCount?: number; run?: Record<string, unknown>; chunks?: Record<string, unknown>[]; items?: Record<string, unknown>[]; holds?: Record<string, unknown>[]; packages?: Record<string, unknown>[] } = {}) {
  const source = options.manifest ?? manifest;
  const sourceChunks: Record<string, unknown>[][] = [];
  let pending: Record<string, unknown>[] = [];
  for (const rawEntry of source.entries) {
    const entry = rawEntry as Record<string, unknown>;
    if (pending.length && (pending.length >= 100 || Buffer.byteLength(JSON.stringify([...pending, entry])) > 1_048_576)) { sourceChunks.push(pending); pending = []; }
    pending.push(entry);
  }
  if (pending.length || !sourceChunks.length) sourceChunks.push(pending);
  const registeredCount = options.registeredCount ?? sourceChunks.length;
  const run = { ...runRow({ run_key: source.runId, source_system: source.sourceSystem, source_name: source.sourceName,
    source_manifest_sha256: source.sourceManifestSha256, manifest_sha256: source.manifestSha256, manifest_generated_at: source.generatedAt,
    manifest_expected_entry_count: source.entries.length, manifest_expected_package_count: source.expectedPackageCount,
    manifest_expected_chunk_count: sourceChunks.length, manifest_registered_chunk_count: registeredCount,
    manifest_state: "open", manifest_finalized_at: null }), manifest_state: "open", manifest_finalized_at: null };
  const chunkBodies = sourceChunks.map((chunkEntries, index) => ({ schemaVersion: "prospect-enrichment-run-manifest-chunk/v1", adapterVersion: "whole-firm-adapter/v1", runId: source.runId,
    sourceSystem: source.sourceSystem, sourceName: source.sourceName, sourceManifestSha256: source.sourceManifestSha256,
    runManifestSha256: source.manifestSha256, generatedAt: source.generatedAt, expectedPackageCount: source.expectedPackageCount,
    expectedEntryCount: source.entries.length, chunkIndex: index, chunkCount: sourceChunks.length,
    chunkSha256: prospectEnrichmentProtocolHash(chunkEntries), entries: chunkEntries }));
  const items = sourceChunks.slice(0, registeredCount).flatMap((chunkEntries, chunk_index) => chunkEntries.map((rawEntry) => { const manifest_entry = rawEntry as Record<string, unknown> & { source: Record<string, unknown> }; return ({ run_id: run.id, entry_id: manifest_entry.entryId,
    client_package_id: manifest_entry.clientPackageId, research_key: manifest_entry.researchKey,
    expected_payload_sha256: manifest_entry.expectedPayloadSha256, item_count: manifest_entry.itemCount,
    client_items: manifest_entry.clientItems, initial_disposition: manifest_entry.initialDisposition,
    source_root: manifest_entry.source.sourceRoot, relative_path: manifest_entry.source.relativePath,
    source_pointer: manifest_entry.source.sourcePointer, file_sha256: manifest_entry.source.fileSha256,
    error_codes: manifest_entry.errorCodes, chunk_index, manifest_entry }); }));
  const tables: Record<string, Record<string, unknown>[]> = {
    prospect_enrichment_runs: [options.run ?? run],
    prospect_enrichment_run_manifest_chunks: options.chunks ?? chunkBodies.slice(0, registeredCount).map((chunk_body, chunk_index) => ({ run_id: run.id, chunk_index, chunk_sha256: chunk_body.chunkSha256, entry_count: (chunk_body.entries as unknown[]).length, chunk_body })),
    prospect_enrichment_run_manifest_items: options.items ?? items,
    prospect_enrichment_manifest_hold_evidence: options.holds ?? [],
    prospect_enrichment_packages: options.packages ?? [],
  };
  const db = { from: vi.fn((table: string) => {
    const filters: { column: string; value: unknown; kind: "eq" | "gt" }[] = [];
    const query = { select: vi.fn(() => query), eq: vi.fn((column: string, value: unknown) => { filters.push({ column, value, kind: "eq" }); return query; }),
      gt: vi.fn((column: string, value: unknown) => { filters.push({ column, value, kind: "gt" }); return query; }), order: vi.fn(() => query),
      limit: vi.fn(async (limit: number) => ({ data: (tables[table] ?? []).filter((row) => filters.every((filter) => filter.kind === "eq" ? row[filter.column] === filter.value : String(row[filter.column]) > String(filter.value))).slice(0, limit), error: null })) };
    return query;
  }) } as unknown as ReadDatabase;
  return { db, run, chunkBody: chunkBodies[0], items, tables };
}

describe("comparison request frozen Admin run binding", () => {
  it("allows bootstrap only when the actor has no run for the source-derived key", async () => {
    const absent = client({ row: null });
    await expect(requireUnregisteredRunManifest({ runId: manifest.runId, actor, client: absent.db })).resolves.toBeUndefined();
    const present = client();
    await expect(requireUnregisteredRunManifest({ runId: manifest.runId, actor, client: present.db })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects a run that appears between the two complete bootstrap reads", async () => {
    let reads = 0;
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), limit: vi.fn(async () => ({ data: reads++ === 0 ? [] : [runRow()], error: null })) };
    const db = { from: vi.fn(() => query) } as unknown as ReadDatabase;
    await expect(requireUnregisteredRunManifest({ runId: manifest.runId, actor, client: db })).resolves.toBeUndefined();
    await expect(requireUnregisteredRunManifest({ runId: manifest.runId, actor, client: db })).rejects.toMatchObject({ status: 409 });
  });
  it("binds recovery to an exact contiguous partial-open chunk prefix and rejects mismatches or package rows", async () => {
    const partial = resumableClient();
    await expect(requireResumableRunManifest({ manifest, actor, client: partial.db })).resolves.toMatchObject({ readSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const changedChunk = resumableClient({ chunks: [{ run_id: partial.run.id, chunk_index: 0, chunk_sha256: "f".repeat(64), entry_count: 2, chunk_body: { ...partial.chunkBody, sourceName: "changed-source" } }] });
    await expect(requireResumableRunManifest({ manifest, actor, client: changedChunk.db })).rejects.toMatchObject({ status: 409 });
    const changedRun = resumableClient({ run: { ...partial.run, manifest_sha256: "d".repeat(64) } });
    await expect(requireResumableRunManifest({ manifest, actor, client: changedRun.db })).rejects.toMatchObject({ status: 409 });
    const stagedPackage = resumableClient({ packages: [{ id: "package-server-row", run_id: partial.run.id }] });
    await expect(requireResumableRunManifest({ manifest, actor, client: stagedPackage.db })).rejects.toMatchObject({ status: 409 });
  });
  it("reads a 1,100-entry partial resume as bounded 100-entry chunk pages", async () => {
    const entries = Array.from({ length: 1100 }, (_, index) => entry(`entry-${String(index).padStart(4, "0")}`, null));
    const content = { schemaVersion: "prospect-enrichment-run-manifest/v1" as const, runId: "synthetic-large-run", sourceSystem: "synthetic",
      sourceName: "synthetic-inventory", sourceManifestSha256: "b".repeat(64), generatedAt: "2026-09-23T12:00:00.000Z", expectedPackageCount: 0, entries };
    const large: RegisteredRunManifest = { ...content, manifestSha256: prospectEnrichmentProtocolHash(content) };
    const partial = resumableClient({ manifest: large, registeredCount: 3 });
    await expect(requireResumableRunManifest({ manifest: large, actor, client: partial.db })).resolves.toMatchObject({ readSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  it("permits missing held-body receipts for retry and verifies every recorded body against its manifest commitment", async () => {
    const heldCore = { schemaVersion: "prospect-enrichment-held-candidate-evidence/v1", entryId: "candidate-hold", researchKey: "research:held",
      source: { sourceRoot: "synthetic", relativePath: "held.json", sourcePointer: "/firms/held", fileSha256: "a".repeat(64) },
      originalJson: "{\"firmName\":\"Held Synthetic Firm\"}", issues: [{ code: "identity_unresolved", path: "/firmId", reason: "No safe firm identity was established." }] };
    const digest = prospectEnrichmentProtocolHash(heldCore);
    const heldEntry = { ...entry("candidate-hold", null), researchKey: "research:held", source: heldCore.source, errorCodes: ["identity_unresolved", `__held_evidence_sha256:${digest}`] };
    const content = { schemaVersion: "prospect-enrichment-run-manifest/v1" as const, runId: "synthetic-held-run", sourceSystem: "synthetic",
      sourceName: "synthetic-inventory", sourceManifestSha256: "b".repeat(64), generatedAt: "2026-09-23T12:00:00.000Z", expectedPackageCount: 0, entries: [heldEntry] };
    const heldManifest: RegisteredRunManifest = { ...content, manifestSha256: prospectEnrichmentProtocolHash(content) };
    const heldReceipt = { ...heldCore, runId: heldManifest.runId, evidenceSha256: digest };
    const missing = resumableClient({ manifest: heldManifest });
    await expect(requireResumableRunManifest({ manifest: heldManifest, actor, client: missing.db })).resolves.toBeDefined();
    const present = resumableClient({ manifest: heldManifest, holds: [{ run_id: missing.run.id, entry_id: heldEntry.entryId, evidence_sha256: digest, evidence: heldReceipt }] });
    await expect(requireResumableRunManifest({ manifest: heldManifest, actor, client: present.db })).resolves.toBeDefined();
    const altered = resumableClient({ manifest: heldManifest, holds: [{ run_id: missing.run.id, entry_id: heldEntry.entryId, evidence_sha256: digest, evidence: { ...heldReceipt, originalJson: "{\"firmName\":\"altered\"}" } }] });
    await expect(requireResumableRunManifest({ manifest: heldManifest, actor, client: altered.db })).rejects.toMatchObject({ status: 409 });
  });
  it("requires the complete finalized server inventory, including package-less hold entries", async () => {
    const fake = client();
    await expect(requireRegisteredRunManifest({ manifest, actor, client: fake.db })).resolves.toEqual({ adminRunId: runRow().id });
    expect(fake.rpc).toHaveBeenCalledWith("list_prospect_enrichment_run_manifest_items_v1", { p_run_id: runRow().id, p_after_entry_id: null, p_limit: 100 });
  });
  it("rejects a shortened and freshly re-hashed manifest that omits a hold row", async () => {
    const fake = client();
    const shortened = { ...manifest, entries: [manifest.entries[0]], manifestSha256: "d".repeat(64) };
    await expect(requireRegisteredRunManifest({ manifest: shortened, actor, client: fake.db })).rejects.toThrow(/complete finalized Admin run/);
    expect(fake.rpc).not.toHaveBeenCalled();
  });
  it("rejects another actor's run and a run that is not finalized", async () => {
    await expect(requireRegisteredRunManifest({ manifest, actor, client: client({ row: runRow({ submitted_by: "different-agent" }) }).db })).rejects.toThrow(/complete finalized Admin run/);
    await expect(requireRegisteredRunManifest({ manifest, actor, client: client({ row: runRow({ manifest_state: "open" }) }).db })).rejects.toThrow(/complete finalized Admin run/);
  });
  it("rejects a partial or changed database read-back", async () => {
    const partial = client({ entries: [{ entry_id: manifest.entries[0].entryId, manifest_entry: manifest.entries[0] }] });
    await expect(requireRegisteredRunManifest({ manifest, actor, client: partial.db })).rejects.toThrow(/omits or changes entries/);
    const changedEntries = manifest.entries.map((value, index) => ({ entry_id: value.entryId, manifest_entry: index ? value : { ...value, errorCodes: ["changed"] } }));
    await expect(requireRegisteredRunManifest({ manifest, actor, client: client({ entries: changedEntries }).db })).rejects.toThrow(/omits or changes entries/);
  });
});
