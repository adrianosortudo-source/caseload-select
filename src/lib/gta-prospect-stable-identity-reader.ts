import "server-only";

const RPC_NAME = "list_gta_prospect_stable_identities_for_operator";
const sourceKey = /^[a-z0-9][a-z0-9-]{1,159}$/;
const stableFirmId = /^FIRM-[0-9A-HJKMNP-TV-Z]{26}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

type RpcError = { code?: string; message?: string; details?: string | null; hint?: string | null };
export type GtaProspectStableIdentityReaderClient = {
  rpc: (functionName: string) => Promise<{ data: unknown; error: RpcError | null }>;
};

export type GtaProspectStableIdentity = Readonly<{
  sourceRecordKey: string;
  firmId: string;
  canonicalDomain: string;
  sourceUrl: string;
  observedOn: string;
  confidence: "high";
}>;

export class GtaProspectStableIdentityRegistryUnavailableError extends Error {
  constructor() {
    super("The authoritative GTA prospect stable-identity registry is not available yet.");
    this.name = "GtaProspectStableIdentityRegistryUnavailableError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function httpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const parsed = new URL(value); return parsed.protocol === "http:" || parsed.protocol === "https:"; } catch { return false; }
}

function missingProjection(error: RpcError): boolean {
  const text = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
  return error.code === "PGRST202" || error.code === "42883"
    || text.includes(`function public.${RPC_NAME} does not exist`)
    || text.includes(`could not find the function public.${RPC_NAME}`);
}

function invalid(message: string): Error {
  return new Error(`Invalid GTA prospect stable-identity projection: ${message}`);
}

function parseRow(value: unknown): GtaProspectStableIdentity {
  if (!object(value)) throw invalid("row is not an object");
  const keys = ["source_record_key", "stable_firm_id", "canonical_domain", "source_url", "observed_on", "confidence"];
  const unexpected = Object.keys(value).filter((key) => !keys.includes(key));
  if (unexpected.length) throw invalid(`unexpected column(s): ${unexpected.join(", ")}`);
  if (typeof value.source_record_key !== "string" || !sourceKey.test(value.source_record_key)) throw invalid("source_record_key is invalid");
  if (typeof value.stable_firm_id !== "string" || !stableFirmId.test(value.stable_firm_id)) throw invalid("stable_firm_id is invalid");
  if (typeof value.canonical_domain !== "string" || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value.canonical_domain) || value.canonical_domain.startsWith("www.")) throw invalid("canonical_domain is invalid");
  if (!httpUrl(value.source_url)) throw invalid("source_url is invalid");
  if (typeof value.observed_on !== "string" || !isoDate.test(value.observed_on)) throw invalid("observed_on is invalid");
  if (value.confidence !== "high") throw invalid("confidence must be high");
  return {
    sourceRecordKey: value.source_record_key,
    firmId: value.stable_firm_id,
    canonicalDomain: value.canonical_domain,
    sourceUrl: value.source_url,
    observedOn: value.observed_on,
    confidence: "high",
  };
}

export async function listGtaProspectStableIdentitiesForOperator(
  client?: GtaProspectStableIdentityReaderClient,
): Promise<readonly GtaProspectStableIdentity[]> {
  const reader = client ?? await (async () => {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    return supabaseAdmin as unknown as GtaProspectStableIdentityReaderClient;
  })();
  const { data, error } = await reader.rpc(RPC_NAME);
  if (error) {
    if (missingProjection(error)) throw new GtaProspectStableIdentityRegistryUnavailableError();
    throw new Error(`Could not read the GTA prospect stable-identity registry: ${error.message ?? "unknown database error"}`);
  }
  if (!Array.isArray(data)) throw invalid("RPC did not return an array");
  const identities = data.map(parseRow);
  if (new Set(identities.map((identity) => identity.sourceRecordKey)).size !== identities.length) throw invalid("duplicate source record keys");
  if (new Set(identities.map((identity) => identity.firmId)).size !== identities.length) throw invalid("duplicate stable firm IDs");
  if (new Set(identities.map((identity) => identity.canonicalDomain)).size !== identities.length) throw invalid("duplicate canonical domains");
  return identities;
}
