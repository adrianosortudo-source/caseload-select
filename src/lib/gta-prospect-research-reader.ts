import "server-only";

import type { EvidenceAvailability, PublicProspectContact, ReconciledGtaProspect, ReconciliationStatus } from "@/lib/gta-prospect-records";

const RPC_NAME = "list_gta_prospect_research_with_contacts_for_operator";
const LEGACY_RPC_NAME = "list_gta_prospect_research_for_operator";
const reconciliationStatuses = new Set<ReconciliationStatus>([
  "provisional_new",
  "update_existing",
  "new_pending_identity",
  "duplicate",
  "unresolved",
]);
const evidenceAvailability = new Set<EvidenceAvailability>(["observed", "unknown"]);

type RpcError = { code?: string; message?: string; details?: string | null; hint?: string | null };
export type GtaProspectResearchReaderClient = {
  rpc: (functionName: string) => Promise<{ data: unknown; error: RpcError | null }>;
};

export class GtaProspectLedgerUnavailableError extends Error {
  constructor() {
    super("The GTA prospect research read projection is not available yet.");
    this.name = "GtaProspectLedgerUnavailableError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isHttpUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parsePublicContacts(value: unknown): readonly PublicProspectContact[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw projectionError("public_contacts is invalid");
  const relationships = new Set<PublicProspectContact["relationship"]>(["owner", "founder", "principal", "named_lawyer", "firm_inbox"]);
  const emailKinds = new Set<PublicProspectContact["emailKind"]>(["owner", "named_person", "general_firm"]);
  return value.map((entry) => {
    if (!isObject(entry) || !isNullableString(entry.name) || !isNullableString(entry.email)
      || typeof entry.relationship !== "string" || !relationships.has(entry.relationship as PublicProspectContact["relationship"])
      || typeof entry.email_kind !== "string" || !emailKinds.has(entry.email_kind as PublicProspectContact["emailKind"])
      || !isHttpUrl(entry.source_url) || !isIsoDate(entry.observed_at)) throw projectionError("public contact is invalid");
    if (entry.name === null && entry.email === null) throw projectionError("public contact has no name or email");
    return {
      name: entry.name,
      relationship: entry.relationship as PublicProspectContact["relationship"],
      email: entry.email,
      emailKind: entry.email_kind as PublicProspectContact["emailKind"],
      sourceUrl: entry.source_url,
      observedAt: entry.observed_at,
    };
  });
}

function projectionError(message: string): Error {
  return new Error(`Invalid GTA prospect research projection: ${message}`);
}

function parseRecord(value: unknown): ReconciledGtaProspect {
  if (!isObject(value)) throw projectionError("row is not an object");
  const expectedKeys = [
    "id", "firm_name", "city", "office_cities", "website_url", "practice_areas",
    "observed_lawyer_count", "observed_lawyer_count_qualifier", "observed_lawyer_count_display",
    "roster_source_url", "roster_checked_at", "reconciliation_status", "legacy_cluster_lawyer_count",
    "legacy_crosswalk", "reconciliation_note", "advertising_evidence", "advertising_source_url",
    "gbp_evidence", "gbp_source_url",
  ];
  const unexpected = Object.keys(value).filter((key) => ![...expectedKeys, "public_contacts"].includes(key));
  if (unexpected.length > 0) throw projectionError(`unexpected column(s): ${unexpected.join(", ")}`);
  const officeCities = value.office_cities;
  const practiceAreas = value.practice_areas;
  const observedLawyerCount = value.observed_lawyer_count;
  const legacyClusterLawyerCount = value.legacy_cluster_lawyer_count;
  const publicContacts = parsePublicContacts(value.public_contacts);

  if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,159}$/.test(value.id)) throw projectionError("id is invalid");
  if (typeof value.firm_name !== "string" || value.firm_name.trim() === "") throw projectionError("firm_name is invalid");
  if (typeof value.city !== "string" || value.city.trim() === "") throw projectionError("city is invalid");
  if (!Array.isArray(officeCities) || officeCities.length === 0 || !officeCities.every((city) => typeof city === "string" && city.trim() !== "")) throw projectionError("office_cities is invalid");
  if (!Array.isArray(practiceAreas) || !practiceAreas.every((area) => typeof area === "string" && area.trim() !== "")) throw projectionError("practice_areas is invalid");
  if (!isHttpUrl(value.website_url) || !isHttpUrl(value.roster_source_url) || typeof value.roster_source_url !== "string") throw projectionError("website or roster URL is invalid");
  if (!isIsoDate(value.roster_checked_at)) throw projectionError("roster_checked_at is invalid");
  if (!isNullableNonNegativeInteger(observedLawyerCount)) throw projectionError("observed_lawyer_count is invalid");
  if (value.observed_lawyer_count_qualifier !== "exact" && value.observed_lawyer_count_qualifier !== "at_least" && value.observed_lawyer_count_qualifier !== "unknown") throw projectionError("observed_lawyer_count_qualifier is invalid");
  if ((value.observed_lawyer_count_qualifier === "unknown") !== (observedLawyerCount === null)) throw projectionError("count qualifier and count disagree");
  if (!isNullableString(value.observed_lawyer_count_display) || !isNullableString(value.legacy_crosswalk) || !isNullableString(value.reconciliation_note)) throw projectionError("a nullable text field is invalid");
  if (!isNullableNonNegativeInteger(legacyClusterLawyerCount)) throw projectionError("legacy_cluster_lawyer_count is invalid");
  if (typeof value.reconciliation_status !== "string" || !reconciliationStatuses.has(value.reconciliation_status as ReconciliationStatus)) throw projectionError("reconciliation_status is invalid");
  if (typeof value.advertising_evidence !== "string" || !evidenceAvailability.has(value.advertising_evidence as EvidenceAvailability) || !isHttpUrl(value.advertising_source_url)) throw projectionError("advertising evidence is invalid");
  if (typeof value.gbp_evidence !== "string" || !evidenceAvailability.has(value.gbp_evidence as EvidenceAvailability) || !isHttpUrl(value.gbp_source_url)) throw projectionError("GBP evidence is invalid");
  if (value.advertising_evidence === "observed" && value.advertising_source_url === null) throw projectionError("observed advertising has no source URL");
  if (value.gbp_evidence === "observed" && value.gbp_source_url === null) throw projectionError("observed GBP has no source URL");

  return {
    id: value.id,
    recordOrigin: "research_ledger",
    firmName: value.firm_name,
    city: value.city,
    officeCities,
    websiteUrl: value.website_url,
    practiceAreas,
    observedLawyerCount,
    observedLawyerCountQualifier: value.observed_lawyer_count_qualifier,
    observedLawyerCountDisplay: value.observed_lawyer_count_display,
    rosterSourceUrl: value.roster_source_url,
    rosterCheckedAt: value.roster_checked_at,
    reconciliationStatus: value.reconciliation_status as ReconciliationStatus,
    legacyClusterLawyerCount,
    legacyCrosswalk: value.legacy_crosswalk,
    reconciliationNote: value.reconciliation_note,
    advertisingEvidence: value.advertising_evidence as EvidenceAvailability,
    advertisingSourceUrl: value.advertising_source_url,
    gbpEvidence: value.gbp_evidence as EvidenceAvailability,
    gbpSourceUrl: value.gbp_source_url,
    publicContacts,
  };
}

function isMissingProjectionRpc(error: RpcError, rpcName = RPC_NAME): boolean {
  const text = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
  return error.code === "PGRST202"
    || error.code === "42883"
    || text.includes(`function public.${rpcName} does not exist`)
    || text.includes(`could not find the function public.${rpcName}`);
}

export async function listGtaProspectResearchForOperator(
  client?: GtaProspectResearchReaderClient,
): Promise<readonly ReconciledGtaProspect[]> {
  const reader = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectResearchReaderClient;
  })();
  let { data, error } = await reader.rpc(RPC_NAME);
  if (error && isMissingProjectionRpc(error)) ({ data, error } = await reader.rpc(LEGACY_RPC_NAME));
  if (error) {
    if (isMissingProjectionRpc(error, LEGACY_RPC_NAME)) throw new GtaProspectLedgerUnavailableError();
    throw new Error(`Could not read the GTA prospect research ledger: ${error.message ?? "unknown database error"}`);
  }
  if (!Array.isArray(data)) throw projectionError("RPC did not return an array");
  const records = data.map(parseRecord);
  if (new Set(records.map((record) => record.id)).size !== records.length) throw projectionError("duplicate source record keys");
  return records;
}
