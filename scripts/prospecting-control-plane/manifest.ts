import { createHash } from "node:crypto";

export const PROSPECTING_CONTROL_PLANE_SOURCE_SYSTEM = "prospecting_control_plane" as const;
export const PROSPECTING_MANIFEST_SCHEMA_VERSION = "prospecting-control-plane-provision-manifest-v1" as const;
export const EXPECTED_RECORD_COUNT = 100;
export const EXPECTED_ARM_COUNTS = { BA: 50, AE: 50 } as const;
export const MAX_SOURCE_PAYLOAD_BYTES = 50_000;
export const MAX_MANIFEST_BYTES = 10_000_000;

export type ProspectArm = keyof typeof EXPECTED_ARM_COUNTS;
export type ProspectMethod = "beyond_agency" | "adam_erhart";

export interface ProspectEvidence {
  url: string;
  observed_at: string;
  label: string;
}

export interface ProspectHighLevelIdentity {
  location_id: string | null;
  contact_id: string | null;
  smart_list_id: string | null;
  workflow_ids: string[];
}

export interface ProspectManifestRecord {
  cls_record_id: string;
  arm: ProspectArm;
  source_url: string;
  organization: {
    display_name: string;
    city: string | null;
    website_url: string;
  };
  person: null | {
    display_name: string;
    primary_email: string | null;
    primary_phone: string | null;
    role_title: string | null;
    email_attribution: null | {
      mailbox_type: "named_person" | "generic_firm";
      person_attribution_proven: boolean;
      evidence_url: string;
    };
  };
  source_payload: {
    arm: ProspectArm;
    method: ProspectMethod;
    evidence: ProspectEvidence[];
    highlevel: ProspectHighLevelIdentity;
    [key: string]: unknown;
  };
  provisioning_basis: string;
}

export interface ProspectProvisionManifest {
  schema_version: typeof PROSPECTING_MANIFEST_SCHEMA_VERSION;
  generated_at: string;
  records: ProspectManifestRecord[];
}

export interface ValidatedProspectManifest extends ProspectProvisionManifest {
  manifest_sha256: string;
}

const GENERIC_INBOX_LOCAL_PARTS = new Set([
  "accounts", "admin", "appointments", "billing", "bookings", "business", "careers", "clientcare",
  "clients", "clientservices", "consultations", "contact", "contactus", "enquiries", "frontdesk", "general",
  "hello", "help", "hiring", "info", "inquiries", "inquiry", "intake", "law", "lawyers", "legal", "mail",
  "marketing", "media", "newclients", "noreply", "office", "reception", "receptiondesk", "recruiting",
  "service", "services", "support", "team",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${path} must be an object.`);
}

function assertExactKeys(value: Record<string, unknown>, keys: string[], path: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${path} contains unsupported field(s): ${unknown.join(", ")}.`);
}

function requiredText(value: unknown, path: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`${path} must contain 1-${max} characters.`);
  return normalized;
}

function nullableText(value: unknown, path: string, max: number): string | null {
  if (value === null) return null;
  return requiredText(value, path, max);
}

function httpUrl(value: unknown, path: string): string {
  const input = requiredText(value, path, 2_000);
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`${path} must be a valid HTTP(S) URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${path} must be a valid HTTP(S) URL.`);
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizedHost(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

function isSameFirstParty(sourceUrl: string, organizationUrl: string): boolean {
  const source = normalizedHost(sourceUrl);
  const organization = normalizedHost(organizationUrl);
  return source === organization || source.endsWith(`.${organization}`) || organization.endsWith(`.${source}`);
}

function isIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && /T/.test(value);
}

function isGenericInbox(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return false;
  return GENERIC_INBOX_LOCAL_PARTS.has(email.slice(0, at).toLowerCase().replace(/[._+-].*$/, ""));
}

function canonicalWebsite(value: string): string {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${normalizedHost(value)}${path}`.toLowerCase();
}

function validateHighLevel(value: unknown, path: string): ProspectHighLevelIdentity {
  assertObject(value, path);
  assertExactKeys(value, ["location_id", "contact_id", "smart_list_id", "workflow_ids"], path);
  const workflowIds = value.workflow_ids;
  if (!Array.isArray(workflowIds) || workflowIds.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 300)) {
    throw new Error(`${path}.workflow_ids must be an array of non-empty strings.`);
  }
  return {
    location_id: nullableText(value.location_id, `${path}.location_id`, 300),
    contact_id: nullableText(value.contact_id, `${path}.contact_id`, 300),
    smart_list_id: nullableText(value.smart_list_id, `${path}.smart_list_id`, 300),
    workflow_ids: workflowIds.map((item) => (item as string).trim()),
  };
}

function validateEvidence(value: unknown, path: string): ProspectEvidence[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} must contain at least one evidence item.`);
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    assertObject(item, itemPath);
    assertExactKeys(item, ["url", "observed_at", "label"], itemPath);
    const observedAt = requiredText(item.observed_at, `${itemPath}.observed_at`, 100);
    if (!isIsoTimestamp(observedAt)) throw new Error(`${itemPath}.observed_at must be an ISO timestamp.`);
    return {
      url: httpUrl(item.url, `${itemPath}.url`),
      observed_at: new Date(observedAt).toISOString(),
      label: requiredText(item.label, `${itemPath}.label`, 500),
    };
  });
}

