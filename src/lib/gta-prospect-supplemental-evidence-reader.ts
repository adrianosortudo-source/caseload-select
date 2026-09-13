import "server-only";

const RPC_NAME = "list_gta_prospect_supplemental_evidence_for_operator";
const sourceKey = /^[a-z0-9][a-z0-9-]{1,159}$/;
const stableFirmId = /^FIRM-[0-9A-HJKMNP-TV-Z]{26}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

type RpcError = { code?: string; message?: string; details?: string | null; hint?: string | null };
export type GtaProspectSupplementalEvidenceReaderClient = {
  rpc: (functionName: string) => Promise<{ data: unknown; error: RpcError | null }>;
};

export type GtaProspectSupplementalEvidenceSummary = Readonly<{
  sourceRecordKey: string;
  firmId: string | null;
  canonicalDomain: string | null;
  identity: { matchState: "confirmed" | "unresolved" | "distinct"; observedOn: string; confidence: "high" | "moderate" | "unknown" } | null;
  websiteIntake: { channels: readonly string[]; opportunityState: "supported" | "not_established"; observedOn: string } | null;
  qualification: { state: "qualified" | "needs_evidence" | "disqualified"; cohort: string; assessedOn: string; criteria: Readonly<Record<string, boolean>> } | null;
}>;

export class GtaProspectSupplementalEvidenceLedgerUnavailableError extends Error {
  constructor() { super("The GTA prospect supplemental evidence projection is not available yet."); this.name = "GtaProspectSupplementalEvidenceLedgerUnavailableError"; }
}

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function absent(value: unknown): value is null { return value === null; }
function error(message: string): Error { return new Error(`Invalid GTA prospect supplemental evidence projection: ${message}`); }
function missingProjection(errorValue: RpcError): boolean {
  const text = [errorValue.code, errorValue.message, errorValue.details, errorValue.hint].filter(Boolean).join(" ").toLowerCase();
  return errorValue.code === "PGRST202" || errorValue.code === "42883" || text.includes(`function public.${RPC_NAME} does not exist`) || text.includes(`could not find the function public.${RPC_NAME}`);
}
function textArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw error("website_intake_channels is invalid");
  return Object.freeze([...new Set(value.map((item) => item.trim()))]);
}
function criteria(value: unknown): Readonly<Record<string, boolean>> {
  if (!object(value) || Object.values(value).some((item) => typeof item !== "boolean")) throw error("qualification_criteria is invalid");
  return Object.freeze({ ...value } as Record<string, boolean>);
}
function row(value: unknown): GtaProspectSupplementalEvidenceSummary {
  if (!object(value)) throw error("row is not an object");
  const keys = ["source_record_key", "firm_id", "canonical_domain", "identity_match_state", "identity_observed_on", "identity_confidence", "website_intake_channels", "website_opportunity_state", "website_observed_on", "qualification_state", "qualification_cohort", "qualification_assessed_on", "qualification_criteria"];
  const unexpected = Object.keys(value).filter((key) => !keys.includes(key));
  if (unexpected.length) throw error(`unexpected column(s): ${unexpected.join(", ")}`);
  if (typeof value.source_record_key !== "string" || !sourceKey.test(value.source_record_key)) throw error("source_record_key is invalid");
  if (!absent(value.firm_id) && (typeof value.firm_id !== "string" || !stableFirmId.test(value.firm_id))) throw error("firm_id is invalid");
  if (!absent(value.canonical_domain) && (typeof value.canonical_domain !== "string" || !value.canonical_domain.trim())) throw error("canonical_domain is invalid");
  const identityEmpty = absent(value.identity_match_state) && absent(value.identity_observed_on) && absent(value.identity_confidence);
  const identityFull = (value.identity_match_state === "confirmed" || value.identity_match_state === "unresolved" || value.identity_match_state === "distinct") && typeof value.identity_observed_on === "string" && isoDate.test(value.identity_observed_on) && (value.identity_confidence === "high" || value.identity_confidence === "moderate" || value.identity_confidence === "unknown");
  if (!identityEmpty && !identityFull) throw error("identity summary is incomplete");
  if (value.identity_match_state === "confirmed" && value.firm_id === null) throw error("confirmed identity has no stable firm_id");
  const websiteEmpty = absent(value.website_intake_channels) && absent(value.website_opportunity_state) && absent(value.website_observed_on);
  const websiteFull = (value.website_opportunity_state === "supported" || value.website_opportunity_state === "not_established") && typeof value.website_observed_on === "string" && isoDate.test(value.website_observed_on);
  if (!websiteEmpty && !websiteFull) throw error("website intake summary is incomplete");
  const qualificationEmpty = absent(value.qualification_state) && absent(value.qualification_cohort) && absent(value.qualification_assessed_on) && absent(value.qualification_criteria);
  const qualificationFull = (value.qualification_state === "qualified" || value.qualification_state === "needs_evidence" || value.qualification_state === "disqualified") && typeof value.qualification_cohort === "string" && Boolean(value.qualification_cohort.trim()) && typeof value.qualification_assessed_on === "string" && isoDate.test(value.qualification_assessed_on);
  if (!qualificationEmpty && !qualificationFull) throw error("qualification summary is incomplete");
  return {
    sourceRecordKey: value.source_record_key,
    firmId: value.firm_id as string | null,
    canonicalDomain: value.canonical_domain as string | null,
    identity: identityFull ? { matchState: value.identity_match_state as "confirmed" | "unresolved" | "distinct", observedOn: value.identity_observed_on as string, confidence: value.identity_confidence as "high" | "moderate" | "unknown" } : null,
    websiteIntake: websiteFull ? { channels: textArray(value.website_intake_channels), opportunityState: value.website_opportunity_state as "supported" | "not_established", observedOn: value.website_observed_on as string } : null,
    qualification: qualificationFull ? { state: value.qualification_state as "qualified" | "needs_evidence" | "disqualified", cohort: (value.qualification_cohort as string).trim(), assessedOn: value.qualification_assessed_on as string, criteria: criteria(value.qualification_criteria) } : null,
  };
}

export async function listGtaProspectSupplementalEvidenceForOperator(client?: GtaProspectSupplementalEvidenceReaderClient): Promise<readonly GtaProspectSupplementalEvidenceSummary[]> {
  const reader = client ?? await (async () => { const { supabaseAdmin } = await import("@/lib/supabase-admin"); return supabaseAdmin as unknown as GtaProspectSupplementalEvidenceReaderClient; })();
  const result = await reader.rpc(RPC_NAME);
  if (result.error) { if (missingProjection(result.error)) throw new GtaProspectSupplementalEvidenceLedgerUnavailableError(); throw new Error(`Could not read GTA prospect supplemental evidence: ${result.error.message ?? "unknown database error"}`); }
  if (!Array.isArray(result.data)) throw error("RPC did not return an array");
  const records = result.data.map(row);
  if (new Set(records.map((record) => record.sourceRecordKey)).size !== records.length) throw error("duplicate source record keys");
  return records;
}
