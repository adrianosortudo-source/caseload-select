import {
  prospectEnrichmentProtocolHash,
  prospectEnrichmentSemanticSha256,
  stableProspectEnrichmentJson,
  type ProspectEnrichmentJsonValue,
} from "@/lib/prospect-enrichment-hash";

export type JsonValue = ProspectEnrichmentJsonValue;
export const PROSPECT_ENRICHMENT_SCHEMA_VERSION = "prospect-enrichment/v1" as const;
export const PROSPECT_ENRICHMENT_MAX_BODY_BYTES = 2_097_152;
export const PROSPECT_ENRICHMENT_MAX_ITEMS = 500;
export const PROSPECT_ENRICHMENT_MAX_DEPTH = 12;
export const PROSPECT_ENRICHMENT_MAX_STRING_BYTES = 65_536;

export const PROSPECT_ENRICHMENT_GATES = ["pass", "fail", "unknown"] as const;
export type ProspectEnrichmentGate = (typeof PROSPECT_ENRICHMENT_GATES)[number];
export const PROSPECT_ENRICHMENT_KINDS = ["firm_fit", "service", "contact", "advertising", "opportunity", "website_intake", "roster", "research_attempt"] as const;
export type ProspectEnrichmentKind = (typeof PROSPECT_ENRICHMENT_KINDS)[number];

export type ProspectEnrichmentSource = Readonly<{
  sourceId: string;
  url: string | null;
  requestedUrl: string | null;
  finalUrl: string | null;
  policyState: "public-source" | "policy-blocked" | "legacy-unknown";
  publicationLabel: string | null;
  publicationPrecision: "exact_date" | "year" | "unknown";
  publisher: string | null;
  observedAt: string | null;
  observedOn: string | null;
  retrievedAt: string | null;
  retrievalMethod: string;
  retrievalOutcome: string;
  httpStatus: number | null;
  bodySha256: string | null;
  excerpt: string | null;
  missingProvenanceReason: string | null;
}>;

export type ProspectEnrichmentObservationData = Readonly<{
  firm_fit: { practiceAreas: string[]; office: { city: string | null; province: string | null; address: string | null }; lawyerCount: number | null; countQualifier: "exact" | "at_least" | "unknown"; independence: "independent" | "network-affiliated" | "branch-office" | "unknown"; fit: ProspectEnrichmentGate };
  service: { name: string; matterFit: "strong-match" | "partial-match" | "no-match" | "unknown" };
  contact: { personName: string | null; roleLabel: string | null; roleVerification: "first-party" | "reputable-directory" | "unverified" | "not-observed"; contactType: "verified-direct-email" | "public-named-email" | "general-inbox" | "phone" | "contact-form" | "not-observed"; contactValue: string | null; contactQuality: "verified-direct" | "published-direct-unverified" | "general-route" | "not-observed"; deliverability: "verified" | "not-tested" | "failed" | "not-applicable"; roleSourceIds: string[] };
  advertising: { evidenceType: "advertising-pixel" | "direct-ad" | "sponsored-placement" | "historical-ad"; vendor: string | null; signalType: string | null; signalId: string | null; advertiserIdentity: string | null; advertisedService: string | null; destinationUrl: string | null; effectiveDate: string | null; lastShownDate: string | null; recencyBasis: string | null; identityState: "confirmed" | "unresolved" | "conflict"; attributable: boolean; configured: boolean | null; fired: boolean | null };
  opportunity: { type: "advertising-verification-gap" | "landing-page-message-gap" | "service-routing-gap" | "intake-context-gap" | "local-discovery-gap" | "other"; observation: string; interpretation: string; recommendation: string; strengths: string[]; unknowns: string[]; confidence: "high" | "medium" | "low" };
  website_intake: { pageUrl: string; visibleChannels: string[]; visibleFields: string[]; opportunityState: "supported" | "not_established"; summary: string; observation: string; interpretation: string; recommendation: string | null; unknowns: string[] };
  roster: { lawyerCount: number | null; countQualifier: "exact" | "at_least" | "unknown"; display: string; includedNames: string[]; excludedPeople: { name: string; reason: string }[] };
  research_attempt: { provider: string; queryOrUrl: string; outcome: string; coverage: "complete" | "partial" | "failed" | "not-run"; failureReason: string | null };
}>;

export type ProspectEnrichmentObservation = {
  [K in ProspectEnrichmentKind]: Readonly<{
    observationId: string;
    evidenceState: "asserted" | "retracted";
    retractionReason: string | null;
    retractionSourceIds: string[];
    missingProvenanceReason: string | null;
    kind: K;
    observedAt: string | null;
    observedOn: string | null;
    sourceIds: string[];
    data: ProspectEnrichmentObservationData[K];
    existingRecord: ProspectEnrichmentExistingRecord | null;
  }>;
}[ProspectEnrichmentKind];

export type ProspectEnrichmentAssessment = Readonly<{
  assessmentId: string;
  cohortId: string;
  ruleVersion: string;
  assessedAt: string | null;
  assessedOn: string | null;
  missingProvenanceReason: string | null;
  researchOutcome: "complete" | "partial" | "blocked" | "error" | "not_run" | "unknown";
  advertisingStatus: "pixels-detected" | "recent-ad-verified" | "historical-ad-only" | "not-observed" | null;
  advertisingStatusState: "current" | "stale" | "unknown";
  fitDecision: ProspectEnrichmentGate;
  commercialRelevance: "strong-match" | "partial-match" | "no-match" | "unknown";
  decisionMakerAccess: ProspectEnrichmentGate;
  opportunityDecision: ProspectEnrichmentGate;
  selectionDisposition: "selected" | "eligible-not-selected" | "verification-required" | "policy-hold" | "technical-hold" | "disqualified";
  missingGates: string[];
  researchFailures: { sourceId: string | null; outcome: string; reason: string; nextAction: string | null }[];
  rationale: string;
  sourceIds: string[];
  legacyCriteria: { [key: string]: JsonValue };
  existingRecord: ProspectEnrichmentExistingRecord | null;
}>;

