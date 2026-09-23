import "server-only";

import { prospectEnrichmentProtocolHash } from "@/lib/prospect-enrichment-hash";
import type { ProspectEnrichmentCoreEvidence, SourceBoundNewCoreInput } from "@/lib/prospect-enrichment-core-evidence";
import type { JsonValue } from "@/lib/prospect-enrichment-contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_KEY = /^[a-z0-9][a-z0-9-]{0,159}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const itemDispositions = new Set(["accept_new", "link_existing", "retain_only"]);
const PROFILE_KEY = /^(?:websiteUrl|(?:office|roster|contact|advertising|opportunity):obs:[a-z0-9][a-z0-9._-]{0,119})$/;

export type ProspectEnrichmentProfileChoice = Readonly<{
  fieldKey: string;
  sourceSelector: string;
  selectedValue: JsonValue;
}>;

export type ReviewedNewCoreInput = Readonly<SourceBoundNewCoreInput>;

export type ProspectEnrichmentReviewItemChoice = Readonly<{
  itemId: string;
  disposition: "accept_new" | "link_existing" | "retain_only";
  reason: string | null;
  profileChoice: ProspectEnrichmentProfileChoice | null;
}>;

export type ProspectEnrichmentReview = Readonly<{
  payloadSha256: string;
  identity: Readonly<{
    choice: "existing" | "new" | "unresolved";
    firmId: string | null;
    coreInput: ReviewedNewCoreInput | null;
  }>;
  items: readonly ProspectEnrichmentReviewItemChoice[];
}>;

export class ProspectEnrichmentReviewInputError extends Error {
  constructor(message: string, readonly status: 400 | 422 = 422) {
    super(message);
    this.name = "ProspectEnrichmentReviewInputError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 40) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => jsonValue(item, depth + 1));
  if (!record(value)) return false;
  return Object.values(value).every((item) => jsonValue(item, depth + 1));
}

function parseProfileChoice(value: unknown): ProspectEnrichmentProfileChoice | null {
  if (value === null) return null;
  if (!record(value)) throw new ProspectEnrichmentReviewInputError("A profile choice must be null or an exact field, selector and JSON value.");
  exactKeys(value, ["fieldKey", "sourceSelector", "selectedValue"], "profileChoice");
  if (typeof value.fieldKey !== "string" || !PROFILE_KEY.test(value.fieldKey)
    || typeof value.sourceSelector !== "string" || !jsonValue(value.selectedValue)) {
    throw new ProspectEnrichmentReviewInputError("The profile choice is not an allowlisted source selector and JSON value.");
  }
  const expectedSelector = value.fieldKey === "websiteUrl" ? "/data/pageUrl"
    : value.fieldKey.startsWith("office:") ? "/data/office" : "/data";
  if (value.sourceSelector !== expectedSelector) throw new ProspectEnrichmentReviewInputError("The profile selector does not match its allowlisted field.");
  return value as unknown as ProspectEnrichmentProfileChoice;
}

function sameJson(left: JsonValue, right: unknown): boolean {
  try { return prospectEnrichmentProtocolHash(left) === prospectEnrichmentProtocolHash(right); }
  catch { return false; }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key)) || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new ProspectEnrichmentReviewInputError(`${label} contains missing or unrecognized fields.`, 400);
  }
}

function text(value: unknown, maxBytes: number, nullable = false): value is string | null {
  if (nullable && value === null) return true;
  return typeof value === "string" && value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= maxBytes;
}

