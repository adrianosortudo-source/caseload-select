import { decodeOriginalJsonNodes, encodeOriginalJsonNodes, type OriginalNodeDocument } from "./prospect-enrichment-original-nodes";
import { prospectEnrichmentProtocolHash, stableProspectEnrichmentJson, type ProspectEnrichmentJsonValue } from "./prospect-enrichment-hash";
import type { ProspectEnrichmentEnvelope } from "./prospect-enrichment-contract";
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function databaseStringSupported(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
/** Returns logical original evidence while keeping the submitted transport immutable. */
export function readProspectOriginalContent(value: { schemaVersion: unknown; originalResearch: unknown }): ProspectEnrichmentJsonValue {
  if (!record(value.originalResearch) || !digest(value.originalResearch.contentSha256)) throw Error("original_research_hash_invalid");
  const research = value.originalResearch;
  let content: unknown;
  if (value.schemaVersion === "prospect-enrichment/v1") content = research.content;
  else if (value.schemaVersion === "prospect-enrichment/v2") {
    // Validate the bounded shape before hashing any untrusted representation.
    content = decodeOriginalJsonNodes(research.content);
    const nodes = (research.content as OriginalNodeDocument).nodes;
    for (const node of nodes) {
      if (node.pointer !== "" && node.pointer.slice(1).split("/").length + 2 > 32) throw Error("original_research_logical_depth_unsupported");
      const strings = [node.pointer, ...(typeof node.value === "string" ? [node.value] : Array.isArray(node.value) ? node.value : [])];
      if (strings.some(value => !databaseStringSupported(value))) throw Error("original_research_unicode_not_supported_by_database");
    }
    if (!digest(research.representationSha256) || prospectEnrichmentProtocolHash(research.content) !== research.representationSha256) throw Error("original_research_representation_hash_mismatch");
  } else throw Error("original_research_version_unsupported");
  if (prospectEnrichmentProtocolHash(content) !== research.contentSha256) throw Error("original_research_content_hash_mismatch");
  return content as ProspectEnrichmentJsonValue;
}

/** Explicit opt-in; changing transport changes the package payload hash and needs a separately approved derived run. */
export function encodeBoundedProspectEnvelope(envelope: ProspectEnrichmentEnvelope): ProspectEnrichmentEnvelope {
  if (envelope.schemaVersion !== "prospect-enrichment/v1") throw Error("original_research_already_encoded");
  const original = readProspectOriginalContent(envelope);
  const representation = encodeOriginalJsonNodes(original);
  return {
    ...envelope,
    schemaVersion: "prospect-enrichment/v2",
    originalResearch: {
      ...envelope.originalResearch,
      content: JSON.parse(stableProspectEnrichmentJson(representation)) as ProspectEnrichmentJsonValue,
      representationSha256: prospectEnrichmentProtocolHash(representation),
    },
  };
}