export type ProspectEnrichmentExistingRecord = Readonly<{
  table: string;
  id: string;
  rowSha256: string;
}>;

export type ProspectEnrichmentEnvelope = Readonly<{
  schemaVersion: typeof PROSPECT_ENRICHMENT_SCHEMA_VERSION;
  runId: string;
  packageId: string;
  supersedesPackageId: string | null;
  sourceSystem: string;
  sourceName: string;
  generatedAt: string;
  mode: "propose" | "link_existing";
  subject: Readonly<{
    researchKey: string;
    databaseFirmId: string | null;
    stableFirmId: string | null;
    sourceRecordKey: string | null;
    canonicalDomain: string | null;
    displayName: string;
    identityState: "resolved" | "unresolved" | "conflict";
  }>;
  sources: readonly ProspectEnrichmentSource[];
  observations: readonly ProspectEnrichmentObservation[];
  assessment: ProspectEnrichmentAssessment | null;
  originalResearch: Readonly<{
    sourcePath: string;
    sourceSha256: string;
    sourcePointer: string;
    contentSha256: string;
    content: JsonValue;
    unmappedPaths: readonly string[];
  }>;
  controls: Readonly<{ contactFormsSubmitted: false; chatSessionsStarted: false; outreachSent: false }>;
}>;

export type ProspectEnrichmentClientLineageItem = Readonly<{
  clientItemId: string;
  itemKind: "source" | "observation" | "assessment";
  sourceEventKey: string;
  semanticSha256: string;
}>;

function semanticSource(source: ProspectEnrichmentSource): JsonValue {
  const { sourceId: _sourceId, ...semantic } = source;
  return semantic as JsonValue;
}

/**
 * One deterministic lineage compiler is shared by the API store and offline
 * adapter. Observation hashes include the cited source content and its dates,
 * while source IDs remain explicit edges in the semantic item.
 */
export function buildProspectEnrichmentClientItems(envelope: ProspectEnrichmentEnvelope): ProspectEnrichmentClientLineageItem[] {
  const sources = new Map(envelope.sources.map((source) => [source.sourceId, source]));
  const sourceContent = (ids: readonly string[]): JsonValue[] => ids.flatMap((id) => {
    const source = sources.get(id);
    return source ? [semanticSource(source)] : [];
  });
  return [
    ...envelope.sources.map((source) => {
      const semantic = semanticSource(source);
      return {
        clientItemId: `src:${source.sourceId}`,
        itemKind: "source" as const,
        sourceEventKey: `source:${prospectEnrichmentProtocolHash([envelope.subject.researchKey, `src:${source.sourceId}`])}`,
        semanticSha256: prospectEnrichmentSemanticSha256({ sourceSystem: envelope.sourceSystem, researchKey: envelope.subject.researchKey, itemKind: "source", semanticContent: semantic }),
      };
    }),
    ...envelope.observations.map((observation) => {
      const { observationId: _observationId, existingRecord: _existingRecord, ...fields } = observation;
      const semantic = { ...fields, sourceContent: sourceContent(observation.sourceIds), retractionSourceContent: sourceContent(observation.retractionSourceIds) } as JsonValue;
      return {
        clientItemId: `obs:${observation.observationId}`,
        itemKind: "observation" as const,
        sourceEventKey: `observation:${prospectEnrichmentProtocolHash([envelope.subject.researchKey, `obs:${observation.observationId}`])}`,
        semanticSha256: prospectEnrichmentSemanticSha256({ sourceSystem: envelope.sourceSystem, researchKey: envelope.subject.researchKey, itemKind: "observation", semanticContent: semantic }),
      };
    }),
    ...(envelope.assessment ? [(() => {
      const { assessmentId: _assessmentId, existingRecord: _existingRecord, ...fields } = envelope.assessment!;
      const semantic = { ...fields, sourceContent: sourceContent(envelope.assessment!.sourceIds) } as JsonValue;
      return {
        clientItemId: `assessment:${envelope.assessment!.assessmentId}`,
        itemKind: "assessment" as const,
        sourceEventKey: `assessment:${prospectEnrichmentProtocolHash([envelope.subject.researchKey, `assessment:${envelope.assessment!.assessmentId}`])}`,
        semanticSha256: prospectEnrichmentSemanticSha256({ sourceSystem: envelope.sourceSystem, researchKey: envelope.subject.researchKey, itemKind: "assessment", semanticContent: semantic }),
      };
    })()] : []),
  ];
}

export type ProspectEnrichmentValidationIssue = Readonly<{ path: string; message: string }>;
export type ProspectEnrichmentValidationResult =
  | Readonly<{ ok: true; envelope: ProspectEnrichmentEnvelope; issues: readonly [] }>
  | Readonly<{ ok: false; envelope: null; issues: readonly ProspectEnrichmentValidationIssue[] }>;

