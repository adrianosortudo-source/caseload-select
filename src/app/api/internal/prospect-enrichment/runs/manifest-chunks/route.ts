import { NextRequest, NextResponse } from "next/server";
import { PROSPECT_ENRICHMENT_MAX_BODY_BYTES } from "@/lib/prospect-enrichment-contract";
import { prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";
import { readBoundedJson } from "@/lib/prospect-enrichment-auth";
import { isProspectEnrichmentAgentAuthorized, prospectEnrichmentAgentActor } from "@/lib/prospect-enrichment-agent-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const sha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).byteLength <= max;
const dispositions = new Set(["ready_for_review", "identity_hold", "evidence_hold", "hold_schema", "source_root_unavailable", "source_read_failed", "source_changed_during_snapshot", "reference_out_of_scope", "reference_provenance_only", "provenance_only"]);
const chunkKeys = ["schemaVersion", "adapterVersion", "runId", "sourceSystem", "sourceName", "sourceManifestSha256", "runManifestSha256", "generatedAt", "expectedPackageCount", "expectedEntryCount", "chunkIndex", "chunkCount", "chunkSha256", "entries"];
const entryKeys = ["entryId", "researchKey", "clientPackageId", "expectedPayloadSha256", "itemCount", "clientItems", "initialDisposition", "source", "errorCodes"];
const sourceKeys = ["sourceRoot", "relativePath", "sourcePointer", "fileSha256"];
const clientItemKeys = ["clientItemId", "itemKind", "sourceEventKey", "semanticSha256"];

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max; }
function validManifestEntry(value: unknown): boolean {
  if (!exact(value, entryKeys) || !text(value.entryId, 200) || !(value.researchKey === null || text(value.researchKey, 2000))
    || !(value.clientPackageId === null || (/^[a-z0-9][a-z0-9._-]{0,119}$/.test(String(value.clientPackageId))))
    || !(value.expectedPayloadSha256 === null || sha256(value.expectedPayloadSha256))
    || !integer(value.itemCount, 1001) || !Array.isArray(value.clientItems) || value.clientItems.length !== value.itemCount
    || !dispositions.has(String(value.initialDisposition)) || !exact(value.source, sourceKeys)
    || !(value.source.sourceRoot === null || text(value.source.sourceRoot, 2000))
    || !text(value.source.relativePath, 4000) || new TextEncoder().encode(value.source.relativePath).byteLength > 4000
    || typeof value.source.sourcePointer !== "string" || new TextEncoder().encode(value.source.sourcePointer).byteLength > 4000
    || !(value.source.fileSha256 === null || sha256(value.source.fileSha256))
    || !Array.isArray(value.errorCodes) || !value.errorCodes.every((code) => text(code, 300))) return false;
  if (!value.clientItems.every((item: unknown) => exact(item, clientItemKeys) && text(item.clientItemId, 200)
    && ["source", "observation", "assessment"].includes(String(item.itemKind)) && text(item.sourceEventKey, 160) && sha256(item.semanticSha256))) return false;
  return value.clientPackageId === null
    ? value.expectedPayloadSha256 === null && value.itemCount === 0 && value.clientItems.length === 0
    : typeof value.researchKey === "string" && sha256(value.expectedPayloadSha256);
}
function validateChunk(value: unknown): value is Record<string, unknown> {
  if (!exact(value, chunkKeys) || value.schemaVersion !== "prospect-enrichment-run-manifest-chunk/v1"
    || !text(value.adapterVersion, 120) || !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(String(value.runId))
    || !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(String(value.sourceSystem)) || !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(String(value.sourceName))
    || !sha256(value.sourceManifestSha256) || !sha256(value.runManifestSha256) || typeof value.generatedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.generatedAt) || !Number.isFinite(Date.parse(value.generatedAt))
    || !integer(value.expectedPackageCount) || !integer(value.expectedEntryCount, 1_000_000) || value.expectedPackageCount > value.expectedEntryCount
    || !integer(value.chunkIndex, 100_000) || !integer(value.chunkCount, 100_000) || value.chunkCount < 1 || value.chunkIndex >= value.chunkCount
    || !sha256(value.chunkSha256) || !Array.isArray(value.entries) || value.entries.length > 1000
    || !value.entries.every(validManifestEntry) || prospectEnrichmentProtocolHash(value.entries) !== value.chunkSha256) return false;
  const ids = value.entries.map((entry: Record<string, unknown>) => entry.entryId);
  const packageIds = value.entries.flatMap((entry: Record<string, unknown>) => typeof entry.clientPackageId === "string" ? [entry.clientPackageId] : []);
  return new Set(ids).size === ids.length && new Set(packageIds).size === packageIds.length;
}

function response(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: noStore }); }

export async function POST(request: NextRequest) {
  if (!isProspectEnrichmentAgentAuthorized(request)) return response({ error: "Unauthorized" }, 401);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return response({ error: "Content-Type must be application/json." }, 400);
  const body = await readBoundedJson(request, PROSPECT_ENRICHMENT_MAX_BODY_BYTES);
  if (!body.ok) return response({ error: body.error }, body.status);
  if (!exact(body.value, ["chunk", "finalize"]) || typeof body.value.finalize !== "boolean" || !validateChunk(body.value.chunk)) return response({ error: "The frozen manifest chunk is invalid." }, 422);
  const chunk = body.value.chunk;
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  const expectedKey = "pe-manifest-v1-" + prospectEnrichmentProtocolHash([chunk.sourceSystem, chunk.runId, chunk.runManifestSha256, chunk.chunkIndex, body.value.finalize]);
  if (key !== expectedKey) return response({ error: "Idempotency-Key does not match this frozen manifest chunk." }, 400);

  try {
    const { data, error } = await supabaseAdmin.rpc("register_prospect_enrichment_manifest_chunk_v1", {
      p_submitted_by: prospectEnrichmentAgentActor(),
      p_chunk: chunk,
      p_finalize: body.value.finalize,
    });
    if (error) {
      const code = error.message?.split(":", 1)[0] ?? error.code ?? "database_unavailable";
      const status = ["manifest_conflict", "chunk_conflict", "run_conflict"].includes(code) ? 409 : code === "invalid_chunk" ? 422 : 503;
      return response({ error: status === 409 ? "The frozen run manifest conflicts with a previously registered version." : "The run manifest could not be registered.", code }, status);
    }
    const receipt = Array.isArray(data) ? data[0] : data;
    if (!record(receipt) || !["chunk_registered", "chunk_replayed", "finalized", "already_finalized"].includes(String(receipt.outcome))) {
      return response({ error: "The database did not return an accepted manifest receipt." }, 409);
    }
    const required = ["runId", "runKey", "sourceManifestSha256", "manifestSha256", "registeredChunkCount", "expectedChunkCount", "receivedEntryCount", "expectedEntryCount", "receivedPackageCount", "expectedPackageCount", "manifestState"];
    if (required.some((field) => !Object.hasOwn(receipt, field))) return response({ error: "The database returned an incomplete manifest receipt." }, 503);
    return response(receipt, receipt.outcome === "chunk_registered" ? 201 : 200);
  } catch {
    return response({ error: "The run manifest could not be registered." }, 503);
  }
}
