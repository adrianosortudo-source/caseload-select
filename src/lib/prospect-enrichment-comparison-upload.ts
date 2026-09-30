import { stableProspectEnrichmentJson } from "./prospect-enrichment-json";

export type ResearchComparisonMode = "bootstrap" | "finalized";
const MIB = 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;

export function researchComparisonEndpoint(mode: ResearchComparisonMode): string {
  return mode === "bootstrap" ? "/api/admin/prospect-enrichment/comparison-export/bootstrap" : "/api/admin/prospect-enrichment/comparison-export";
}

async function boundedText(stream: ReadableStream<Uint8Array>, limit: number): Promise<string> {
  const reader = stream.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw new Error("The decoded private comparison request exceeds its size limit.");
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export async function prepareResearchComparisonUpload(file: Blob & { name: string }, sourceRunKey?: string) {
  const gzip = file.name.toLowerCase().endsWith(".json.gz");
  if (!gzip && !file.name.toLowerCase().endsWith(".json")) throw new Error("Choose a private comparison request JSON or JSON.gz file.");
  if (file.size > (gzip ? 4 : 16) * MIB) throw new Error(gzip ? "The compressed private comparison request is larger than 4 MB." : "The private comparison request is larger than 16 MB.");
  if (gzip && typeof DecompressionStream === "undefined") throw new Error("This browser cannot open gzip requests. Use the uncompressed JSON request within the 16 MB limit.");
  const text = await boundedText(gzip ? file.stream().pipeThrough(new DecompressionStream("gzip")) : file.stream(), (gzip ? 32 : 16) * MIB);
  let request: { schemaVersion?: unknown; manifest?: { runId?: unknown }; packages?: unknown };
  try { request = JSON.parse(text); } catch { throw new Error("The private comparison request is not valid JSON."); }
  if (!request || request.schemaVersion !== "prospect-enrichment-comparison-request/v1" || typeof request.manifest?.runId !== "string" || !request.manifest.runId.trim() || !Array.isArray(request.packages) || (sourceRunKey !== undefined && request.manifest.runId !== sourceRunKey)) throw new Error("Choose the complete comparison request for this exact run.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableProspectEnrichmentJson(request)));
  const requestSha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return { runId: request.manifest.runId, requestSha256, body: gzip ? file : text, headers: { "Content-Type": "application/json", ...(gzip ? { "Content-Encoding": "gzip" } : {}) } };
}

export function verifyResearchComparisonResponse(result: Record<string, unknown>, mode: ResearchComparisonMode, requestSha256: string): void {
  const signature = result.signature as { algorithm?: unknown; keyId?: unknown; signatureBase64?: unknown } | undefined;
  const provenance = result.provenance as { reader?: unknown; operatorAuthenticated?: unknown; sourceArtifactSha256?: unknown } | undefined;
  const readers = mode === "bootstrap" ? ["admin-prospect-enrichment-bootstrap/v1", "admin-prospect-enrichment-bootstrap-resume/v1"] : ["admin-prospect-enrichment-comparison/v1"];
  if (result.schemaVersion !== "prospect-enrichment-comparison/v1" || result.projectId !== "ssxryjxifwiivghglqer" || !HASH.test(String(result.snapshotSha256)) || signature?.algorithm !== "Ed25519" || typeof signature.keyId !== "string" || !signature.keyId || typeof signature.signatureBase64 !== "string" || !signature.signatureBase64 || provenance?.operatorAuthenticated !== true || !readers.includes(String(provenance.reader)) || !HASH.test(requestSha256) || provenance.sourceArtifactSha256 !== requestSha256 || typeof result.capturedAt !== "string" || !Number.isFinite(Date.parse(result.capturedAt)) || !Array.isArray(result.identities) || !Array.isArray(result.events) || !Array.isArray(result.packages) || (mode === "bootstrap" && result.packages.length !== 0)) throw new Error("Admin returned an incomplete, unsigned or unexpected comparison snapshot.");
}
