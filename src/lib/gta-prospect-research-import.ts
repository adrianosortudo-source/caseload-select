import type { PublicProspectContact, ReconciliationStatus } from "@/lib/gta-prospect-records";

export type CanonicalRecord = {
  sourceRecordKey: string;
  firmName: string;
  normalizedFirmName: string;
  city: string;
  practiceAreas: string[];
  legacyCrosswalk: string | null;
  legacyClusterLawyerCount: number | null;
  websiteUrl: string | null;
  officeCities: string[];
  roster: { sourceUrl: string; observedOn: string; lawyerCount: number | null; qualifier: "exact" | "at_least" | "unknown"; display: string | null };
  reconciliation: { status: ReconciliationStatus; basis: string };
  evidence: { type: "roster" | "advertising" | "google_business_profile" | "website"; sourceUrl: string; observedOn: string; value: string | null }[];
  publicContacts: PublicProspectContact[];
};
export type ValidationIssue = { sourceRecordKey: string; message: string };
export type GtaProspectImportPlan = { accepted: CanonicalRecord[]; rejected: { sourceRecordKey: string; issues: ValidationIssue[] }[]; sourceSha256: string };
export type GtaProspectImportDisposition = "new" | "update" | "duplicate" | "review_required" | "invalid";
export type GtaProspectImportReview = Readonly<{
  sourceRecordKey: string;
  disposition: GtaProspectImportDisposition;
  reason: string;
}>;
export type GtaProspectImportReviewSummary = Readonly<{
  received: number;
  eligibleForApply: number;
  new: number;
  update: number;
  duplicate: number;
  reviewRequired: number;
  invalid: number;
}>;
export type GtaProspectImportReviewResult = Readonly<{
  plan: GtaProspectImportPlan;
  records: readonly GtaProspectImportReview[];
  summary: GtaProspectImportReviewSummary;
}>;

