import path from "node:path";
import { prospectEnrichmentProtocolHash, prospectEnrichmentSha256, stableProspectEnrichmentJson } from "../../src/lib/prospect-enrichment-hash";

export { prospectEnrichmentProtocolHash as protocolHash, prospectEnrichmentSha256 as sha256, stableProspectEnrichmentJson as canonicalJson };
export const ADAPTER_VERSION = "legacy-prospect-adapter/v1";
export const SOURCE_SYSTEM = "caseload-qualification-legacy-v1";
export const SOURCE_NAME = "prospect-research-backfill";
export const DEFAULT_ROOTS = [
  { id: "root-a", path: String.raw`C:\Users\adria\OneDrive\Documentos\ChatGPT\CaseLoad Select\prospecting\Prospect_Qualification_DB_2026-09-21_v1` },
  { id: "root-b", path: String.raw`D:\00_Work\01_CaseLoad_Select\07_Prospects\Consolidated_Qualification_2026-09-21_v1` },
] as const;
export const DEFAULT_OUTPUT = String.raw`D:\00_Work\01_CaseLoad_Select\07_Prospects\Prospect_Enrichment_Backfill_2026-09-23_v1`;
export type JsonObject = Record<string, unknown>;
export type Issue = { code: string; path: string; reason: string };
export const object = (v: unknown): v is JsonObject => v !== null && typeof v === "object" && !Array.isArray(v);
export const text = (v: unknown): string | null => typeof v === "string" && v.length > 0 ? v : null;
export const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
export const strings = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === "string" && !!x);
export const unique = <T>(v: T[]): T[] => [...new Set(v)];
export const pointerPart = (v: string): string => v.replace(/~/g, "~0").replace(/\//g, "~1");
export const ordinal = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function getPointer(value: unknown, pointer: string): unknown {
  if (!pointer) return value;
  if (!pointer.startsWith("/")) return undefined;
  return pointer.slice(1).split("/").reduce<unknown>((item, key) => {
    const decoded = key.replace(/~1/g, "/").replace(/~0/g, "~");
    return item !== null && typeof item === "object" ? (item as JsonObject)[decoded] : undefined;
  }, value);
}
export function leafPointers(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.length ? value.flatMap((v, i) => leafPointers(v, `${prefix}/${i}`)) : [prefix];
  if (object(value)) return Object.keys(value).length ? Object.entries(value).flatMap(([k, v]) => leafPointers(v, `${prefix}/${pointerPart(k)}`)) : [prefix];
  return [prefix];
}
export function within(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
export function publicUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? value : null; } catch { return null; }
}
export function recordedDate(value: unknown): { observedAt: string | null; observedOn: string | null; missingProvenanceReason: string | null } {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value)
    return { observedAt: null, observedOn: value, missingProvenanceReason: null };
  // Preserve original precision/offset in the raw source; protocol timestamps use UTC.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)))
    return { observedAt: value.endsWith("Z") ? value : new Date(value).toISOString(), observedOn: null, missingProvenanceReason: null };
  return { observedAt: null, observedOn: null, missingProvenanceReason: value == null ? "not_recorded_in_source" : "source_date_not_supported_at_recorded_precision" };
}
export function eventId(prefix: "src" | "obs" | "assess", originalSystem: string, researchKey: string, kind: string, semantic: unknown, originalId?: unknown): string {
  const identity = text(originalId) ? [ADAPTER_VERSION, originalSystem, kind, originalId] : [ADAPTER_VERSION, originalSystem, researchKey, kind, semantic];
  return `${prefix}-${prospectEnrichmentProtocolHash(identity).slice(0, 48)}`;
}
export function displayCategory(status: unknown): "Qualified" | "Held" | "Rejected" | "Incomplete" {
  if (["qualified", "qualified_verified", "selected"].includes(String(status))) return "Qualified";
  if (["held", "policy_hold", "technical_hold", "identity_hold", "qualified_with_exception"].includes(String(status))) return "Held";
  if (["rejected", "disqualified"].includes(String(status))) return "Rejected";
  return "Incomplete";
}
export function selectionDisposition(status: unknown, cohortId: string, explicitSelectionCohort?: unknown): "selected" | "eligible-not-selected" | "verification-required" | "policy-hold" | "technical-hold" | "disqualified" {
  if (["qualified", "qualified_verified"].includes(String(status))) return "eligible-not-selected";
  if (status === "selected") return cohortId !== "legacy-unknown-cohort" && explicitSelectionCohort === cohortId ? "selected" : "eligible-not-selected";
  if (status === "policy_hold" || status === "policy-hold") return "policy-hold";
  if (status === "technical_hold" || status === "technical-hold") return "technical-hold";
  if (status === "rejected" || status === "disqualified") return "disqualified";
  return "verification-required";
}