const identifier = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const sourceRecordKey = /^[a-z0-9][a-z0-9-]{1,159}$/;
const sha256 = /^[a-f0-9]{64}$/;
const stableFirmId = /^FIRM-[0-9A-HJKMNP-TV-Z]{26}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const targetTables = new Set([
  "gta_prospect_firms", "gta_prospect_stable_identity_registry", "gta_prospect_import_audit",
  "gta_prospect_supplemental_evidence_import_audit", "gta_prospect_shared_identity_observations",
  "gta_prospect_website_intake_observations", "gta_prospect_qualification_assessments",
  "gta_prospect_roster_observations", "gta_prospect_downtown_geography_observations",
  "gta_prospect_public_contact_observations", "prospect_source_record_map", "prospect_source_captures",
  "prospect_research_attempts", "prospect_advertising_observations", "prospect_qualification_decisions",
  "prospect_firm_fit_observations", "prospect_service_observations", "prospect_decision_maker_contacts",
  "prospect_opportunity_observations",
]);

type Rule =
  | { type: "string"; nullable?: boolean; min?: number; max?: number; format?: "url" | "date" }
  | { type: "number"; nullable?: boolean; min?: number; max?: number; integer?: boolean }
  | { type: "boolean"; nullable?: boolean }
  | { type: "enum"; values: readonly string[]; nullable?: boolean }
  | { type: "array"; item: Rule; unique?: boolean }
  | { type: "object"; fields: Readonly<Record<string, Rule>> };

const string = (nullable = false, max = PROSPECT_ENRICHMENT_MAX_STRING_BYTES, min = 1): Rule => ({ type: "string", nullable, max, min });
const maybeString = (max = PROSPECT_ENRICHMENT_MAX_STRING_BYTES): Rule => string(true, max, 0);
const enumRule = (values: readonly string[], nullable = false): Rule => ({ type: "enum", values, nullable });
const array = (item: Rule, unique = false): Rule => ({ type: "array", item, unique });
const objectRule = (fields: Readonly<Record<string, Rule>>): Rule => ({ type: "object", fields });
const textArray = array(string(), true);
const gateRule = enumRule(PROSPECT_ENRICHMENT_GATES);

const dataRules: Readonly<Record<ProspectEnrichmentKind, Rule>> = {
  firm_fit: objectRule({
    practiceAreas: textArray,
    office: objectRule({ city: maybeString(500), province: maybeString(500), address: maybeString(2000) }),
    lawyerCount: { type: "number", nullable: true, min: 0, integer: true },
    countQualifier: enumRule(["exact", "at_least", "unknown"]),
    independence: enumRule(["independent", "network-affiliated", "branch-office", "unknown"]),
    fit: gateRule,
  }),
  service: objectRule({ name: string(false, 500), matterFit: enumRule(["strong-match", "partial-match", "no-match", "unknown"]) }),
  contact: objectRule({
    personName: maybeString(500), roleLabel: maybeString(500),
    roleVerification: enumRule(["first-party", "reputable-directory", "unverified", "not-observed"]),
    contactType: enumRule(["verified-direct-email", "public-named-email", "general-inbox", "phone", "contact-form", "not-observed"]),
    contactValue: maybeString(2000),
    contactQuality: enumRule(["verified-direct", "published-direct-unverified", "general-route", "not-observed"]),
    deliverability: enumRule(["verified", "not-tested", "failed", "not-applicable"]), roleSourceIds: textArray,
  }),
  advertising: objectRule({
    evidenceType: enumRule(["advertising-pixel", "direct-ad", "sponsored-placement", "historical-ad"]),
    vendor: maybeString(500), signalType: maybeString(500), signalId: maybeString(1000), advertiserIdentity: maybeString(1000),
    advertisedService: maybeString(1000), destinationUrl: { type: "string", nullable: true, max: 2048, min: 0, format: "url" },
    effectiveDate: { type: "string", nullable: true, max: 10, min: 0, format: "date" },
    lastShownDate: { type: "string", nullable: true, max: 10, min: 0, format: "date" },
    recencyBasis: maybeString(1000), identityState: enumRule(["confirmed", "unresolved", "conflict"]), attributable: { type: "boolean" },
    configured: { type: "boolean", nullable: true }, fired: { type: "boolean", nullable: true },
  }),
  opportunity: objectRule({
    type: enumRule(["advertising-verification-gap", "landing-page-message-gap", "service-routing-gap", "intake-context-gap", "local-discovery-gap", "other"]),
    observation: string(), interpretation: string(), recommendation: string(), strengths: textArray, unknowns: textArray,
    confidence: enumRule(["high", "medium", "low"]),
  }),
  website_intake: objectRule({
    pageUrl: { type: "string", max: 2048, min: 1, format: "url" }, visibleChannels: textArray, visibleFields: textArray,
    opportunityState: enumRule(["supported", "not_established"]), summary: string(), observation: string(), interpretation: string(),
    recommendation: maybeString(), unknowns: textArray,
  }),
  roster: objectRule({
    lawyerCount: { type: "number", nullable: true, min: 0, integer: true }, countQualifier: enumRule(["exact", "at_least", "unknown"]),
    display: maybeString(1000), includedNames: textArray,
    excludedPeople: array(objectRule({ name: string(false, 500), reason: string(false, 2000) }), true),
  }),
  research_attempt: objectRule({
    provider: string(false, 500), queryOrUrl: string(false, 2048), outcome: string(false, 500),
    coverage: enumRule(["complete", "partial", "failed", "not-run"]), failureReason: maybeString(2000),
  }),
};

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function add(issues: ProspectEnrichmentValidationIssue[], path: string, message: string) {
  if (issues.length < 100) issues.push({ path, message });
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: ProspectEnrichmentValidationIssue[]) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) add(issues, path ? `${path}.${key}` : key, "unrecognized field is forbidden");
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(value, key)) add(issues, path ? `${path}.${key}` : key, "required field is missing");
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isDateTime(value: string): boolean {
  const datePart = value.slice(0, 10);
  return isDate(datePart) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function inspectJson(value: unknown, path: string, depth: number, ancestors: Set<object>, issues: ProspectEnrichmentValidationIssue[]): boolean {
  if (depth > PROSPECT_ENRICHMENT_MAX_DEPTH) { add(issues, path, "JSON nesting exceeds 12 levels"); return false; }
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) { add(issues, path, "must be a finite JSON number"); return false; }
    return true;
  }
  if (typeof value === "string") {
    if (new TextEncoder().encode(value).byteLength > PROSPECT_ENRICHMENT_MAX_STRING_BYTES) { add(issues, path, "UTF-8 string exceeds 64 KiB"); return false; }
    return true;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) { add(issues, path, "cyclic values are forbidden"); return false; }
    ancestors.add(value);
    let valid = true;
    for (let i = 0; i < value.length; i += 1) {
      if (!(i in value)) { add(issues, `${path}[${i}]`, "sparse array entries are forbidden"); valid = false; continue; }
      valid = inspectJson(value[i], `${path}[${i}]`, depth + 1, ancestors, issues) && valid;
    }
    ancestors.delete(value);
    return valid;
  }
  if (!record(value)) { add(issues, path, "must contain only JSON values and plain objects"); return false; }
  if (ancestors.has(value)) { add(issues, path, "cyclic values are forbidden"); return false; }
  ancestors.add(value);
  let valid = true;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) { add(issues, `${path}.${key}`, "prototype-sensitive property names are forbidden"); valid = false; }
    valid = inspectJson(child, `${path}.${key}`, depth + 1, ancestors, issues) && valid;
  }
  ancestors.delete(value);
  return valid;
}

