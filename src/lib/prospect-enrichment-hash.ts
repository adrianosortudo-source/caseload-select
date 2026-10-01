import { createHash } from "node:crypto";

import { stableProspectEnrichmentJson, type ProspectEnrichmentJsonValue } from "./prospect-enrichment-json";
export { stableProspectEnrichmentJson, type ProspectEnrichmentJsonValue } from "./prospect-enrichment-json";

export function prospectEnrichmentSha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function prospectEnrichmentProtocolHash(value: unknown): string {
  return prospectEnrichmentSha256(stableProspectEnrichmentJson(value));
}

export function prospectEnrichmentPayloadSha256(envelope: unknown): string {
  return prospectEnrichmentProtocolHash(envelope);
}

export type ProspectEnrichmentSemanticHashInput = Readonly<{
  sourceSystem: string;
  researchKey: string;
  itemKind: string;
  semanticContent: ProspectEnrichmentJsonValue;
}>;

/**
 * Hashes the source identity and evidence meaning, deliberately excluding
 * enclosing package IDs, file pointers, wrapper timestamps and resolved DB IDs.
 */
export function prospectEnrichmentSemanticSha256(input: ProspectEnrichmentSemanticHashInput): string {
  return prospectEnrichmentProtocolHash({
    itemKind: input.itemKind,
    researchKey: input.researchKey,
    semanticContent: input.semanticContent,
    sourceSystem: input.sourceSystem,
  });
}

export function prospectEnrichmentSourceEventKey(itemKind: string, researchKey: string, clientItemId: string): string {
  return `${itemKind}:${prospectEnrichmentProtocolHash([researchKey, clientItemId])}`;
}

export function prospectEnrichmentIdempotencyKey(sourceSystem: string, runId: string, packageId: string): string {
  return `pe-v1-${prospectEnrichmentSha256(`${sourceSystem}\n${runId}\n${packageId}`)}`;
}
