import "server-only";

import type {
  OwnerEmailAvailability,
  OwnerRole,
  OwnershipConfidence,
} from "@/lib/gta-prospect-owner-contact-import";

const RPC_NAME = "list_gta_prospect_owner_contacts_for_operator";
const ownerRoles = new Set<OwnerRole>([
  "sole_proprietor", "owner", "founding_partner", "managing_partner", "other_partner",
]);
const ownershipConfidences = new Set<OwnershipConfidence>(["confirmed_owner", "leadership_only"]);
const emailAvailability = new Set<OwnerEmailAvailability>([
  "direct_owner_email", "firm_general_email", "unavailable",
]);

type RpcError = { code?: string; message?: string; details?: string | null; hint?: string | null };
export type GtaProspectOwnerContactReaderClient = {
  rpc: (functionName: string) => Promise<{ data: unknown; error: RpcError | null }>;
};

export type GtaProspectOwnerContactSummary = {
  sourceRecordKey: string;
  ownerName: string;
  ownerRole: OwnerRole;
  ownershipConfidence: OwnershipConfidence;
  ownershipSourceUrl: string;
  ownershipObservedOn: string;
  emailAvailability: OwnerEmailAvailability;
  emailAddress: string | null;
  emailSourceUrl: string | null;
  emailObservedOn: string | null;
  isPrimaryContact: boolean;
};

export class GtaProspectOwnerContactLedgerUnavailableError extends Error {
  constructor() {
    super("The GTA prospect owner-contact read projection is not available yet.");
    this.name = "GtaProspectOwnerContactLedgerUnavailableError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function projectionError(message: string): Error {
  return new Error(`Invalid GTA prospect owner-contact projection: ${message}`);
}

function parseRecord(value: unknown): GtaProspectOwnerContactSummary {
  if (!isObject(value)) throw projectionError("row is not an object");
  const expectedKeys = [
    "source_record_key", "owner_name", "owner_role", "ownership_confidence", "ownership_source_url",
    "ownership_observed_on", "email_availability", "email_address", "email_source_url", "email_observed_on",
    "is_primary_contact",
  ];
  const unexpected = Object.keys(value).filter((key) => !expectedKeys.includes(key));
  if (unexpected.length > 0) throw projectionError(`unexpected column(s): ${unexpected.join(", ")}`);
  if (typeof value.source_record_key !== "string" || !/^[a-z0-9][a-z0-9-]{1,159}$/.test(value.source_record_key)) throw projectionError("source_record_key is invalid");
  if (typeof value.owner_name !== "string" || value.owner_name.trim() === "") throw projectionError("owner_name is invalid");
  if (typeof value.owner_role !== "string" || !ownerRoles.has(value.owner_role as OwnerRole)) throw projectionError("owner_role is invalid");
  if (typeof value.ownership_confidence !== "string" || !ownershipConfidences.has(value.ownership_confidence as OwnershipConfidence)) throw projectionError("ownership_confidence is invalid");
  if (!isHttpUrl(value.ownership_source_url) || !isIsoDate(value.ownership_observed_on)) throw projectionError("ownership evidence is invalid");
  if (typeof value.email_availability !== "string" || !emailAvailability.has(value.email_availability as OwnerEmailAvailability)) throw projectionError("email_availability is invalid");
  const emailAvailable = value.email_availability === "direct_owner_email" || value.email_availability === "firm_general_email";
  if (emailAvailable && (typeof value.email_address !== "string" || !isHttpUrl(value.email_source_url) || !isIsoDate(value.email_observed_on))) {
    throw projectionError("published email evidence is invalid");
  }
  if (!emailAvailable && (value.email_address !== null || value.email_source_url !== null || value.email_observed_on !== null)) {
    throw projectionError("unavailable email must be null");
  }
  if (value.email_availability === "direct_owner_email" && value.ownership_confidence !== "confirmed_owner") {
    throw projectionError("direct owner email requires confirmed ownership");
  }
  if (typeof value.is_primary_contact !== "boolean") throw projectionError("is_primary_contact is invalid");

  return {
    sourceRecordKey: value.source_record_key,
    ownerName: value.owner_name,
    ownerRole: value.owner_role as OwnerRole,
    ownershipConfidence: value.ownership_confidence as OwnershipConfidence,
    ownershipSourceUrl: value.ownership_source_url,
    ownershipObservedOn: value.ownership_observed_on,
    emailAvailability: value.email_availability as OwnerEmailAvailability,
    emailAddress: value.email_address as string | null,
    emailSourceUrl: value.email_source_url as string | null,
    emailObservedOn: value.email_observed_on as string | null,
    isPrimaryContact: value.is_primary_contact,
  };
}

function isMissingProjectionRpc(error: RpcError): boolean {
  const text = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
  return error.code === "PGRST202"
    || error.code === "42883"
    || text.includes(`function public.${RPC_NAME} does not exist`)
    || text.includes(`could not find the function public.${RPC_NAME}`);
}

export async function listGtaProspectOwnerContactsForOperator(
  client?: GtaProspectOwnerContactReaderClient,
): Promise<readonly GtaProspectOwnerContactSummary[]> {
  const reader = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectOwnerContactReaderClient;
  })();
  const { data, error } = await reader.rpc(RPC_NAME);
  if (error) {
    if (isMissingProjectionRpc(error)) throw new GtaProspectOwnerContactLedgerUnavailableError();
    throw new Error(`Could not read GTA prospect owner-contact research: ${error.message ?? "unknown database error"}`);
  }
  if (!Array.isArray(data)) throw projectionError("RPC did not return an array");
  const records = data.map(parseRecord);
  if (new Set(records.map((record) => record.sourceRecordKey)).size !== records.length) throw projectionError("duplicate source record keys");
  return records;
}