function nullableString(value: unknown, path: string, issues: ProspectEnrichmentValidationIssue[], max = PROSPECT_ENRICHMENT_MAX_STRING_BYTES, min = 0): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > max || value.length < min || (min > 0 && value.trim().length === 0)) {
    add(issues, path, `must be ${min ? "non-empty " : ""}text${max === PROSPECT_ENRICHMENT_MAX_STRING_BYTES ? "" : ` up to ${max} bytes`} or null`);
    return false;
  }
  return true;
}

function requiredString(value: unknown, path: string, issues: ProspectEnrichmentValidationIssue[], max = PROSPECT_ENRICHMENT_MAX_STRING_BYTES, min = 1): value is string {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > max || value.length < min || (min > 0 && value.trim().length === 0)) {
    add(issues, path, `must be non-empty text${max === PROSPECT_ENRICHMENT_MAX_STRING_BYTES ? "" : ` up to ${max} bytes`}`);
    return false;
  }
  return true;
}

function validateRule(value: unknown, rule: Rule, path: string, issues: ProspectEnrichmentValidationIssue[]): boolean {
  if ("nullable" in rule && rule.nullable && value === null) return true;
  if (rule.type === "string") {
    if (typeof value !== "string") { add(issues, path, "must be text"); return false; }
    let valid = true;
    const maximum = rule.max ?? PROSPECT_ENRICHMENT_MAX_STRING_BYTES;
    const minimum = rule.min ?? 1;
    const bytes = new TextEncoder().encode(value).byteLength;
    if (bytes > maximum) { add(issues, path, `must be at most ${maximum} UTF-8 bytes`); valid = false; }
    if (value.length < minimum || (minimum > 0 && value.trim().length === 0)) { add(issues, path, "must be non-empty text"); valid = false; }
    if (rule.format === "url" && !isHttpUrl(value)) { add(issues, path, "must be an HTTP(S) URL"); valid = false; }
    if (rule.format === "date" && !isDate(value)) { add(issues, path, "must be a valid YYYY-MM-DD date"); valid = false; }
    return valid;
  }
  if (rule.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (rule.integer && !Number.isInteger(value)) || (rule.min !== undefined && value < rule.min) || (rule.max !== undefined && value > rule.max)) {
      add(issues, path, "must be a finite number within the allowed range"); return false;
    }
    return true;
  }
  if (rule.type === "boolean") {
    if (typeof value !== "boolean") { add(issues, path, "must be a boolean"); return false; }
    return true;
  }
  if (rule.type === "enum") {
    if (typeof value !== "string" || !rule.values.includes(value)) { add(issues, path, `must be one of: ${rule.values.join(", ")}`); return false; }
    return true;
  }
  if (rule.type === "array") {
    if (!Array.isArray(value)) { add(issues, path, "must be an array"); return false; }
    let valid = true;
    const seen = new Set<string>();
    value.forEach((item, index) => {
      valid = validateRule(item, rule.item, `${path}[${index}]`, issues) && valid;
      if (rule.unique) {
        try {
          const key = stableProspectEnrichmentJson(item);
          if (seen.has(key)) { add(issues, `${path}[${index}]`, "duplicate array entry is forbidden"); valid = false; }
          seen.add(key);
        } catch { /* inspectJson reports non-JSON values with the path */ }
      }
    });
    return valid;
  }
  if (!record(value)) { add(issues, path, "must be an object"); return false; }
  exactKeys(value, Object.keys(rule.fields), path, issues);
  let valid = true;
  for (const [key, nestedRule] of Object.entries(rule.fields)) valid = validateRule(value[key], nestedRule, `${path}.${key}`, issues) && valid;
  return valid;
}