const keys = new Set(["id", "recordOrigin", "firmName", "city", "officeCities", "websiteUrl", "practiceAreas", "observedLawyerCount", "observedLawyerCountQualifier", "observedLawyerCountDisplay", "rosterSourceUrl", "rosterCheckedAt", "reconciliationStatus", "legacyClusterLawyerCount", "legacyCrosswalk", "reconciliationNote", "advertisingEvidence", "advertisingSourceUrl", "gbpEvidence", "gbpSourceUrl", "publicContacts"]);
const statuses = new Set<ReconciliationStatus>(["provisional_new", "update_existing", "new_pending_identity", "duplicate", "unresolved"]);
const relationships = new Set<PublicProspectContact["relationship"]>(["owner", "founder", "principal", "named_lawyer", "firm_inbox"]);
const emailKinds = new Set<PublicProspectContact["emailKind"]>(["owner", "named_person", "general_firm"]);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const norm = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(",")}]` : object(value) ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);
export async function sha256(value: unknown): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value))); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
const url = (value: unknown): value is string => { if (!text(value)) return false; try { const parsed = new URL(value); return parsed.protocol === "http:" || parsed.protocol === "https:"; } catch { return false; } };
const date = (value: unknown): value is string => { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [year, month, day] = value.split("-").map(Number); const checked = new Date(Date.UTC(year, month - 1, day)); return checked.getUTCFullYear() === year && checked.getUTCMonth() === month - 1 && checked.getUTCDate() === day; };

function publicContacts(value: unknown, fail: (message: string) => void): PublicProspectContact[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { fail("publicContacts must be an array"); return []; }
  return value.flatMap((candidate, index) => {
    if (!object(candidate) || !relationships.has(candidate.relationship as PublicProspectContact["relationship"])
      || !emailKinds.has(candidate.emailKind as PublicProspectContact["emailKind"])
      || (candidate.name !== null && candidate.name !== undefined && !text(candidate.name))
      || (candidate.email !== null && candidate.email !== undefined && (!text(candidate.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email)))
      || !url(candidate.sourceUrl) || !date(candidate.observedAt)
      || (!text(candidate.name) && !text(candidate.email))) {
      fail(`publicContacts[${index}] is invalid`); return [];
    }
    return [{ name: candidate.name ?? null, relationship: candidate.relationship as PublicProspectContact["relationship"], email: candidate.email ?? null, emailKind: candidate.emailKind as PublicProspectContact["emailKind"], sourceUrl: candidate.sourceUrl, observedAt: candidate.observedAt }];
  });
}

function project(input: unknown): { record: CanonicalRecord | null; issues: ValidationIssue[]; key: string } {
  const key = object(input) && typeof input.id === "string" ? input.id : "<missing-id>";
  const issues: ValidationIssue[] = [];
  const fail = (message: string) => issues.push({ sourceRecordKey: key, message });
  if (!object(input)) { fail("record must be an object"); return { record: null, issues, key }; }
  const unknown = Object.keys(input).filter((item) => !keys.has(item));
  if (unknown.length) fail(`unrecognized fields are forbidden: ${unknown.join(", ")}`);
  if (!text(input.id) || !/^[a-z0-9][a-z0-9-]{1,159}$/.test(input.id)) fail("id must be a stable lowercase source key");
  if (!text(input.firmName)) fail("firmName is required");
  if (!Array.isArray(input.officeCities) || input.officeCities.length === 0 || !input.officeCities.every(text)) fail("at least one office city is required");
  if (input.websiteUrl !== null && input.websiteUrl !== undefined && !url(input.websiteUrl)) fail("websiteUrl must be an http(s) URL when supplied");
  if (!url(input.rosterSourceUrl)) fail("accepted records require a roster source URL");
  if (!date(input.rosterCheckedAt)) fail("accepted records require a roster observation date");
  if (!statuses.has(input.reconciliationStatus as ReconciliationStatus)) fail("reconciliationStatus is invalid");
  if (!text(input.city) || !Array.isArray(input.practiceAreas) || !input.practiceAreas.every(text)) fail("city and practiceAreas must be expected primitive values");
  for (const field of ["observedLawyerCountDisplay", "reconciliationNote", "legacyCrosswalk"] as const) if (input[field] !== null && typeof input[field] !== "string") fail(`${field} must be a nullable string`);
  if (input.legacyClusterLawyerCount !== null && (!Number.isInteger(input.legacyClusterLawyerCount) || Number(input.legacyClusterLawyerCount) < 0)) fail("legacyClusterLawyerCount must be a nullable non-negative integer");
  const qualifier = input.observedLawyerCountQualifier;
  if (qualifier !== "exact" && qualifier !== "at_least" && qualifier !== "unknown") fail("observed lawyer count qualifier is invalid");
  if (qualifier === "unknown" && input.observedLawyerCount !== null) fail("unknown count qualifier requires a null observed lawyer count");
  if ((qualifier === "exact" || qualifier === "at_least") && (!Number.isInteger(input.observedLawyerCount) || Number(input.observedLawyerCount) < 0)) fail("exact and at_least counts require a non-negative integer");
  if (input.advertisingEvidence === "observed" && !url(input.advertisingSourceUrl)) fail("observed advertising requires its source URL");
  if (input.gbpEvidence === "observed" && !url(input.gbpSourceUrl)) fail("observed Google Business Profile evidence requires its source URL");
  const contacts = publicContacts(input.publicContacts, fail);
  if (issues.length) return { record: null, issues, key };
  const sourceUrl = input.rosterSourceUrl as string;
  const observedOn = input.rosterCheckedAt as string;
  const websiteUrl = (input.websiteUrl as string | null) ?? null;
  const firmName = input.firmName as string;
  return { key, issues, record: {
    sourceRecordKey: input.id as string, firmName, normalizedFirmName: norm(firmName), city: input.city as string,
    practiceAreas: [...input.practiceAreas as string[]], legacyCrosswalk: input.legacyCrosswalk as string | null, legacyClusterLawyerCount: input.legacyClusterLawyerCount as number | null, websiteUrl, officeCities: [...input.officeCities as string[]],
    roster: { sourceUrl, observedOn, lawyerCount: input.observedLawyerCount as number | null, qualifier: qualifier as "exact" | "at_least" | "unknown", display: input.observedLawyerCountDisplay as string | null },
    reconciliation: { status: input.reconciliationStatus as ReconciliationStatus, basis: (input.reconciliationNote as string | null) ?? "Status supplied by the reviewed source-controlled record." },
    evidence: [{ type: "roster", sourceUrl, observedOn, value: input.observedLawyerCountDisplay as string | null }, ...(websiteUrl ? [{ type: "website" as const, sourceUrl: websiteUrl, observedOn, value: websiteUrl }] : []), ...(input.advertisingEvidence === "observed" ? [{ type: "advertising" as const, sourceUrl: input.advertisingSourceUrl as string, observedOn, value: null }] : []), ...(input.gbpEvidence === "observed" ? [{ type: "google_business_profile" as const, sourceUrl: input.gbpSourceUrl as string, observedOn, value: null }] : [])],
    publicContacts: contacts,
  } };
}

export async function buildGtaProspectImportPlan(inputs: readonly unknown[]): Promise<GtaProspectImportPlan> {
  const seen = new Set<string>(), accepted: CanonicalRecord[] = [], rejected: GtaProspectImportPlan["rejected"] = [];
  for (const input of inputs) { const result = project(input); if (seen.has(result.key)) result.issues.push({ sourceRecordKey: result.key, message: "duplicate source record key within batch" }); seen.add(result.key); if (result.record && result.issues.length === 0) accepted.push(result.record); else rejected.push({ sourceRecordKey: result.key, issues: result.issues }); }
  return { accepted, rejected, sourceSha256: await sha256(accepted) };
}

/**
 * Classify a validated batch against the current, source-keyed ledger
 * identity set.  This deliberately does not fuzzy-match names, domains, or
 * addresses: a collision on any of those fields is a human review signal,
 * never a merge instruction.  The database is still authoritative at apply
 * time, so a concurrent import cannot turn this advisory plan into a blind
 * overwrite.
 */
export async function reviewGtaProspectImport(
  inputs: readonly unknown[],
  existingSourceRecordKeys: ReadonlySet<string>,
): Promise<GtaProspectImportReviewResult> {
  const plan = await buildGtaProspectImportPlan(inputs);
  const records: GtaProspectImportReview[] = [];

  for (const rejected of plan.rejected) {
    const duplicate = rejected.issues.some((issue) => issue.message === "duplicate source record key within batch");
    records.push({
      sourceRecordKey: rejected.sourceRecordKey,
      disposition: duplicate ? "duplicate" : "invalid",
      reason: duplicate ? "This source record key appears more than once in the uploaded batch." : rejected.issues.map((issue) => issue.message).join(" "),
    });
  }

  for (const record of plan.accepted) {
    if (record.reconciliation.status === "duplicate" || record.reconciliation.status === "new_pending_identity" || record.reconciliation.status === "unresolved") {
      records.push({
        sourceRecordKey: record.sourceRecordKey,
        disposition: "review_required",
        reason: `The reviewed reconciliation status is ${record.reconciliation.status}; it cannot be applied automatically.`,
      });
      continue;
    }
    if (existingSourceRecordKeys.has(record.sourceRecordKey)) {
      records.push({
        sourceRecordKey: record.sourceRecordKey,
        disposition: "update",
        reason: "This stable source record key already exists in the governed research ledger. The database will preserve blank optional fields and append source-backed observations.",
      });
      continue;
    }
    records.push({ sourceRecordKey: record.sourceRecordKey, disposition: "new", reason: "No matching stable source record key exists in the governed research ledger." });
  }

  records.sort((left, right) => left.sourceRecordKey.localeCompare(right.sourceRecordKey, "en-CA"));
  const count = (disposition: GtaProspectImportDisposition) => records.filter((record) => record.disposition === disposition).length;
  return {
    plan,
    records: Object.freeze(records),
    summary: Object.freeze({
      received: inputs.length,
      eligibleForApply: count("new") + count("update"),
      new: count("new"),
      update: count("update"),
      duplicate: count("duplicate"),
      reviewRequired: count("review_required"),
      invalid: count("invalid"),
    }),
  };
}
export type GtaProspectImportWriter = { apply(plan: GtaProspectImportPlan): Promise<void> };
export async function executeGtaProspectImport({ plan, dryRun, operatorAuthorized, writer }: { plan: GtaProspectImportPlan; dryRun: boolean; operatorAuthorized: boolean; writer: GtaProspectImportWriter }) {
  if (dryRun) return { state: "dry_run" as const, plan };
  if (!operatorAuthorized) return { state: "unauthorized" as const, plan };
  if (plan.rejected.length) return { state: "rejected" as const, plan };
  await writer.apply(plan); return { state: "applied" as const, plan };
}
