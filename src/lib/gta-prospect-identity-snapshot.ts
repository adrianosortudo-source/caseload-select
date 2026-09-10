import { createHash } from "node:crypto";

import { normalizeFirmDomain } from "@/lib/firm-identity-reconciliation";
import { normalizeProspectFirmName } from "@/lib/gta-prospect-baseline-reconciliation";
import type { ReconciledGtaProspect } from "@/lib/gta-prospect-records";

export const GTA_PROSPECT_IDENTITY_SNAPSHOT_SCHEMA = "gta-operator-identity-snapshot.v1" as const;
export const GTA_PROSPECT_IDENTITY_SNAPSHOT_SOURCE = "gta_prospect_research_operator_projection" as const;
export const GTA_PROSPECT_SAFE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,159}$/;

export type GtaProspectIdentitySnapshotRecord = Readonly<{
  record_id: string;
  normalized_firm_name: string;
  canonical_domain: string | null;
}>;

export type GtaProspectIdentitySnapshot = Readonly<{
  schema_version: typeof GTA_PROSPECT_IDENTITY_SNAPSHOT_SCHEMA;
  source: typeof GTA_PROSPECT_IDENTITY_SNAPSHOT_SOURCE;
  generated_at: string;
  generated_on: string;
  record_count: number;
  records_sha256: string;
  records: readonly GtaProspectIdentitySnapshotRecord[];
}>;

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], context: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${context} schema drift: ${actual.join(",")}`);
}

export function gtaProspectIdentityRecordsSha256(records: readonly GtaProspectIdentitySnapshotRecord[]): string {
  return createHash("sha256").update(JSON.stringify(records), "utf8").digest("hex");
}

export function buildGtaProspectIdentitySnapshot(
  records: readonly ReconciledGtaProspect[],
  generatedAt = new Date(),
): GtaProspectIdentitySnapshot {
  const sanitized = records.map((record): GtaProspectIdentitySnapshotRecord => {
    const normalizedName = normalizeProspectFirmName(record.firmName);
    if (!GTA_PROSPECT_SAFE_SLUG_PATTERN.test(record.id) || !normalizedName) throw new Error("Operator identity projection contains an invalid identity.");
    return {
      record_id: record.id,
      normalized_firm_name: normalizedName,
      canonical_domain: normalizeFirmDomain(record.canonicalDomain ?? record.websiteUrl ?? record.rosterSourceUrl),
    };
  }).sort((left, right) => left.record_id.localeCompare(right.record_id, "en-CA"));
  if (sanitized.length === 0) throw new Error("Operator identity projection is empty.");
  if (new Set(sanitized.map((record) => record.record_id)).size !== sanitized.length) throw new Error("Operator identity projection contains duplicate record ids.");
  const generated_at = generatedAt.toISOString();
  return Object.freeze({
    schema_version: GTA_PROSPECT_IDENTITY_SNAPSHOT_SCHEMA,
    source: GTA_PROSPECT_IDENTITY_SNAPSHOT_SOURCE,
    generated_at,
    generated_on: generated_at.slice(0, 10),
    record_count: sanitized.length,
    records_sha256: gtaProspectIdentityRecordsSha256(sanitized),
    records: Object.freeze(sanitized.map((record) => Object.freeze(record))),
  }) as GtaProspectIdentitySnapshot;
}

export function parseGtaProspectIdentitySnapshot(
  value: unknown,
  options: Readonly<{ expectedCount: number; now?: Date; maxAgeHours?: number }>,
): GtaProspectIdentitySnapshot {
  const root = object(value, "Identity snapshot is missing or invalid.");
  exactKeys(root, ["schema_version", "source", "generated_at", "generated_on", "record_count", "records_sha256", "records"], "Identity snapshot");
  if (root.schema_version !== GTA_PROSPECT_IDENTITY_SNAPSHOT_SCHEMA || root.source !== GTA_PROSPECT_IDENTITY_SNAPSHOT_SOURCE) {
    throw new Error("Identity snapshot schema or source is unsupported.");
  }
  if (!Number.isInteger(options.expectedCount) || options.expectedCount <= 0) throw new Error("Expected count must be a positive integer.");
  if (!Array.isArray(root.records)) throw new Error("Identity snapshot records are missing.");
  if (root.record_count !== root.records.length || root.record_count !== options.expectedCount) throw new Error("Identity snapshot record count mismatch.");
  const records = root.records.map((entry): GtaProspectIdentitySnapshotRecord => {
    const record = object(entry, "Identity snapshot record is invalid.");
    exactKeys(record, ["record_id", "normalized_firm_name", "canonical_domain"], "Identity snapshot record");
    if (typeof record.record_id !== "string" || !GTA_PROSPECT_SAFE_SLUG_PATTERN.test(record.record_id)) throw new Error("Identity snapshot record id is invalid.");
    if (typeof record.normalized_firm_name !== "string" || normalizeProspectFirmName(record.normalized_firm_name) !== record.normalized_firm_name) throw new Error("Identity snapshot firm name is not normalized.");
    if (record.canonical_domain !== null && (typeof record.canonical_domain !== "string" || normalizeFirmDomain(record.canonical_domain) !== record.canonical_domain)) throw new Error("Identity snapshot domain is not canonical.");
    return { record_id: record.record_id, normalized_firm_name: record.normalized_firm_name, canonical_domain: record.canonical_domain as string | null };
  });
  if (new Set(records.map((record) => record.record_id)).size !== records.length) throw new Error("Identity snapshot has duplicate record ids.");
  const sortedIds = records.map((record) => record.record_id).sort((left, right) => left.localeCompare(right, "en-CA"));
  if (JSON.stringify(sortedIds) !== JSON.stringify(records.map((record) => record.record_id))) throw new Error("Identity snapshot records are not deterministically sorted.");
  if (typeof root.records_sha256 !== "string" || root.records_sha256 !== gtaProspectIdentityRecordsSha256(records)) throw new Error("Identity snapshot hash mismatch.");
  if (typeof root.generated_at !== "string" || typeof root.generated_on !== "string") throw new Error("Identity snapshot date is missing.");
  const generated = new Date(root.generated_at);
  if (!Number.isFinite(generated.getTime()) || generated.toISOString() !== root.generated_at || root.generated_on !== root.generated_at.slice(0, 10)) throw new Error("Identity snapshot date is invalid.");
  const now = options.now ?? new Date();
  const age = now.getTime() - generated.getTime();
  const maxAge = (options.maxAgeHours ?? 24) * 60 * 60 * 1000;
  if (age < -5 * 60 * 1000 || age > maxAge) throw new Error("Identity snapshot is stale or from the future.");
  return root as unknown as GtaProspectIdentitySnapshot;
}