function validateRecord(value: unknown, index: number): ProspectManifestRecord {
  const path = `records[${index}]`;
  assertObject(value, path);
  assertExactKeys(value, [
    "cls_record_id", "arm", "source_url", "organization", "person", "source_payload", "provisioning_basis",
  ], path);
  const clsRecordId = requiredText(value.cls_record_id, `${path}.cls_record_id`, 300);
  if (!/^(BA|AE)-[A-Z0-9][A-Z0-9_-]*$/.test(clsRecordId)) {
    throw new Error(`${path}.cls_record_id must begin with BA- or AE- and contain only uppercase letters, digits, _ or -.`);
  }
  if (value.arm !== "BA" && value.arm !== "AE") throw new Error(`${path}.arm must be BA or AE.`);
  const arm = value.arm;
  if (!clsRecordId.startsWith(`${arm}-`)) throw new Error(`${path}.cls_record_id does not match its arm.`);

  assertObject(value.organization, `${path}.organization`);
  assertExactKeys(value.organization, ["display_name", "city", "website_url"], `${path}.organization`);
  const websiteUrl = httpUrl(value.organization.website_url, `${path}.organization.website_url`);
  const sourceUrl = httpUrl(value.source_url, `${path}.source_url`);
  if (!isSameFirstParty(sourceUrl, websiteUrl)) {
    throw new Error(`${path}.source_url must be first-party to organization.website_url.`);
  }
  const organization = {
    display_name: requiredText(value.organization.display_name, `${path}.organization.display_name`, 300),
    city: nullableText(value.organization.city, `${path}.organization.city`, 120),
    website_url: websiteUrl,
  };

  let person: ProspectManifestRecord["person"] = null;
  if (value.person !== null) {
    assertObject(value.person, `${path}.person`);
    assertExactKeys(value.person, ["display_name", "primary_email", "primary_phone", "role_title", "email_attribution"], `${path}.person`);
    const primaryEmail = nullableText(value.person.primary_email, `${path}.person.primary_email`, 320);
    if (primaryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(primaryEmail)) {
      throw new Error(`${path}.person.primary_email must be a valid email address.`);
    }
    let attribution: NonNullable<ProspectManifestRecord["person"]>["email_attribution"] = null;
    if (value.person.email_attribution !== null) {
      assertObject(value.person.email_attribution, `${path}.person.email_attribution`);
      assertExactKeys(value.person.email_attribution, ["mailbox_type", "person_attribution_proven", "evidence_url"], `${path}.person.email_attribution`);
      if (value.person.email_attribution.mailbox_type !== "named_person" && value.person.email_attribution.mailbox_type !== "generic_firm") {
        throw new Error(`${path}.person.email_attribution.mailbox_type is invalid.`);
      }
      if (typeof value.person.email_attribution.person_attribution_proven !== "boolean") {
        throw new Error(`${path}.person.email_attribution.person_attribution_proven must be boolean.`);
      }
      const evidenceUrl = httpUrl(value.person.email_attribution.evidence_url, `${path}.person.email_attribution.evidence_url`);
      if (!isSameFirstParty(evidenceUrl, websiteUrl)) {
        throw new Error(`${path}.person.email_attribution.evidence_url must be first-party.`);
      }
      attribution = {
        mailbox_type: value.person.email_attribution.mailbox_type,
        person_attribution_proven: value.person.email_attribution.person_attribution_proven,
        evidence_url: evidenceUrl,
      };
    }
    if (primaryEmail && isGenericInbox(primaryEmail)) {
      throw new Error(`${path}.person.primary_email cannot contain a generic firm inbox; keep that route in source_payload and set primary_email to null.`);
    }
    if (primaryEmail && (!attribution || attribution.mailbox_type !== "named_person" || attribution.person_attribution_proven !== true)) {
      throw new Error(`${path}.person.primary_email requires explicit first-party named-person attribution.`);
    }
    if (!primaryEmail && attribution) {
      throw new Error(`${path}.person.email_attribution must be null when primary_email is null.`);
    }
    const primaryPhone = nullableText(value.person.primary_phone, `${path}.person.primary_phone`, 80);
    if (primaryPhone && primaryPhone.length < 3) {
      throw new Error(`${path}.person.primary_phone must contain 3-80 characters when present.`);
    }
    person = {
      display_name: requiredText(value.person.display_name, `${path}.person.display_name`, 300),
      primary_email: primaryEmail?.toLowerCase() ?? null,
      primary_phone: primaryPhone,
      role_title: nullableText(value.person.role_title, `${path}.person.role_title`, 200),
      email_attribution: attribution,
    };
  }

  assertObject(value.source_payload, `${path}.source_payload`);
  let payloadBytes: number;
  try {
    payloadBytes = Buffer.byteLength(JSON.stringify(value.source_payload), "utf8");
  } catch {
    throw new Error(`${path}.source_payload must be JSON serializable.`);
  }
  if (payloadBytes > MAX_SOURCE_PAYLOAD_BYTES) {
    throw new Error(`${path}.source_payload exceeds ${MAX_SOURCE_PAYLOAD_BYTES} bytes.`);
  }
  if (value.source_payload.arm !== arm) throw new Error(`${path}.source_payload.arm must match arm.`);
  const expectedMethod: ProspectMethod = arm === "BA" ? "beyond_agency" : "adam_erhart";
  if (value.source_payload.method !== expectedMethod) {
    throw new Error(`${path}.source_payload.method must be ${expectedMethod}.`);
  }
  const evidence = validateEvidence(value.source_payload.evidence, `${path}.source_payload.evidence`);
  if (!evidence.some((item) => isSameFirstParty(item.url, websiteUrl))) {
    throw new Error(`${path}.source_payload.evidence must include first-party evidence.`);
  }
  const highlevel = validateHighLevel(value.source_payload.highlevel, `${path}.source_payload.highlevel`);

  return {
    cls_record_id: clsRecordId,
    arm,
    source_url: sourceUrl,
    organization,
    person,
    source_payload: { ...value.source_payload, arm, method: expectedMethod, evidence, highlevel },
    provisioning_basis: requiredText(value.provisioning_basis, `${path}.provisioning_basis`, 5_000),
  };
}