function date(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function httpUrl(value: unknown, nullable = false): value is string | null {
  if (nullable && value === null) return true;
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length > 0 && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

function parseCoreReference(value: unknown, label: string): value is { itemId: string; sourceId: string } {
  if (!record(value)) return false;
  exactKeys(value, ["itemId", "sourceId"], label);
  return typeof value.itemId === "string" && UUID.test(value.itemId)
    && typeof value.sourceId === "string" && value.sourceId.length > 0 && new TextEncoder().encode(value.sourceId).byteLength <= 160;
}

function parseCoreEvidence(value: unknown): value is ProspectEnrichmentCoreEvidence {
  if (!record(value)) throw new ProspectEnrichmentReviewInputError("A create-new review requires source IDs for every core field.");
  exactKeys(value, ["firmName", "city", "officeCities", "websiteUrl", "practiceAreas", "roster"], "identity.coreEvidence");
  if (!record(value.firmName)) throw new ProspectEnrichmentReviewInputError("Firm-name source evidence is required.");
  exactKeys(value.firmName, ["sourceId"], "identity.coreEvidence.firmName");
  if (!text(value.firmName.sourceId, 160) || !parseCoreReference(value.city, "identity.coreEvidence.city")
    || !Array.isArray(value.officeCities) || value.officeCities.length < 1 || value.officeCities.length > 500
    || !value.officeCities.every((item) => parseCoreReference(item, "identity.coreEvidence.officeCities[]"))
    || !record(value.websiteUrl)) throw new ProspectEnrichmentReviewInputError("Core field source evidence is incomplete or invalid.");
  exactKeys(value.websiteUrl, ["sourceId"], "identity.coreEvidence.websiteUrl");
  if (value.websiteUrl.sourceId !== null && !text(value.websiteUrl.sourceId, 160)) throw new ProspectEnrichmentReviewInputError("Website source ID must be a selected ID or null.");
  if (!Array.isArray(value.practiceAreas) || value.practiceAreas.length > 500
    || !value.practiceAreas.every((item) => parseCoreReference(item, "identity.coreEvidence.practiceAreas[]"))
    || !parseCoreReference(value.roster, "identity.coreEvidence.roster")) throw new ProspectEnrichmentReviewInputError("Core field source evidence is incomplete or invalid.");
  return true;
}

function parseCoreInput(value: unknown): ReviewedNewCoreInput {
  const keys = ["id", "firmName", "city", "officeCities", "websiteUrl", "practiceAreas", "observedLawyerCount", "observedLawyerCountQualifier", "observedLawyerCountDisplay", "rosterSourceUrl", "rosterCheckedAt", "reconciliationStatus", "legacyClusterLawyerCount", "legacyCrosswalk", "reconciliationNote", "publicContacts", "coreEvidence"] as const;
  if (!record(value)) throw new ProspectEnrichmentReviewInputError("A create-new review requires the complete server-prepared core input.");
  exactKeys(value, keys, "identity.coreInput");
  if (typeof value.id !== "string" || !SOURCE_KEY.test(value.id)
    || !text(value.firmName, 300) || !text(value.city, 120)
    || !Array.isArray(value.officeCities) || value.officeCities.length === 0
    || value.officeCities.some((item) => !text(item, 120))
    || value.officeCities[0] !== value.city || new Set(value.officeCities).size !== value.officeCities.length
    || !httpUrl(value.websiteUrl, true)
    || !Array.isArray(value.practiceAreas) || value.practiceAreas.some((item) => !text(item, 500))
    || new Set(value.practiceAreas).size !== value.practiceAreas.length
    || (value.observedLawyerCount !== null && (!Number.isInteger(value.observedLawyerCount) || (value.observedLawyerCount as number) < 0))
    || !["exact", "at_least", "unknown"].includes(String(value.observedLawyerCountQualifier))
    || (value.observedLawyerCountQualifier === "unknown" ? value.observedLawyerCount !== null : value.observedLawyerCount === null)
    || !text(value.observedLawyerCountDisplay, 1000, true)
    || !httpUrl(value.rosterSourceUrl) || !date(value.rosterCheckedAt)
    || value.reconciliationStatus !== "provisional_new"
    || value.legacyClusterLawyerCount !== null || value.legacyCrosswalk !== null
    || !text(value.reconciliationNote, 5000)
    || !Array.isArray(value.publicContacts) || value.publicContacts.length !== 0
    || !parseCoreEvidence(value.coreEvidence)) {
    throw new ProspectEnrichmentReviewInputError("The create-new core input is incomplete or contradicts the reviewed evidence.");
  }
  return value as unknown as ReviewedNewCoreInput;
}

/** Exact shape and local consistency checks run before the authoritative database revalidation. */
export function parseProspectEnrichmentReview(
  value: unknown,
  options: Readonly<{ allowedProfileChoices?: ReadonlyMap<string, ProspectEnrichmentProfileChoice | null> }> = {},
): ProspectEnrichmentReview {
  if (!record(value)) throw new ProspectEnrichmentReviewInputError("A review request object is required.", 400);
  exactKeys(value, ["payloadSha256", "identity", "items"], "review");
  if (typeof value.payloadSha256 !== "string" || !SHA256.test(value.payloadSha256)) throw new ProspectEnrichmentReviewInputError("payloadSha256 must be a lowercase SHA-256 value.", 400);
  if (!record(value.identity)) throw new ProspectEnrichmentReviewInputError("identity must be an object.", 400);
  exactKeys(value.identity, ["choice", "firmId", "coreInput"], "identity");

  let identity: ProspectEnrichmentReview["identity"];
  if (value.identity.choice === "existing") {
    if (typeof value.identity.firmId !== "string" || !UUID.test(value.identity.firmId) || value.identity.coreInput !== null) {
      throw new ProspectEnrichmentReviewInputError("An existing-firm choice requires a UUID and no create-new input.");
    }
    identity = { choice: "existing", firmId: value.identity.firmId, coreInput: null };
  } else if (value.identity.choice === "new") {
    if (value.identity.firmId !== null) throw new ProspectEnrichmentReviewInputError("A create-new choice cannot specify an existing firm UUID.");
    identity = { choice: "new", firmId: null, coreInput: parseCoreInput(value.identity.coreInput) };
  } else if (value.identity.choice === "unresolved") {
    if (value.identity.firmId !== null || value.identity.coreInput !== null) throw new ProspectEnrichmentReviewInputError("An unresolved identity cannot specify a firm or core import.");
    identity = { choice: "unresolved", firmId: null, coreInput: null };
  } else {
    throw new ProspectEnrichmentReviewInputError("identity.choice must be existing, new or unresolved.", 400);
  }

  if (!Array.isArray(value.items) || value.items.length > 1001) throw new ProspectEnrichmentReviewInputError("Review must explicitly cover every package item.");
  const seen = new Set<string>();
  const items = value.items.map((candidate): ProspectEnrichmentReviewItemChoice => {
    if (!record(candidate)) throw new ProspectEnrichmentReviewInputError("Every review item must be an object.", 400);
    exactKeys(candidate, ["itemId", "disposition", "reason", "profileChoice"], "review item");
    if (typeof candidate.itemId !== "string" || !UUID.test(candidate.itemId) || seen.has(candidate.itemId)) throw new ProspectEnrichmentReviewInputError("Review item IDs must be unique UUIDs.");
    seen.add(candidate.itemId);
    if (typeof candidate.disposition !== "string" || !itemDispositions.has(candidate.disposition)) throw new ProspectEnrichmentReviewInputError("Every item requires a supported disposition.");
    if (candidate.reason !== null && !text(candidate.reason, 2000)) throw new ProspectEnrichmentReviewInputError("A review reason must be text up to 2,000 bytes or null.");
    if (candidate.disposition === "retain_only" && !text(candidate.reason, 2000)) throw new ProspectEnrichmentReviewInputError("Every retained item needs an explicit reason.");
    const profileChoice = parseProfileChoice(candidate.profileChoice);
    if (profileChoice && candidate.disposition === "retain_only") throw new ProspectEnrichmentReviewInputError("Only an accepted or linked item may be selected for the current profile.");
    if (identity.choice === "unresolved" && (candidate.disposition !== "retain_only" || profileChoice !== null)) throw new ProspectEnrichmentReviewInputError("Unresolved identity permits retain-only dispositions until identity is reviewed.");
    if (profileChoice && options.allowedProfileChoices) {
      const allowed = options.allowedProfileChoices.get(candidate.itemId);
      if (!allowed || allowed.fieldKey !== profileChoice.fieldKey || allowed.sourceSelector !== profileChoice.sourceSelector
        || !sameJson(allowed.selectedValue, profileChoice.selectedValue)) {
        throw new ProspectEnrichmentReviewInputError("The selected profile value does not match this item's server-derived evidence projection.");
      }
    }
    return { itemId: candidate.itemId, disposition: candidate.disposition as ProspectEnrichmentReviewItemChoice["disposition"], reason: candidate.reason as string | null, profileChoice };
  }).sort((left, right) => left.itemId.localeCompare(right.itemId));

  return { payloadSha256: value.payloadSha256, identity, items };
}

export function prospectEnrichmentReviewSha256(review: ProspectEnrichmentReview): string {
  return prospectEnrichmentProtocolHash(review);
}

export type ProspectEnrichmentRpcClient = Readonly<{
  rpc: (functionName: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
}>;

export function prospectEnrichmentRpcObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return record(value[0]) ? value[0] : null;
  return record(value) ? value : null;
}

export function prospectEnrichmentRpcFailure(error: { code?: string; message?: string } | null, fallback: string) {
  const code = error?.message?.split(":", 1)[0] ?? error?.code ?? "database_unavailable";
  if (["package_not_found", "not_found"].includes(code) || error?.code === "PGRST116") return { status: 404 as const, code: "not_found", message: "The research package was not found." };
  if (["payload_mismatch", "review_changed", "already_applied", "package_terminal", "identity_conflict", "source_event_conflict"].includes(code) || error?.code === "23505") return { status: 409 as const, code, message: "The research package changed or conflicts with the current firm record. Reload it and prepare a fresh review." };
  if (["invalid_review", "invalid_identity", "invalid_item", "invalid_disposition", "invalid_profile_choice"].includes(code)) return { status: 422 as const, code, message: "The reviewed changes do not satisfy the current evidence and identity rules." };
  return { status: 503 as const, code: "database_unavailable", message: fallback };
}
