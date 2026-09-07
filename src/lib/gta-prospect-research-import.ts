import type { ReconciledGtaProspect, ReconciliationStatus } from "@/lib/gta-prospect-records";

export type GtaProspectResearchRecord = ReconciledGtaProspect & {
  /** Optional raw office detail when the source actually supplied it. */
  officeObservations?: readonly {
    city: string;
    province?: "ON";
    addressRaw?: string | null;
    streetNormalized?: string | null;
    suiteRaw?: string | null;
    sourceUrl: string;
    observedOn: string;
  }[];
  /** Only include names observed in a source; do not infer legal names. */
  legalNames?: readonly string[];
};

export type ValidationIssue = { sourceRecordKey: string; message: string };

export type GtaProspectImportPlan = {
  accepted: readonly GtaProspectResearchRecord[];
  rejected: readonly { record: unknown; issues: readonly ValidationIssue[] }[];
  sourceSha256: string;
};

const RECONCILIATION_STATUSES: readonly ReconciliationStatus[] = [
  "provisional_new", "update_existing", "new_pending_identity", "duplicate", "unresolved",
];

const DISALLOWED_RESEARCH_KEYS = new Set([
  "email", "phone", "contact", "contactemail", "contactphone", "outreach", "message", "campaign", "crm",
]);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function findDisallowedKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findDisallowedKeys(item, `${path}[${index}]`));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const current = path ? `${path}.${key}` : key;
    const normalizedKey = key.replace(/[_-]/g, "").toLocaleLowerCase();
    return [
      ...(DISALLOWED_RESEARCH_KEYS.has(normalizedKey) ? [current] : []),
      ...findDisallowedKeys(item, current),
    ];
  });
}

function issuesForRecord(value: unknown): ValidationIssue[] {
  const id = isObject(value) && typeof value.id === "string" ? value.id : "<missing-id>";
  const issues: ValidationIssue[] = [];
  const reject = (message: string) => issues.push({ sourceRecordKey: id, message });
  if (!isObject(value)) {
    reject("record must be an object");
    return issues;
  }
  if (typeof value.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,159}$/.test(value.id)) reject("id must be a stable lowercase source key");
  if (typeof value.firmName !== "string" || value.firmName.trim().length === 0) reject("firmName is required");
  if (!Array.isArray(value.officeCities) || value.officeCities.length === 0 || value.officeCities.some((city) => typeof city !== "string" || city.trim().length === 0)) reject("at least one office city is required");
  if (value.websiteUrl !== null && value.websiteUrl !== undefined && !isHttpUrl(value.websiteUrl)) reject("websiteUrl must be an http(s) URL when supplied");
  if (!isHttpUrl(value.rosterSourceUrl)) reject("accepted records require a roster source URL");
  if (!isDate(value.rosterCheckedAt)) reject("accepted records require a roster observation date");
  if (!RECONCILIATION_STATUSES.includes(value.reconciliationStatus as ReconciliationStatus)) reject("reconciliationStatus is invalid");
  if (!["exact", "at_least", "unknown"].includes(String(value.observedLawyerCountQualifier))) reject("observed lawyer count qualifier is invalid");
  if (value.observedLawyerCountQualifier === "unknown" && value.observedLawyerCount !== null) reject("unknown count qualifier requires a null observed lawyer count");
  if (["exact", "at_least"].includes(String(value.observedLawyerCountQualifier)) && (!Number.isInteger(value.observedLawyerCount) || Number(value.observedLawyerCount) < 0)) reject("exact and at_least counts require a non-negative integer");
  if (value.advertisingEvidence === "observed" && !isHttpUrl(value.advertisingSourceUrl)) reject("observed advertising requires its source URL");
  if (value.gbpEvidence === "observed" && !isHttpUrl(value.gbpSourceUrl)) reject("observed Google Business Profile evidence requires its source URL");
  if (Array.isArray(value.officeObservations)) {
    for (const office of value.officeObservations) {
      if (!isObject(office) || typeof office.city !== "string" || !isHttpUrl(office.sourceUrl) || !isDate(office.observedOn)) reject("each office observation requires city, source URL, and observation date");
    }
  }
  const disallowedKeys = findDisallowedKeys(value);
  if (disallowedKeys.length) reject(`contact, outreach, or CRM fields are not allowed: ${disallowedKeys.join(", ")}`);
  return issues;
}

/**
 * Validate without touching a database or network. Same name, domain, street,
 * or missing suite never produces a merge: only duplicate source record keys
 * within the submitted batch are rejected.
 */
export async function buildGtaProspectImportPlan(records: readonly unknown[]): Promise<GtaProspectImportPlan> {
  const sourceSha256 = await sha256(records);
  const seenKeys = new Set<string>();
  const accepted: GtaProspectResearchRecord[] = [];
  const rejected: { record: unknown; issues: ValidationIssue[] }[] = [];

  for (const record of records) {
    const issues = issuesForRecord(record);
    const id = isObject(record) && typeof record.id === "string" ? record.id : "<missing-id>";
    if (seenKeys.has(id)) issues.push({ sourceRecordKey: id, message: "duplicate source record key within batch" });
    seenKeys.add(id);
    if (issues.length) rejected.push({ record, issues });
    else accepted.push(record as GtaProspectResearchRecord);
  }
  return { accepted, rejected, sourceSha256 };
}

export type GtaProspectImportWriter = {
  apply(plan: GtaProspectImportPlan): Promise<void>;
};

export type ImportExecutionResult =
  | { state: "dry_run"; plan: GtaProspectImportPlan }
  | { state: "unauthorized"; plan: GtaProspectImportPlan }
  | { state: "rejected"; plan: GtaProspectImportPlan }
  | { state: "applied"; plan: GtaProspectImportPlan };

/**
 * The server-facing guard used by any future operator route. It guarantees an
 * unauthenticated caller and every dry run produce zero database writes.
 */
export async function executeGtaProspectImport({
  plan,
  dryRun,
  operatorAuthorized,
  writer,
}: {
  plan: GtaProspectImportPlan;
  dryRun: boolean;
  operatorAuthorized: boolean;
  writer: GtaProspectImportWriter;
}): Promise<ImportExecutionResult> {
  if (dryRun) return { state: "dry_run", plan };
  if (!operatorAuthorized) return { state: "unauthorized", plan };
  if (plan.rejected.length) return { state: "rejected", plan };
  await writer.apply(plan);
  return { state: "applied", plan };
}

export function sourceRecordHashInput(record: GtaProspectResearchRecord): string {
  return stableJson(record);
}

export function normalizedResearchName(value: string): string {
  return normalize(value);
}
