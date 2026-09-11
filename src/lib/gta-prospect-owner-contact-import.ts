export const OWNER_ROLES = [
  "sole_proprietor",
  "owner",
  "founding_partner",
  "managing_partner",
  "other_partner",
] as const;
export type OwnerRole = (typeof OWNER_ROLES)[number];

export const OWNERSHIP_CONFIDENCES = ["confirmed_owner", "leadership_only"] as const;
export type OwnershipConfidence = (typeof OWNERSHIP_CONFIDENCES)[number];

export const OWNER_EMAIL_AVAILABILITY = [
  "direct_owner_email",
  "firm_general_email",
  "unavailable",
] as const;
export type OwnerEmailAvailability = (typeof OWNER_EMAIL_AVAILABILITY)[number];

export type OwnerContactCanonicalRecord = {
  sourceRecordKey: string;
  owner: {
    name: string;
    role: OwnerRole;
    confidence: OwnershipConfidence;
    sourceUrl: string;
    observedOn: string;
  };
  email: {
    availability: OwnerEmailAvailability;
    address: string | null;
    sourceUrl: string | null;
    observedOn: string | null;
  };
  isPrimaryContact: boolean;
};

export type OwnerContactValidationIssue = { sourceRecordKey: string; message: string };
export type GtaProspectOwnerContactImportPlan = {
  accepted: OwnerContactCanonicalRecord[];
  rejected: { sourceRecordKey: string; issues: OwnerContactValidationIssue[] }[];
};

const inputKeys = new Set([
  "sourceRecordKey",
  "ownerName",
  "ownerRole",
  "ownershipConfidence",
  "ownershipSourceUrl",
  "ownershipObservedOn",
  "emailAvailability",
  "emailAddress",
  "emailSourceUrl",
  "emailObservedOn",
  "isPrimaryContact",
]);
const stableKey = /^[a-z0-9][a-z0-9-]{1,159}$/;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpUrl(value: unknown): value is string {
  if (!isText(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function project(input: unknown): {
  sourceRecordKey: string;
  record: OwnerContactCanonicalRecord | null;
  issues: OwnerContactValidationIssue[];
} {
  const sourceRecordKey = isObject(input) && typeof input.sourceRecordKey === "string"
    ? input.sourceRecordKey
    : "<missing-source-record-key>";
  const issues: OwnerContactValidationIssue[] = [];
  const fail = (message: string) => issues.push({ sourceRecordKey, message });
  if (!isObject(input)) {
    fail("record must be an object");
    return { sourceRecordKey, record: null, issues };
  }

  const unexpected = Object.keys(input).filter((key) => !inputKeys.has(key));
  if (unexpected.length > 0) fail(`unrecognized fields are forbidden: ${unexpected.join(", ")}`);
  if (!isText(input.sourceRecordKey) || !stableKey.test(input.sourceRecordKey)) fail("sourceRecordKey must be a stable lowercase source key");
  if (!isText(input.ownerName) || input.ownerName.trim().length > 240) fail("ownerName is required and must be at most 240 characters");
  if (!OWNER_ROLES.includes(input.ownerRole as OwnerRole)) fail("ownerRole is invalid");
  if (!OWNERSHIP_CONFIDENCES.includes(input.ownershipConfidence as OwnershipConfidence)) fail("ownershipConfidence is invalid");
  if (!isHttpUrl(input.ownershipSourceUrl)) fail("ownershipSourceUrl must be an http(s) URL");
  if (!isIsoDate(input.ownershipObservedOn)) fail("ownershipObservedOn must be an ISO date");
  if (!OWNER_EMAIL_AVAILABILITY.includes(input.emailAvailability as OwnerEmailAvailability)) fail("emailAvailability is invalid");
  if (typeof input.isPrimaryContact !== "boolean") fail("isPrimaryContact must be a boolean");

  const emailAvailable = input.emailAvailability === "direct_owner_email" || input.emailAvailability === "firm_general_email";
  if (emailAvailable) {
    if (!isText(input.emailAddress) || !email.test(input.emailAddress.trim())) fail("published email address is invalid");
    if (!isHttpUrl(input.emailSourceUrl)) fail("published email requires an emailSourceUrl");
    if (!isIsoDate(input.emailObservedOn)) fail("published email requires an emailObservedOn date");
  } else if (input.emailAddress !== null || input.emailSourceUrl !== null || input.emailObservedOn !== null) {
    fail("unavailable email must not include an address or email evidence");
  }
  if (input.emailAvailability === "direct_owner_email" && input.ownershipConfidence !== "confirmed_owner") {
    fail("direct owner email requires confirmed ownership");
  }

  if (issues.length > 0) return { sourceRecordKey, record: null, issues };
  return {
    sourceRecordKey,
    issues,
    record: {
      sourceRecordKey: input.sourceRecordKey as string,
      owner: {
        name: (input.ownerName as string).trim(),
        role: input.ownerRole as OwnerRole,
        confidence: input.ownershipConfidence as OwnershipConfidence,
        sourceUrl: input.ownershipSourceUrl as string,
        observedOn: input.ownershipObservedOn as string,
      },
      email: {
        availability: input.emailAvailability as OwnerEmailAvailability,
        address: emailAvailable ? (input.emailAddress as string).trim() : null,
        sourceUrl: emailAvailable ? input.emailSourceUrl as string : null,
        observedOn: emailAvailable ? input.emailObservedOn as string : null,
      },
      isPrimaryContact: input.isPrimaryContact as boolean,
    },
  };
}

/**
 * Validates the separate, private owner-contact import payload. The core GTA
 * research importer intentionally does not accept these fields.
 */
export function buildGtaProspectOwnerContactImportPlan(inputs: readonly unknown[]): GtaProspectOwnerContactImportPlan {
  const accepted: OwnerContactCanonicalRecord[] = [];
  const rejected: GtaProspectOwnerContactImportPlan["rejected"] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const result = project(input);
    if (seen.has(result.sourceRecordKey)) {
      result.issues.push({ sourceRecordKey: result.sourceRecordKey, message: "duplicate source record key within batch" });
    }
    seen.add(result.sourceRecordKey);
    if (result.record && result.issues.length === 0) accepted.push(result.record);
    else rejected.push({ sourceRecordKey: result.sourceRecordKey, issues: result.issues });
  }
  return { accepted, rejected };
}