function parseExistingRecord(value: unknown, path: string, issues: ProspectEnrichmentValidationIssue[]): ProspectEnrichmentExistingRecord | null {
  if (value === null) return null;
  if (!record(value)) { add(issues, path, "must be an object or null"); return null; }
  exactKeys(value, ["table", "id", "rowSha256"], path, issues);
  if (typeof value.table !== "string" || !targetTables.has(value.table)) add(issues, `${path}.table`, "is not an allowed existing evidence target");
  if (typeof value.id !== "string" || !uuid.test(value.id)) add(issues, `${path}.id`, "must be a UUID");
  if (typeof value.rowSha256 !== "string" || !sha256.test(value.rowSha256)) add(issues, `${path}.rowSha256`, "must be a lowercase SHA-256 digest");
  return value as unknown as ProspectEnrichmentExistingRecord;
}

function parseSource(value: unknown, index: number, issues: ProspectEnrichmentValidationIssue[]): ProspectEnrichmentSource | null {
  const path = `sources[${index}]`;
  if (!record(value)) { add(issues, path, "must be an object"); return null; }
  const keys = ["sourceId", "url", "requestedUrl", "finalUrl", "policyState", "publicationLabel", "publicationPrecision", "publisher", "observedAt", "observedOn", "retrievedAt", "retrievalMethod", "retrievalOutcome", "httpStatus", "bodySha256", "excerpt", "missingProvenanceReason"] as const;
  exactKeys(value, keys, path, issues);
  if (typeof value.sourceId !== "string" || !identifier.test(value.sourceId)) add(issues, `${path}.sourceId`, "must be a lowercase stable identifier");
  for (const key of ["url", "requestedUrl", "finalUrl"] as const) {
    if (nullableString(value[key], `${path}.${key}`, issues, 2048) && typeof value[key] === "string" && !isHttpUrl(value[key] as string)) add(issues, `${path}.${key}`, "must be an HTTP(S) URL or null");
  }
  if (!(["public-source", "policy-blocked", "legacy-unknown"] as unknown[]).includes(value.policyState)) add(issues, `${path}.policyState`, "has an unsupported policy state");
  if (value.publicationLabel !== null) requiredString(value.publicationLabel, `${path}.publicationLabel`, issues, 500);
  if (!(["exact_date", "year", "unknown"] as unknown[]).includes(value.publicationPrecision)) add(issues, `${path}.publicationPrecision`, "has an unsupported precision");
  if (!nullableString(value.publisher, `${path}.publisher`, issues, 500)) { /* issue recorded */ }
  for (const key of ["observedAt", "retrievedAt"] as const) {
    if (value[key] !== null && (typeof value[key] !== "string" || !isDateTime(value[key]))) add(issues, `${path}.${key}`, "must be a valid RFC3339 timestamp with timezone or null");
  }
  if (value.observedOn !== null && (typeof value.observedOn !== "string" || !isDate(value.observedOn))) add(issues, `${path}.observedOn`, "must be a valid YYYY-MM-DD date or null");
  if (value.observedAt !== null && value.observedOn !== null) add(issues, path, "observedAt and observedOn are mutually exclusive");
  if (value.observedAt === null && value.observedOn === null && !requiredString(value.missingProvenanceReason, `${path}.missingProvenanceReason`, issues, 2000)) { /* issue recorded */ }
  if (!requiredString(value.retrievalMethod, `${path}.retrievalMethod`, issues, 200)) { /* issue recorded */ }
  if (!requiredString(value.retrievalOutcome, `${path}.retrievalOutcome`, issues, 200)) { /* issue recorded */ }
  if (value.httpStatus !== null && (typeof value.httpStatus !== "number" || !Number.isInteger(value.httpStatus) || value.httpStatus < 100 || value.httpStatus > 599)) add(issues, `${path}.httpStatus`, "must be an HTTP status code or null");
  if (value.bodySha256 !== null && (typeof value.bodySha256 !== "string" || !sha256.test(value.bodySha256))) add(issues, `${path}.bodySha256`, "must be a lowercase SHA-256 digest or null");
  if (!nullableString(value.excerpt, `${path}.excerpt`, issues, 4000)) { /* issue recorded */ }
  if (!nullableString(value.missingProvenanceReason, `${path}.missingProvenanceReason`, issues, 2000)) { /* issue recorded */ }
  return value as unknown as ProspectEnrichmentSource;
}

const dispositionValues = ["selected", "eligible-not-selected", "verification-required", "policy-hold", "technical-hold", "disqualified"] as const;
const researchOutcomes = ["complete", "partial", "blocked", "error", "not_run", "unknown"] as const;
const adStatuses = ["pixels-detected", "recent-ad-verified", "historical-ad-only", "not-observed"] as const;