export function provisioningIdempotencyKey(clsRecordId: string): string {
  return `${PROSPECTING_CONTROL_PLANE_SOURCE_SYSTEM}:provision:${clsRecordId}:v1`;
}

export function validateProspectProvisionManifest(raw: string): ValidatedProspectManifest {
  if (Buffer.byteLength(raw, "utf8") > MAX_MANIFEST_BYTES) {
    throw new Error(`Manifest exceeds ${MAX_MANIFEST_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertObject(parsed, "manifest");
  assertExactKeys(parsed, ["schema_version", "generated_at", "records"], "manifest");
  if (parsed.schema_version !== PROSPECTING_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`manifest.schema_version must be ${PROSPECTING_MANIFEST_SCHEMA_VERSION}.`);
  }
  const generatedAt = requiredText(parsed.generated_at, "manifest.generated_at", 100);
  if (!isIsoTimestamp(generatedAt)) throw new Error("manifest.generated_at must be an ISO timestamp.");
  if (!Array.isArray(parsed.records) || parsed.records.length !== EXPECTED_RECORD_COUNT) {
    throw new Error(`manifest.records must contain exactly ${EXPECTED_RECORD_COUNT} records.`);
  }
  const records = parsed.records.map(validateRecord);
  const armCounts = records.reduce<Record<ProspectArm, number>>((counts, record) => {
    counts[record.arm] += 1;
    return counts;
  }, { BA: 0, AE: 0 });
  for (const arm of Object.keys(EXPECTED_ARM_COUNTS) as ProspectArm[]) {
    if (armCounts[arm] !== EXPECTED_ARM_COUNTS[arm]) {
      throw new Error(`manifest.records must contain exactly ${EXPECTED_ARM_COUNTS[arm]} ${arm} records; found ${armCounts[arm]}.`);
    }
  }

  const uniqueChecks: Array<[string, (record: ProspectManifestRecord) => string | null]> = [
    ["CLS record id", (record) => record.cls_record_id.toLowerCase()],
    ["provisioning idempotency key", (record) => provisioningIdempotencyKey(record.cls_record_id).toLowerCase()],
    ["organization website", (record) => canonicalWebsite(record.organization.website_url)],
    ["organization display name", (record) => record.organization.display_name.toLowerCase().replace(/\s+/g, " ")],
    ["person primary email", (record) => record.person?.primary_email?.toLowerCase() ?? null],
  ];
  for (const [label, selector] of uniqueChecks) {
    const seen = new Map<string, string>();
    for (const record of records) {
      const key = selector(record);
      if (!key) continue;
      const previous = seen.get(key);
      if (previous) throw new Error(`Duplicate ${label}: ${previous} and ${record.cls_record_id}.`);
      seen.set(key, record.cls_record_id);
    }
  }

  return {
    schema_version: PROSPECTING_MANIFEST_SCHEMA_VERSION,
    generated_at: new Date(generatedAt).toISOString(),
    records,
    manifest_sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
  };
}
