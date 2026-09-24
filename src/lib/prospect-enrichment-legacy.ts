import { prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";
import type { JsonValue } from "@/lib/prospect-enrichment-contract";

export type EvidenceDate = Readonly<{ observedAt: string | null; observedOn: string | null; precision: "exact_time" | "date_only" | "unknown" | "legacy_unknown" }>;
export type LegacyEvidenceProjection = Readonly<{ parentTable: "gta_prospect_qualification_assessments"; parentId: string; selector: string; value: JsonValue; semanticSha256: string; disposition: "retain_only"; reason: "already_preserved_in_linked_legacy_assessment" }>;

export function isEvidenceObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Own-property JSON pointers preserve absent, null, false and empty values. */
export function readEvidenceJsonPointer(value: unknown, pointer: string): { found: boolean; value?: unknown } {
  if (pointer === "") return { found: true, value };
  if (!pointer.startsWith("/")) return { found: false };
  let current = value;
  for (const encoded of pointer.slice(1).split("/")) {
    if (/~(?:[^01]|$)/.test(encoded)) return { found: false };
    const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if (["__proto__", "prototype", "constructor"].includes(key)) return { found: false };
    if (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/.test(key)) return { found: false };
    if (current === null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, key)) return { found: false };
    current = (current as Record<string, unknown>)[key];
  }
  return { found: true, value: current };
}

export function projectLegacyCriteria(parentId: string, criteria: JsonValue): readonly LegacyEvidenceProjection[] {
  if (!isEvidenceObject(criteria)) return [];
  return Object.keys(criteria).sort().map((key) => {
    const selector = `/criteria/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    const value = criteria[key] as JsonValue;
    return { parentTable: "gta_prospect_qualification_assessments", parentId, selector, value,
      semanticSha256: prospectEnrichmentProtocolHash({ parentTable: "gta_prospect_qualification_assessments", parentId, selector, value }),
      disposition: "retain_only", reason: "already_preserved_in_linked_legacy_assessment" };
  });
}

export function evidenceDate(row: Readonly<Record<string, unknown>>): EvidenceDate {
  const text = (value: unknown) => typeof value === "string" && value.length > 0 ? value : null;
  const precision = row.source_observed_precision;
  const observedOn = text(row.source_observed_on) ?? text(row.observed_on) ?? text(row.assessed_on);
  const observedAt = text(row.observed_at) ?? text(row.decided_at);
  if (precision === "unknown") return { observedAt: null, observedOn: null, precision };
  if (precision === "date_only") return { observedAt: null, observedOn, precision };
  if (precision === "exact_time") return { observedAt, observedOn, precision };
  return { observedAt, observedOn, precision: observedOn && !observedAt ? "date_only" : "legacy_unknown" };
}

export function evidenceDateLabel(date: EvidenceDate): string {
  const input = date.precision === "exact_time" ? date.observedAt : date.observedOn ?? date.observedAt;
  if (!input) return "Observation date not recorded";
  const parsed = new Date(input.length === 10 ? `${input}T00:00:00Z` : input);
  if (!Number.isFinite(parsed.getTime())) return "Observation date not recorded";
  const day = new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
  if (date.precision !== "exact_time") return `Observed ${day}`;
  return `Observed ${day} at ${new Intl.DateTimeFormat("en-CA", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(parsed)} UTC`;
}

export function evidenceRefreshState(date: EvidenceDate, thresholdDays: number, now = new Date()): "current" | "refresh_recommended" | "unknown" {
  const value = date.observedOn ?? date.observedAt;
  if (!value) return "unknown";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(parsed.getTime())) return "unknown";
  return now.getTime() - parsed.getTime() > thresholdDays * 86_400_000 ? "refresh_recommended" : "current";
}

export function qualificationDisplayCategory(status: unknown): string {
  const categories: Record<string, string> = { qualified: "Qualified", selected: "Selected", "eligible-not-selected": "Eligible, not selected", needs_evidence: "Incomplete", verification_required: "Incomplete", "verification-required": "Incomplete", disqualified: "Disqualified for this cohort", "policy-hold": "Policy hold", "technical-hold": "Technical hold" };
  return typeof status === "string" ? categories[status] ?? "Unclassified historical decision" : "Not assessed";
}

export function safeEvidenceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? value : null; }
  catch { return null; }
}
