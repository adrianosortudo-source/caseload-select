import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  authorized: true,
  actor: "authorized-agent",
  rpc: vi.fn(async () => ({ data: { outcome: "chunk_registered", runId: "backfill-a", runKey: "backfill-a", sourceManifestSha256: "a".repeat(64), manifestSha256: "b".repeat(64), registeredChunkCount: 1, expectedChunkCount: 1, receivedEntryCount: 1, expectedEntryCount: 1, receivedPackageCount: 1, expectedPackageCount: 1, manifestState: "open" }, error: null as null | { code?: string; message?: string } })),
}));

vi.mock("@/lib/prospect-enrichment-agent-auth", () => ({ isProspectEnrichmentAgentAuthorized: () => h.authorized, prospectEnrichmentAgentActor: () => h.actor }));
vi.mock("@/lib/supabase-admin", () => ({ supabaseAdmin: { rpc: h.rpc } }));

import { NextRequest } from "next/server";
import { prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";
import { POST } from "../route";

const sourceManifestSha256 = "a".repeat(64);
const runManifestSha256 = "b".repeat(64);
const entry = {
  entryId: "entry-a",
  researchKey: "firm-record-a",
  clientPackageId: "package-a",
  expectedPayloadSha256: "c".repeat(64),
  itemCount: 1,
  clientItems: [{ clientItemId: "obs:observation-a", itemKind: "observation", sourceEventKey: "observation:d", semanticSha256: "e".repeat(64) }],
  initialDisposition: "ready_for_review",
  source: { sourceRoot: "root-a", relativePath: "firm.json", sourcePointer: "/firms/0", fileSha256: "f".repeat(64) },
  errorCodes: [],
};
const chunkContent = {
  schemaVersion: "prospect-enrichment-run-manifest-chunk/v1",
  adapterVersion: "legacy-prospect-adapter/v1",
  runId: "backfill-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  sourceSystem: "caseload-qualification-legacy-v1",
  sourceName: "prospect-research-backfill",
  sourceManifestSha256,
  runManifestSha256,
  generatedAt: "2026-09-23T13:00:00.000Z",
  expectedPackageCount: 1,
  expectedEntryCount: 1,
  chunkIndex: 0,
  chunkCount: 1,
  entries: [entry],
};
const chunk = { ...chunkContent, chunkSha256: prospectEnrichmentProtocolHash(chunkContent.entries) };

function request(value: unknown, finalize = false, idempotencyKey?: string) {
  const key = idempotencyKey ?? "pe-manifest-v1-" + prospectEnrichmentProtocolHash([chunk.sourceSystem, chunk.runId, chunk.runManifestSha256, chunk.chunkIndex, finalize]);
  return new NextRequest("https://admin.caseloadselect.ca/api/internal/prospect-enrichment/runs/manifest-chunks", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": key, authorization: "Bearer test" }, body: JSON.stringify(value),
  });
}

beforeEach(() => {
  h.authorized = true;
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: { outcome: "chunk_registered", runId: chunk.runId, runKey: chunk.runId, sourceManifestSha256, manifestSha256: runManifestSha256, registeredChunkCount: 1, expectedChunkCount: 1, receivedEntryCount: 1, expectedEntryCount: 1, receivedPackageCount: 1, expectedPackageCount: 1, manifestState: "open" }, error: null });
});

describe("internal prospect enrichment manifest registration", () => {
  it("requires the protected agent bearer before database access", async () => {
    h.authorized = false;
    const response = await POST(request({ chunk, finalize: false }));
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("rejects an incomplete or corrupted chunk before registration", async () => {
    const response = await POST(request({ chunk: { ...chunk, chunkSha256: "0".repeat(64) }, finalize: false }));
    expect(response.status).toBe(422);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("requires the deterministic idempotency key for this exact chunk operation", async () => {
    const response = await POST(request({ chunk, finalize: false }, false, "wrong"));
    expect(response.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("registers only the validated chunk and returns the database receipt", async () => {
    const response = await POST(request({ chunk, finalize: false }));
    expect(response.status).toBe(201);
    expect(h.rpc).toHaveBeenCalledWith("register_prospect_enrichment_manifest_chunk_v1", {
      p_submitted_by: "authorized-agent", p_chunk: chunk, p_finalize: false,
    });
    expect(await response.json()).toMatchObject({ outcome: "chunk_registered", manifestState: "open" });
  });

  it("preserves explicit finalization as an exact replay of the last chunk", async () => {
    h.rpc.mockResolvedValue({ data: { outcome: "finalized", runId: chunk.runId, runKey: chunk.runId, sourceManifestSha256, manifestSha256: runManifestSha256, registeredChunkCount: 1, expectedChunkCount: 1, receivedEntryCount: 1, expectedEntryCount: 1, receivedPackageCount: 1, expectedPackageCount: 1, manifestState: "finalized" }, error: null });
    const response = await POST(request({ chunk, finalize: true }, true));
    expect(response.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("register_prospect_enrichment_manifest_chunk_v1", expect.objectContaining({ p_finalize: true }));
    expect(await response.json()).toMatchObject({ outcome: "finalized", manifestState: "finalized" });
  });
});