function parseAssessment(value: unknown, sourceIds: ReadonlySet<string>, issues: ProspectEnrichmentValidationIssue[]): ProspectEnrichmentAssessment | null {
  if (value === null) return null;
  const path = "assessment";
  if (!record(value)) { add(issues, path, "must be an object or null"); return null; }
  exactKeys(value, ["assessmentId", "cohortId", "ruleVersion", "assessedAt", "assessedOn", "missingProvenanceReason", "researchOutcome", "advertisingStatus", "advertisingStatusState", "fitDecision", "commercialRelevance", "decisionMakerAccess", "opportunityDecision", "selectionDisposition", "missingGates", "researchFailures", "rationale", "sourceIds", "legacyCriteria", "existingRecord"], path, issues);
  if (typeof value.assessmentId !== "string" || !identifier.test(value.assessmentId)) add(issues, `${path}.assessmentId`, "must be a lowercase stable identifier");
  for (const key of ["cohortId", "ruleVersion"] as const) requiredString(value[key], `${path}.${key}`, issues, 120);
  if (value.assessedAt !== null && (typeof value.assessedAt !== "string" || !isDateTime(value.assessedAt))) add(issues, `${path}.assessedAt`, "must be an RFC3339 timestamp with timezone or null");
  if (value.assessedOn !== null && (typeof value.assessedOn !== "string" || !isDate(value.assessedOn))) add(issues, `${path}.assessedOn`, "must be a valid YYYY-MM-DD date or null");
  if (value.assessedAt !== null && value.assessedOn !== null) add(issues, path, "assessedAt and assessedOn are mutually exclusive");
  if (value.assessedAt === null && value.assessedOn === null) requiredString(value.missingProvenanceReason, `${path}.missingProvenanceReason`, issues, 2000);
  if (!researchOutcomes.includes(value.researchOutcome as typeof researchOutcomes[number])) add(issues, `${path}.researchOutcome`, "has an unsupported research outcome");
  if (value.advertisingStatus !== null && !adStatuses.includes(value.advertisingStatus as typeof adStatuses[number])) add(issues, `${path}.advertisingStatus`, "has an unsupported advertising status");
  if (!(["current", "stale", "unknown"] as unknown[]).includes(value.advertisingStatusState)) add(issues, `${path}.advertisingStatusState`, "has an unsupported advertising status state");
  for (const key of ["fitDecision", "decisionMakerAccess", "opportunityDecision"] as const) if (!PROSPECT_ENRICHMENT_GATES.includes(value[key] as ProspectEnrichmentGate)) add(issues, `${path}.${key}`, "has an unsupported decision gate");
  if (!(["strong-match", "partial-match", "no-match", "unknown"] as unknown[]).includes(value.commercialRelevance)) add(issues, `${path}.commercialRelevance`, "has an unsupported relevance");
  if (!dispositionValues.includes(value.selectionDisposition as typeof dispositionValues[number])) add(issues, `${path}.selectionDisposition`, "has an unsupported disposition");
  if (!Array.isArray(value.missingGates) || value.missingGates.some((item) => typeof item !== "string" || !item.trim()) || new Set(value.missingGates).size !== value.missingGates.length) add(issues, `${path}.missingGates`, "must be an array of unique non-empty strings");
  if (!Array.isArray(value.researchFailures)) add(issues, `${path}.researchFailures`, "must be an array");
  else value.researchFailures.forEach((failure, index) => {
    const failurePath = `${path}.researchFailures[${index}]`;
    if (!record(failure)) { add(issues, failurePath, "must be an object"); return; }
    exactKeys(failure, ["sourceId", "outcome", "reason", "nextAction"], failurePath, issues);
    if (failure.sourceId !== null && (typeof failure.sourceId !== "string" || !sourceIds.has(failure.sourceId))) add(issues, `${failurePath}.sourceId`, "must be null or reference a source in this envelope");
    requiredString(failure.outcome, `${failurePath}.outcome`, issues, 200);
    requiredString(failure.reason, `${failurePath}.reason`, issues, 2000);
    nullableString(failure.nextAction, `${failurePath}.nextAction`, issues, 1000);
  });
  requiredString(value.rationale, `${path}.rationale`, issues, 10_000);
  const seen = new Set<string>();
  if (!Array.isArray(value.sourceIds)) add(issues, `${path}.sourceIds`, "must be an array");
  else value.sourceIds.forEach((id, index) => {
    if (typeof id !== "string" || !sourceIds.has(id)) add(issues, `${path}.sourceIds[${index}]`, "must reference a source in this envelope");
    if (typeof id === "string" && seen.has(id)) add(issues, `${path}.sourceIds[${index}]`, "duplicate source reference");
    if (typeof id === "string") seen.add(id);
  });
  if (!record(value.legacyCriteria)) add(issues, `${path}.legacyCriteria`, "must be an object");
  const existingRecord = parseExistingRecord(value.existingRecord, `${path}.existingRecord`, issues);
  return { ...value, existingRecord } as unknown as ProspectEnrichmentAssessment;
}

