import { decodeOriginalJsonNodes } from "./prospect-enrichment-original-nodes";
import { stableProspectEnrichmentJson, type ProspectEnrichmentJsonValue } from "./prospect-enrichment-json";

const SHA = /^[a-f0-9]{64}$/;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
async function digest(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 2_097_152) throw new Error("Original evidence exceeds the supported display bound.");
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function boundedTransport(value: unknown): void {
  const stack = [{ value, depth: 0 }]; let visited = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++visited > 200_000 || item.depth > 12) throw new Error("Original evidence transport is invalid.");
    if (item.value === null || typeof item.value === "boolean") continue;
    if (typeof item.value === "number" && Number.isFinite(item.value)) continue;
    if (typeof item.value === "string" && new TextEncoder().encode(item.value).length <= 65_536) continue;
    if (!record(item.value) && !Array.isArray(item.value)) throw new Error("Original evidence transport is invalid.");
    for (const child of Object.values(item.value)) stack.push({ value: child, depth: item.depth + 1 });
  }
}

/** Explicit v2 only. Source content remains data; both independent evidence hashes must match. */
export async function verifyBoundedOriginalForDisplay(value: unknown, expectedEnvelopeSha256?: string): Promise<{
  content: ProspectEnrichmentJsonValue; logicalEnvelope: Record<string, unknown>;
}> {
  if (!record(value) || value.schemaVersion !== "prospect-enrichment/v2" || !record(value.originalResearch)) throw new Error("Original evidence version is unsupported.");
  const original = value.originalResearch;
  if (typeof original.contentSha256 !== "string" || !SHA.test(original.contentSha256) ||
      typeof original.representationSha256 !== "string" || !SHA.test(original.representationSha256)) throw new Error("Original evidence hashes are missing.");
  // Validate the shallow node document before serializing anything for hashing.
  const content = decodeOriginalJsonNodes(original.content);
  if (expectedEnvelopeSha256 !== undefined) {
    if (typeof expectedEnvelopeSha256 !== "string" || !SHA.test(expectedEnvelopeSha256)) throw new Error("Retained envelope hash is invalid.");
    boundedTransport(value);
  }
  const checks = [digest(stableProspectEnrichmentJson(original.content)), digest(stableProspectEnrichmentJson(content))];
  if (expectedEnvelopeSha256 !== undefined) checks.push(digest(stableProspectEnrichmentJson(value)));
  const [representationHash, originalHash, envelopeHash] = await Promise.all(checks);
  if (representationHash !== original.representationSha256 || originalHash !== original.contentSha256 ||
      (expectedEnvelopeSha256 !== undefined && envelopeHash !== expectedEnvelopeSha256)) throw new Error("Original evidence verification failed.");
  return { content, logicalEnvelope: { ...value, originalResearch: { ...original, content } } };
}
