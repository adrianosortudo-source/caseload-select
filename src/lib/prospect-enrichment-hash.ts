import { createHash } from "node:crypto";

export type ProspectEnrichmentJsonValue =
  | null
  | boolean
  | number
  | string
  | ProspectEnrichmentJsonValue[]
  | { [key: string]: ProspectEnrichmentJsonValue };

/** Stable JSON used by the prospect-enrichment/v1 protocol. */
export function stableProspectEnrichmentJson(value: unknown): string {
  const ancestors = new Set<object>();

  const visit = (item: unknown, path: string): string => {
    if (item === null || typeof item === "string" || typeof item === "boolean") {
      return JSON.stringify(item);
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError(`${path} must be a finite JSON number`);
      return JSON.stringify(item);
    }
    if (Array.isArray(item)) {
      if (ancestors.has(item)) throw new TypeError(`${path} contains a cycle`);
      ancestors.add(item);
      const output = `[${item.map((child, index) => {
        if (!(index in item)) throw new TypeError(`${path}[${index}] is a sparse array entry`);
        return visit(child, `${path}[${index}]`);
      }).join(",")}]`;
      ancestors.delete(item);
      return output;
    }
    if (typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
        throw new TypeError(`${path} must be a plain JSON object`);
      }
      if (ancestors.has(item)) throw new TypeError(`${path} contains a cycle`);
      ancestors.add(item);
      const keys = Object.keys(record).sort();
      const output = `{${keys.map((key) => {
        if (record[key] === undefined) throw new TypeError(`${path}.${key} is not JSON serializable`);
        return `${JSON.stringify(key)}:${visit(record[key], `${path}.${key}`)}`;
      }).join(",")}}`;
      ancestors.delete(item);
      return output;
    }
    throw new TypeError(`${path} is not a JSON value`);
  };

  return visit(value, "value");
}

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