function parseObservation(value: unknown, index: number, sourceIds: ReadonlySet<string>, issues: ProspectEnrichmentValidationIssue[]): ProspectEnrichmentObservation | null {
  const path = `observations[${index}]`;
  if (!record(value)) { add(issues, path, "must be an object"); return null; }
  exactKeys(value, ["observationId", "evidenceState", "retractionReason", "retractionSourceIds", "missingProvenanceReason", "kind", "observedAt", "observedOn", "sourceIds", "data", "existingRecord"], path, issues);
  if (typeof value.observationId !== "string" || !identifier.test(value.observationId)) add(issues, `${path}.observationId`, "must be a lowercase stable identifier");
  if (value.evidenceState !== "asserted" && value.evidenceState !== "retracted") add(issues, `${path}.evidenceState`, "must be asserted or retracted");
  nullableString(value.retractionReason, `${path}.retractionReason`, issues, 2000);
  nullableString(value.missingProvenanceReason, `${path}.missingProvenanceReason`, issues, 2000);
  if (value.observedAt !== null && (typeof value.observedAt !== "string" || !isDateTime(value.observedAt))) add(issues, `${path}.observedAt`, "must be an RFC3339 timestamp with timezone or null");
  if (value.observedOn !== null && (typeof value.observedOn !== "string" || !isDate(value.observedOn))) add(issues, `${path}.observedOn`, "must be a valid YYYY-MM-DD date or null");
  if (value.observedAt !== null && value.observedOn !== null) add(issues, path, "observedAt and observedOn are mutually exclusive");
  if (value.observedAt === null && value.observedOn === null) requiredString(value.missingProvenanceReason, `${path}.missingProvenanceReason`, issues, 2000);
  const refs: string[] = [];
  if (!Array.isArray(value.sourceIds)) add(issues, `${path}.sourceIds`, "must be an array");
  else {
    const seen = new Set<string>();
    value.sourceIds.forEach((id, sourceIndex) => {
      if (typeof id !== "string" || !sourceIds.has(id)) add(issues, `${path}.sourceIds[${sourceIndex}]`, "must reference a source in this envelope");
      if (typeof id === "string" && seen.has(id)) add(issues, `${path}.sourceIds[${sourceIndex}]`, "duplicate source reference");
      if (typeof id === "string") { seen.add(id); refs.push(id); }
    });
  }
  if (!Array.isArray(value.retractionSourceIds)) add(issues, `${path}.retractionSourceIds`, "must be an array");
  else {
    const seen = new Set<string>();
    value.retractionSourceIds.forEach((id, sourceIndex) => {
      if (typeof id !== "string" || !sourceIds.has(id)) add(issues, `${path}.retractionSourceIds[${sourceIndex}]`, "must reference a source in this envelope");
      if (typeof id === "string" && seen.has(id)) add(issues, `${path}.retractionSourceIds[${sourceIndex}]`, "duplicate source reference");
      if (typeof id === "string") { seen.add(id); if (!refs.includes(id)) add(issues, `${path}.retractionSourceIds[${sourceIndex}]`, "must also be present in sourceIds"); }
    });
  }
  if (value.evidenceState === "asserted") {
    if (value.retractionReason !== null || (Array.isArray(value.retractionSourceIds) && value.retractionSourceIds.length !== 0)) add(issues, path, "asserted evidence cannot contain retraction details");
  } else if (value.evidenceState === "retracted") {
    if (!requiredString(value.retractionReason, `${path}.retractionReason`, issues, 2000)) { /* issue recorded */ }
    if (Array.isArray(value.retractionSourceIds) && value.retractionSourceIds.length === 0 && !(typeof value.missingProvenanceReason === "string" && value.missingProvenanceReason.trim())) add(issues, path, "retracted evidence needs supporting sources or a missing-provenance reason");
  }
  if (typeof value.kind !== "string" || !(PROSPECT_ENRICHMENT_KINDS as readonly string[]).includes(value.kind)) add(issues, `${path}.kind`, "has an unsupported observation kind");
  else {
    validateRule(value.data, dataRules[value.kind as ProspectEnrichmentKind], `${path}.data`, issues);
    if ((value.kind === "roster" || value.kind === "firm_fit") && record(value.data)) {
      const count = value.data.lawyerCount;
      const qualifier = value.data.countQualifier;
      if (count === null && qualifier !== "unknown") add(issues, `${path}.data.lawyerCount`, "a missing lawyer count requires countQualifier unknown");
      if (typeof count === "number" && qualifier === "unknown") add(issues, `${path}.data.countQualifier`, "unknown countQualifier requires a null lawyer count");
    }
  }
  if (value.kind === "contact" && record(value.data) && Array.isArray(value.data.roleSourceIds)) {
    for (const [sourceIndex, id] of value.data.roleSourceIds.entries()) if (typeof id !== "string" || !refs.includes(id)) add(issues, `${path}.data.roleSourceIds[${sourceIndex}]`, "must reference one of this observation's sourceIds");
  }
  const existingRecord = parseExistingRecord(value.existingRecord, `${path}.existingRecord`, issues);
  return { ...value, existingRecord } as unknown as ProspectEnrichmentObservation;
}

