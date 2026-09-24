import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: {} }));
vi.mock("@/lib/client-import-server", () => ({ validateSameOrigin: vi.fn(() => true) }));
import { requireRegisteredRunManifest, type RegisteredRunManifest } from "../_comparison-manifest";
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

describe("comparison request frozen Admin run binding", () => {
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