function parseEnvelopeObject(value: Record<string, unknown>, issues: ProspectEnrichmentValidationIssue[]): ProspectEnrichmentEnvelope | null {
  exactKeys(value, ["schemaVersion", "runId", "packageId", "supersedesPackageId", "sourceSystem", "sourceName", "generatedAt", "mode", "subject", "sources", "observations", "assessment", "originalResearch", "controls"], "", issues);
  if (value.schemaVersion !== PROSPECT_ENRICHMENT_SCHEMA_VERSION) add(issues, "schemaVersion", "must equal prospect-enrichment/v1");
  for (const key of ["runId", "packageId", "sourceSystem", "sourceName"] as const) {
    if (typeof value[key] !== "string" || !identifier.test(value[key] as string)) add(issues, key, "must be a lowercase stable identifier of at most 120 characters");
  }
  if (value.supersedesPackageId !== null && (typeof value.supersedesPackageId !== "string" || !identifier.test(value.supersedesPackageId))) add(issues, "supersedesPackageId", "must be null or a lowercase stable identifier");
  if (typeof value.supersedesPackageId === "string" && value.supersedesPackageId === value.packageId) add(issues, "supersedesPackageId", "cannot reference the package itself");
  if (typeof value.generatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.generatedAt) || !Number.isFinite(Date.parse(value.generatedAt))) add(issues, "generatedAt", "must be a UTC RFC3339 timestamp ending in Z");
  if (value.mode !== "propose" && value.mode !== "link_existing") add(issues, "mode", "must be propose or link_existing");
  if (!record(value.subject)) add(issues, "subject", "must be an object");
  else {
    exactKeys(value.subject, ["researchKey", "databaseFirmId", "stableFirmId", "sourceRecordKey", "canonicalDomain", "displayName", "identityState"], "subject", issues);
    requiredString(value.subject.researchKey, "subject.researchKey", issues, 2000);
    if (value.subject.databaseFirmId !== null && (typeof value.subject.databaseFirmId !== "string" || !uuid.test(value.subject.databaseFirmId))) add(issues, "subject.databaseFirmId", "must be a UUID or null");
    if (value.subject.stableFirmId !== null && (typeof value.subject.stableFirmId !== "string" || !stableFirmId.test(value.subject.stableFirmId))) add(issues, "subject.stableFirmId", "must be a FIRM-ULID or null");
    if (value.subject.sourceRecordKey !== null && (typeof value.subject.sourceRecordKey !== "string" || !sourceRecordKey.test(value.subject.sourceRecordKey))) add(issues, "subject.sourceRecordKey", "must be a stable lowercase source key or null");
    nullableString(value.subject.canonicalDomain, "subject.canonicalDomain", issues, 253);
    requiredString(value.subject.displayName, "subject.displayName", issues, 500);
    if (!(["resolved", "unresolved", "conflict"] as unknown[]).includes(value.subject.identityState)) add(issues, "subject.identityState", "must be resolved, unresolved or conflict");
  }
  let sources: ProspectEnrichmentSource[] = [];
  if (!Array.isArray(value.sources) || value.sources.length > PROSPECT_ENRICHMENT_MAX_ITEMS) add(issues, "sources", "must be an array with at most 500 entries");
  else {
    sources = value.sources.map((source, index) => parseSource(source, index, issues)).filter((source): source is ProspectEnrichmentSource => source !== null);
    const ids = sources.map((source) => source.sourceId);
    if (new Set(ids).size !== ids.length) add(issues, "sources", "sourceId values must be unique");
  }
  const sourceIdSet = new Set(sources.map((source) => source.sourceId));
  let observations: ProspectEnrichmentObservation[] = [];
  if (!Array.isArray(value.observations) || value.observations.length > PROSPECT_ENRICHMENT_MAX_ITEMS) add(issues, "observations", "must be an array with at most 500 entries");
  else {
    observations = value.observations.map((item, index) => parseObservation(item, index, sourceIdSet, issues)).filter((item): item is ProspectEnrichmentObservation => item !== null);
    const ids = observations.map((item) => item.observationId);
    if (new Set(ids).size !== ids.length) add(issues, "observations", "observationId values must be unique");
  }
  const assessment = parseAssessment(value.assessment, sourceIdSet, issues);
  if (!record(value.originalResearch)) add(issues, "originalResearch", "must be an object");
  let originalResearch: ProspectEnrichmentEnvelope["originalResearch"] | null = null;
  if (record(value.originalResearch)) {
    exactKeys(value.originalResearch, ["sourcePath", "sourceSha256", "sourcePointer", "contentSha256", "content", "unmappedPaths"], "originalResearch", issues);
    requiredString(value.originalResearch.sourcePath, "originalResearch.sourcePath", issues, 2000);
    if (typeof value.originalResearch.sourceSha256 !== "string" || !sha256.test(value.originalResearch.sourceSha256)) add(issues, "originalResearch.sourceSha256", "must be a lowercase SHA-256 digest");
    if (typeof value.originalResearch.sourcePointer !== "string" || value.originalResearch.sourcePointer.length > 2000) add(issues, "originalResearch.sourcePointer", "must be a source pointer up to 2000 characters");
    if (typeof value.originalResearch.contentSha256 !== "string" || !sha256.test(value.originalResearch.contentSha256)) add(issues, "originalResearch.contentSha256", "must be a lowercase SHA-256 digest");
    if (!Array.isArray(value.originalResearch.unmappedPaths)) add(issues, "originalResearch.unmappedPaths", "must be an array");
    else {
      const paths = value.originalResearch.unmappedPaths;
      if (paths.some((path) => typeof path !== "string" || !path.startsWith("/")) || new Set(paths).size !== paths.length) add(issues, "originalResearch.unmappedPaths", "must contain unique RFC 6901 pointers");
      if (paths.some((path, index) => index > 0 && typeof path === "string" && typeof paths[index - 1] === "string" && (paths[index - 1] as string) > path)) add(issues, "originalResearch.unmappedPaths", "must be sorted lexicographically");
    }
    try {
      const contentHash = prospectEnrichmentProtocolHash(value.originalResearch.content);
      if (contentHash !== value.originalResearch.contentSha256) add(issues, "originalResearch.contentSha256", "does not match the protocol hash of content");
    } catch { add(issues, "originalResearch.content", "must be a JSON value that can be canonically hashed"); }
    originalResearch = value.originalResearch as unknown as ProspectEnrichmentEnvelope["originalResearch"];
  }
  if (!record(value.controls)) add(issues, "controls", "must be an object");
  else {
    exactKeys(value.controls, ["contactFormsSubmitted", "chatSessionsStarted", "outreachSent"], "controls", issues);
    for (const control of ["contactFormsSubmitted", "chatSessionsStarted", "outreachSent"] as const) if (value.controls[control] !== false) add(issues, `controls.${control}`, "must be false for this no-contact adapter");
  }
  if (!observations.length && assessment === null && (!record(value.originalResearch) || value.originalResearch.content === null)) add(issues, "package", "requires an observation, assessment, or non-null originalResearch.content");
  try {
    if (new TextEncoder().encode(stableProspectEnrichmentJson(value)).byteLength > PROSPECT_ENRICHMENT_MAX_BODY_BYTES) add(issues, "package", "canonical envelope exceeds the 2 MiB limit");
  } catch { /* recursive inspection above provides the specific issue */ }
  if (issues.length || originalResearch === null) return null;
  return value as unknown as ProspectEnrichmentEnvelope;
}

export function parseProspectEnrichmentEnvelope(input: unknown): ProspectEnrichmentValidationResult {
  const issues: ProspectEnrichmentValidationIssue[] = [];
  inspectJson(input, "package", 0, new Set(), issues);
  if (!record(input)) {
    add(issues, "package", "must be a plain JSON object");
    return { ok: false, envelope: null, issues };
  }
  const envelope = parseEnvelopeObject(input, issues);
  if (!envelope || issues.length) return { ok: false, envelope: null, issues };
  return { ok: true, envelope, issues: [] };
}
