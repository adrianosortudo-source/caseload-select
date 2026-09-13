import { sha256 } from "@/lib/gta-prospect-research-import";

export const GTA_PROSPECT_EVIDENCE_PACKAGE_TYPE = "caseload-select.prospect-evidence";
export const GTA_PROSPECT_EVIDENCE_PACKAGE_VERSION = 1 as const;
export const PROSPECT_EVIDENCE_SOURCE_KINDS = ["first_party", "public_regulator", "google_ads_transparency", "google_business_profile", "official_geospatial", "other_public"] as const;
export type ProspectEvidenceSourceKind = (typeof PROSPECT_EVIDENCE_SOURCE_KINDS)[number];
export const WEBSITE_INTAKE_CHANNELS = ["phone", "email", "contact_form", "booking", "live_chat", "client_portal", "other_visible_channel"] as const;
export type WebsiteIntakeChannel = (typeof WEBSITE_INTAKE_CHANNELS)[number];
export const WEBSITE_INTAKE_OPPORTUNITY_STATES = ["supported", "not_established"] as const;
export type WebsiteIntakeOpportunityState = (typeof WEBSITE_INTAKE_OPPORTUNITY_STATES)[number];
export const QUALIFICATION_STATES = ["qualified", "needs_evidence", "disqualified"] as const;
export type QualificationState = (typeof QUALIFICATION_STATES)[number];

export type ProspectEvidenceObservation = Readonly<{ evidenceId: string; sourceUrl: string; observedOn: string; sourceKind: ProspectEvidenceSourceKind; note: string | null }>;
export type ProspectIdentityMapping = Readonly<{ sourceRecordKey: string; mappingId: string; matchState: "confirmed" | "unresolved" | "distinct"; firmId: string | null; candidateFirmIds: readonly string[]; distinctFromFirmIds: readonly string[]; canonicalDomain: string | null; firmName: string; confidence: "high" | "moderate" | "unknown"; observedOn: string; reason: string; evidenceIds: readonly string[] }>;
export type ProspectDowntownGeographyObservation = Readonly<{ observationId: string; evidenceIds: readonly string[]; geography: Readonly<{ sourceRecordKey: string; boundaryId: "toronto-downtown-secondary-plan-41"; status: "inside" | "outside" | "needs_manual_review"; normalizedAddress: string; latitude: number | null; longitude: number | null; coordinateSourceType: "toronto_one_address_repository" | "reviewed_geocoder" | "reviewed_firm_website" | "manual_review" | null; coordinateSourceUrl: string | null; boundarySourceUrl: string; boundaryGeometrySha256: string; observedOn: string; confidence: "high" | "moderate" | "unknown"; note: string | null }> }>;
export type ProspectWebsiteIntakeFinding = Readonly<{ sourceRecordKey: string; observationId: string; websiteUrl: string; observedOn: string; visibleIntakeChannels: readonly WebsiteIntakeChannel[]; opportunityState: WebsiteIntakeOpportunityState; opportunityReason: string | null; note: string | null; evidenceIds: readonly string[] }>;
export type ProspectQualificationAssessment = Readonly<{ sourceRecordKey: string; assessmentId: string; assessedOn: string; state: QualificationState; criteria: Readonly<{ rosterWithinOneToTen: boolean; downtownPlan41: boolean; sharedFirmIdentity: boolean; ownerDirectEmail: boolean; observableAdvertisingActivity: boolean; gbpOpportunity: boolean; websiteIntake: boolean }>; rationale: string; evidenceIds: readonly string[] }>;
export type GtaProspectEvidencePackage = Readonly<{ packageType: typeof GTA_PROSPECT_EVIDENCE_PACKAGE_TYPE; packageVersion: typeof GTA_PROSPECT_EVIDENCE_PACKAGE_VERSION; packageId: string; generatedAt: string; controls: Readonly<{ contactFormsSubmitted: false; chatSessionsStarted: false; outreachSent: false }>; evidence: readonly ProspectEvidenceObservation[]; identityMappings: readonly ProspectIdentityMapping[]; downtownGeography: readonly ProspectDowntownGeographyObservation[]; websiteIntakeFindings: readonly ProspectWebsiteIntakeFinding[]; qualificationAssessments: readonly ProspectQualificationAssessment[] }>;
export type GtaProspectEvidenceImportIssue = Readonly<{ path: string; message: string }>;
export type GtaProspectEvidenceImportPlan = Readonly<{ accepted: GtaProspectEvidencePackage | null; rejected: readonly GtaProspectEvidenceImportIssue[]; payloadSha256: string | null; summary: Readonly<{ evidence: number; identityMappings: number; downtownGeography: number; websiteIntakeFindings: number; qualificationAssessments: number }> }>;

const sourceKeyPattern = /^[a-z0-9][a-z0-9-]{1,159}$/;
const identifierPattern = /^[a-z0-9][a-z0-9-]{2,159}$/;
const stableFirmId = /^FIRM-[0-9A-HJKMNP-TV-Z]{26}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const rootKeys = new Set(["packageType", "packageVersion", "packageId", "generatedAt", "controls", "evidence", "identityMappings", "downtownGeography", "websiteIntakeFindings", "qualificationAssessments"]);

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const url = (value: unknown): value is string => { if (!text(value)) return false; try { const parsed = new URL(value); return parsed.protocol === "http:" || parsed.protocol === "https:"; } catch { return false; } };
const date = (value: unknown): value is string => { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [y, m, d] = value.split("-").map(Number); const parsed = new Date(Date.UTC(y, m - 1, d)); return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d; };
const dateTime = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const safeDomain = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value) && !value.includes("www.");

function forbidUnknown(input: Record<string, unknown>, allowed: readonly string[], path: string, issues: GtaProspectEvidenceImportIssue[]) {
  const extra = Object.keys(input).filter((key) => !allowed.includes(key));
  if (extra.length) issues.push({ path, message: `unrecognized fields are forbidden: ${extra.join(", ")}` });
}
function strings(value: unknown, path: string, issues: GtaProspectEvidenceImportIssue[], required = false): string[] {
  if (!Array.isArray(value) || value.some((item) => !text(item))) { issues.push({ path, message: "must be an array of non-empty strings" }); return []; }
  const result = value.map((item) => (item as string).trim());
  if (new Set(result).size !== result.length) issues.push({ path, message: "must not contain duplicates" });
  if (required && result.length === 0) issues.push({ path, message: "requires at least one evidence ID" });
  return result;
}
function key(value: unknown, path: string, known: ReadonlySet<string> | undefined, issues: GtaProspectEvidenceImportIssue[]): string | null {
  if (!text(value) || !sourceKeyPattern.test(value)) { issues.push({ path, message: "must be a stable lowercase source key" }); return null; }
  const result = value.trim();
  if (known && !known.has(result)) issues.push({ path, message: "does not exist in the applied GTA prospect ledger" });
  return result;
}
function refs(value: unknown, path: string, ids: ReadonlySet<string>, issues: GtaProspectEvidenceImportIssue[]): string[] {
  const result = strings(value, path, issues, true);
  for (const id of result) if (!ids.has(id)) issues.push({ path, message: `references unknown evidence ID: ${id}` });
  return result;
}
function unique(items: readonly { [key: string]: unknown }[], property: string, path: string, issues: GtaProspectEvidenceImportIssue[]) {
  const seen = new Set<string>(); for (const [i, item] of items.entries()) { const value = item[property]; if (typeof value === "string" && seen.has(value)) issues.push({ path: `${path}[${i}].${property}`, message: "duplicates an earlier value" }); if (typeof value === "string") seen.add(value); }
}

function parseEvidence(value: unknown, issues: GtaProspectEvidenceImportIssue[]): ProspectEvidenceObservation[] {
  if (!Array.isArray(value)) { issues.push({ path: "evidence", message: "must be an array" }); return []; }
  const result: ProspectEvidenceObservation[] = [];
  for (const [i, item] of value.entries()) {
    const path = `evidence[${i}]`; if (!object(item)) { issues.push({ path, message: "must be an object" }); continue; }
    forbidUnknown(item, ["evidenceId", "sourceUrl", "observedOn", "sourceKind", "note"], path, issues);
    if (!text(item.evidenceId) || !identifierPattern.test(item.evidenceId)) issues.push({ path: `${path}.evidenceId`, message: "must be a stable lowercase identifier" });
    if (!url(item.sourceUrl)) issues.push({ path: `${path}.sourceUrl`, message: "must be an http(s) URL" });
    if (!date(item.observedOn)) issues.push({ path: `${path}.observedOn`, message: "must be an ISO date" });
    if (!PROSPECT_EVIDENCE_SOURCE_KINDS.includes(item.sourceKind as ProspectEvidenceSourceKind)) issues.push({ path: `${path}.sourceKind`, message: "is invalid" });
    if (item.note !== null && (typeof item.note !== "string" || item.note.length > 1000)) issues.push({ path: `${path}.note`, message: "must be null or at most 1000 characters" });
    if (text(item.evidenceId) && identifierPattern.test(item.evidenceId) && url(item.sourceUrl) && date(item.observedOn) && PROSPECT_EVIDENCE_SOURCE_KINDS.includes(item.sourceKind as ProspectEvidenceSourceKind) && (item.note === null || typeof item.note === "string")) result.push({ evidenceId: item.evidenceId.trim(), sourceUrl: item.sourceUrl, observedOn: item.observedOn, sourceKind: item.sourceKind as ProspectEvidenceSourceKind, note: item.note as string | null });
  }
  unique(result, "evidenceId", "evidence", issues); return result;
}

function parseIdentity(value: unknown, ids: ReadonlySet<string>, known: ReadonlySet<string> | undefined, issues: GtaProspectEvidenceImportIssue[]): ProspectIdentityMapping[] {
  if (!Array.isArray(value)) { issues.push({ path: "identityMappings", message: "must be an array" }); return []; }
  const result: ProspectIdentityMapping[] = [];
  for (const [i, item] of value.entries()) {
    const path = `identityMappings[${i}]`; if (!object(item)) { issues.push({ path, message: "must be an object" }); continue; }
    forbidUnknown(item, ["sourceRecordKey", "mappingId", "matchState", "firmId", "candidateFirmIds", "distinctFromFirmIds", "canonicalDomain", "firmName", "confidence", "observedOn", "reason", "evidenceIds"], path, issues);
    const sourceRecordKey = key(item.sourceRecordKey, `${path}.sourceRecordKey`, known, issues);
    if (!text(item.mappingId) || !identifierPattern.test(item.mappingId)) issues.push({ path: `${path}.mappingId`, message: "must be a stable lowercase identifier" });
    const matchState = item.matchState as ProspectIdentityMapping["matchState"]; if (!["confirmed", "unresolved", "distinct"].includes(matchState)) issues.push({ path: `${path}.matchState`, message: "is invalid" });
    const firmId = item.firmId === null ? null : stableFirmId.test(item.firmId as string) ? item.firmId as string : null; if (item.firmId !== null && !firmId) issues.push({ path: `${path}.firmId`, message: "must be null or a stable FIRM ID" });
    const candidateFirmIds = strings(item.candidateFirmIds, `${path}.candidateFirmIds`, issues); const distinctFromFirmIds = strings(item.distinctFromFirmIds, `${path}.distinctFromFirmIds`, issues);
    if ([...candidateFirmIds, ...distinctFromFirmIds].some((id) => !stableFirmId.test(id))) issues.push({ path, message: "candidate and distinct firm IDs must be stable FIRM IDs" });
    const canonicalDomain = item.canonicalDomain === null ? null : safeDomain(item.canonicalDomain) ? item.canonicalDomain : null; if (item.canonicalDomain !== null && !canonicalDomain) issues.push({ path: `${path}.canonicalDomain`, message: "must be a normalized canonical domain" });
    if (!text(item.firmName) || item.firmName.length > 240) issues.push({ path: `${path}.firmName`, message: "is required and must be at most 240 characters" });
    if (!["high", "moderate", "unknown"].includes(item.confidence as string)) issues.push({ path: `${path}.confidence`, message: "is invalid" });
    if (!date(item.observedOn)) issues.push({ path: `${path}.observedOn`, message: "must be an ISO date" }); if (!text(item.reason) || item.reason.length > 1000) issues.push({ path: `${path}.reason`, message: "is required and must be at most 1000 characters" });
    const evidenceIds = refs(item.evidenceIds, `${path}.evidenceIds`, ids, issues);
    if (matchState === "confirmed" && (!firmId || !canonicalDomain || item.confidence !== "high" || candidateFirmIds.length || distinctFromFirmIds.length)) issues.push({ path, message: "confirmed mappings require a high-confidence stable FIRM ID and canonical domain" });
    if (matchState === "unresolved" && (firmId || distinctFromFirmIds.length)) issues.push({ path, message: "unresolved mappings require firmId null and no distinct firm IDs" });
    if (matchState === "distinct" && (firmId || candidateFirmIds.length || !distinctFromFirmIds.length)) issues.push({ path, message: "distinct mappings require firmId null, no candidates, and at least one distinct FIRM ID" });
    if (sourceRecordKey && text(item.mappingId) && identifierPattern.test(item.mappingId) && ["confirmed", "unresolved", "distinct"].includes(matchState) && text(item.firmName) && date(item.observedOn) && text(item.reason)) result.push({ sourceRecordKey, mappingId: item.mappingId.trim(), matchState, firmId, candidateFirmIds, distinctFromFirmIds, canonicalDomain, firmName: item.firmName.trim(), confidence: item.confidence as ProspectIdentityMapping["confidence"], observedOn: item.observedOn, reason: item.reason.trim(), evidenceIds });
  }
  unique(result, "mappingId", "identityMappings", issues); unique(result, "sourceRecordKey", "identityMappings", issues); return result;
}

function parseGeo(value: unknown, ids: ReadonlySet<string>, known: ReadonlySet<string> | undefined, issues: GtaProspectEvidenceImportIssue[]): ProspectDowntownGeographyObservation[] {
  if (!Array.isArray(value)) { issues.push({ path: "downtownGeography", message: "must be an array" }); return []; }
  const result: ProspectDowntownGeographyObservation[] = [];
  for (const [i, item] of value.entries()) {
    const path = `downtownGeography[${i}]`; if (!object(item)) { issues.push({ path, message: "must be an object" }); continue; }
    forbidUnknown(item, ["observationId", "evidenceIds", "geography"], path, issues); const geo = object(item.geography) ? item.geography : null;
    if (!text(item.observationId) || !identifierPattern.test(item.observationId)) issues.push({ path: `${path}.observationId`, message: "must be a stable lowercase identifier" }); const evidenceIds = refs(item.evidenceIds, `${path}.evidenceIds`, ids, issues);
    if (!geo) { issues.push({ path: `${path}.geography`, message: "must be an object" }); continue; }
    forbidUnknown(geo, ["sourceRecordKey", "boundaryId", "status", "normalizedAddress", "latitude", "longitude", "coordinateSourceType", "coordinateSourceUrl", "boundarySourceUrl", "boundaryGeometrySha256", "observedOn", "confidence", "note"], `${path}.geography`, issues);
    const sourceRecordKey = key(geo.sourceRecordKey, `${path}.geography.sourceRecordKey`, known, issues); const completeCoordinates = typeof geo.latitude === "number" && Number.isFinite(geo.latitude) && typeof geo.longitude === "number" && Number.isFinite(geo.longitude) && typeof geo.coordinateSourceType === "string" && url(geo.coordinateSourceUrl);
    const noCoordinates = geo.latitude === null && geo.longitude === null && geo.coordinateSourceType === null && geo.coordinateSourceUrl === null;
    if (geo.boundaryId !== "toronto-downtown-secondary-plan-41") issues.push({ path: `${path}.geography.boundaryId`, message: "must be the Toronto Downtown Plan (Secondary Plan 41)" }); if (!["inside", "outside", "needs_manual_review"].includes(geo.status as string)) issues.push({ path: `${path}.geography.status`, message: "is invalid" });
    if (!text(geo.normalizedAddress) || geo.normalizedAddress.length > 500) issues.push({ path: `${path}.geography.normalizedAddress`, message: "is required and must be at most 500 characters" }); if (!url(geo.boundarySourceUrl) || !sha256Pattern.test(geo.boundaryGeometrySha256 as string) || !date(geo.observedOn) || !["high", "moderate", "unknown"].includes(geo.confidence as string) || (!completeCoordinates && !noCoordinates) || ((geo.status === "inside" || geo.status === "outside") && !completeCoordinates)) issues.push({ path: `${path}.geography`, message: "does not carry a complete evidence-bearing Downtown geometry observation" });
    if (sourceRecordKey && text(item.observationId) && identifierPattern.test(item.observationId) && text(geo.normalizedAddress) && url(geo.boundarySourceUrl) && sha256Pattern.test(geo.boundaryGeometrySha256 as string) && date(geo.observedOn)) result.push({ observationId: item.observationId.trim(), evidenceIds, geography: { sourceRecordKey, boundaryId: "toronto-downtown-secondary-plan-41", status: geo.status as ProspectDowntownGeographyObservation["geography"]["status"], normalizedAddress: geo.normalizedAddress.trim(), latitude: geo.latitude as number | null, longitude: geo.longitude as number | null, coordinateSourceType: geo.coordinateSourceType as ProspectDowntownGeographyObservation["geography"]["coordinateSourceType"], coordinateSourceUrl: geo.coordinateSourceUrl as string | null, boundarySourceUrl: geo.boundarySourceUrl as string, boundaryGeometrySha256: geo.boundaryGeometrySha256 as string, observedOn: geo.observedOn as string, confidence: geo.confidence as ProspectDowntownGeographyObservation["geography"]["confidence"], note: geo.note as string | null } });
  }
  unique(result, "observationId", "downtownGeography", issues); return result;
}

function parseWebsite(value: unknown, ids: ReadonlySet<string>, known: ReadonlySet<string> | undefined, issues: GtaProspectEvidenceImportIssue[]): ProspectWebsiteIntakeFinding[] {
  if (!Array.isArray(value)) { issues.push({ path: "websiteIntakeFindings", message: "must be an array" }); return []; } const result: ProspectWebsiteIntakeFinding[] = [];
  for (const [i, item] of value.entries()) { const path = `websiteIntakeFindings[${i}]`; if (!object(item)) { issues.push({ path, message: "must be an object" }); continue; } forbidUnknown(item, ["sourceRecordKey", "observationId", "websiteUrl", "observedOn", "visibleIntakeChannels", "opportunityState", "opportunityReason", "note", "evidenceIds"], path, issues); const sourceRecordKey = key(item.sourceRecordKey, `${path}.sourceRecordKey`, known, issues); const channels = strings(item.visibleIntakeChannels, `${path}.visibleIntakeChannels`, issues); if (channels.some((channel) => !WEBSITE_INTAKE_CHANNELS.includes(channel as WebsiteIntakeChannel))) issues.push({ path: `${path}.visibleIntakeChannels`, message: "contains an invalid visible intake channel" }); if (!text(item.observationId) || !identifierPattern.test(item.observationId) || !url(item.websiteUrl) || !date(item.observedOn) || !WEBSITE_INTAKE_OPPORTUNITY_STATES.includes(item.opportunityState as WebsiteIntakeOpportunityState)) issues.push({ path, message: "contains invalid website-intake fields" }); if (item.opportunityState === "supported" && !text(item.opportunityReason)) issues.push({ path: `${path}.opportunityReason`, message: "is required when opportunityState is supported" }); if (item.opportunityReason !== null && typeof item.opportunityReason !== "string") issues.push({ path: `${path}.opportunityReason`, message: "must be null or text" }); const evidenceIds = refs(item.evidenceIds, `${path}.evidenceIds`, ids, issues); if (sourceRecordKey && text(item.observationId) && identifierPattern.test(item.observationId) && url(item.websiteUrl) && date(item.observedOn) && WEBSITE_INTAKE_OPPORTUNITY_STATES.includes(item.opportunityState as WebsiteIntakeOpportunityState)) result.push({ sourceRecordKey, observationId: item.observationId.trim(), websiteUrl: item.websiteUrl, observedOn: item.observedOn, visibleIntakeChannels: channels as WebsiteIntakeChannel[], opportunityState: item.opportunityState as WebsiteIntakeOpportunityState, opportunityReason: item.opportunityReason as string | null, note: item.note as string | null, evidenceIds }); }
  unique(result, "observationId", "websiteIntakeFindings", issues); return result;
}

function parseAssessments(value: unknown, ids: ReadonlySet<string>, known: ReadonlySet<string> | undefined, issues: GtaProspectEvidenceImportIssue[]): ProspectQualificationAssessment[] {
  if (!Array.isArray(value)) { issues.push({ path: "qualificationAssessments", message: "must be an array" }); return []; } const result: ProspectQualificationAssessment[] = []; const criteriaKeys = ["rosterWithinOneToTen", "downtownPlan41", "sharedFirmIdentity", "ownerDirectEmail", "observableAdvertisingActivity", "gbpOpportunity", "websiteIntake"] as const;
  for (const [i, item] of value.entries()) { const path = `qualificationAssessments[${i}]`; if (!object(item)) { issues.push({ path, message: "must be an object" }); continue; } forbidUnknown(item, ["sourceRecordKey", "assessmentId", "assessedOn", "state", "criteria", "rationale", "evidenceIds"], path, issues); const sourceRecordKey = key(item.sourceRecordKey, `${path}.sourceRecordKey`, known, issues); const criteria = object(item.criteria) ? item.criteria : null; if (!criteria) issues.push({ path: `${path}.criteria`, message: "must be an object" }); else { forbidUnknown(criteria, criteriaKeys, `${path}.criteria`, issues); for (const name of criteriaKeys) if (typeof criteria[name] !== "boolean") issues.push({ path: `${path}.criteria.${name}`, message: "must be a boolean" }); } if (!text(item.assessmentId) || !identifierPattern.test(item.assessmentId) || !date(item.assessedOn) || !QUALIFICATION_STATES.includes(item.state as QualificationState) || !text(item.rationale) || item.rationale.length > 2000) issues.push({ path, message: "contains invalid qualification fields" }); const evidenceIds = refs(item.evidenceIds, `${path}.evidenceIds`, ids, issues); const complete = criteria && criteriaKeys.every((name) => typeof criteria[name] === "boolean"); if (item.state === "qualified" && complete && criteriaKeys.some((name) => criteria[name] !== true)) issues.push({ path: `${path}.state`, message: "qualified requires every evidence-bearing criterion to be true" }); if (sourceRecordKey && text(item.assessmentId) && identifierPattern.test(item.assessmentId) && date(item.assessedOn) && QUALIFICATION_STATES.includes(item.state as QualificationState) && complete && text(item.rationale)) result.push({ sourceRecordKey, assessmentId: item.assessmentId.trim(), assessedOn: item.assessedOn, state: item.state as QualificationState, criteria: { rosterWithinOneToTen: criteria.rosterWithinOneToTen as boolean, downtownPlan41: criteria.downtownPlan41 as boolean, sharedFirmIdentity: criteria.sharedFirmIdentity as boolean, ownerDirectEmail: criteria.ownerDirectEmail as boolean, observableAdvertisingActivity: criteria.observableAdvertisingActivity as boolean, gbpOpportunity: criteria.gbpOpportunity as boolean, websiteIntake: criteria.websiteIntake as boolean }, rationale: item.rationale.trim(), evidenceIds }); }
  unique(result, "assessmentId", "qualificationAssessments", issues); return result;
}

function summary(pkg: GtaProspectEvidencePackage | null) { return { evidence: pkg?.evidence.length ?? 0, identityMappings: pkg?.identityMappings.length ?? 0, downtownGeography: pkg?.downtownGeography.length ?? 0, websiteIntakeFindings: pkg?.websiteIntakeFindings.length ?? 0, qualificationAssessments: pkg?.qualificationAssessments.length ?? 0 }; }

export async function buildGtaProspectEvidenceImportPlan(input: unknown, options: Readonly<{ appliedSourceRecordKeys?: ReadonlySet<string> }> = {}): Promise<GtaProspectEvidenceImportPlan> {
  const issues: GtaProspectEvidenceImportIssue[] = []; if (!object(input)) return { accepted: null, rejected: [{ path: "package", message: "must be an object" }], payloadSha256: null, summary: summary(null) }; forbidUnknown(input, [...rootKeys], "package", issues); if (input.packageType !== GTA_PROSPECT_EVIDENCE_PACKAGE_TYPE || input.packageVersion !== 1 || !text(input.packageId) || !identifierPattern.test(input.packageId) || !dateTime(input.generatedAt)) issues.push({ path: "package", message: "has invalid type, version, ID, or timestamp" }); if (!object(input.controls)) issues.push({ path: "controls", message: "must be an object" }); else { forbidUnknown(input.controls, ["contactFormsSubmitted", "chatSessionsStarted", "outreachSent"], "controls", issues); for (const control of ["contactFormsSubmitted", "chatSessionsStarted", "outreachSent"]) if (input.controls[control] !== false) issues.push({ path: `controls.${control}`, message: "must be false for a no-contact evidence package" }); }
  const evidence = parseEvidence(input.evidence, issues); const ids = new Set(evidence.map((item) => item.evidenceId)); const identityMappings = parseIdentity(input.identityMappings, ids, options.appliedSourceRecordKeys, issues); const downtownGeography = parseGeo(input.downtownGeography, ids, options.appliedSourceRecordKeys, issues); const websiteIntakeFindings = parseWebsite(input.websiteIntakeFindings, ids, options.appliedSourceRecordKeys, issues); const qualificationAssessments = parseAssessments(input.qualificationAssessments, ids, options.appliedSourceRecordKeys, issues);
  if (!evidence.length && !identityMappings.length && !downtownGeography.length && !websiteIntakeFindings.length && !qualificationAssessments.length) issues.push({ path: "package", message: "must contain at least one evidence observation or supplemental finding" });
  if (issues.length) return { accepted: null, rejected: Object.freeze(issues), payloadSha256: null, summary: summary(null) };
  const accepted: GtaProspectEvidencePackage = { packageType: GTA_PROSPECT_EVIDENCE_PACKAGE_TYPE, packageVersion: 1, packageId: (input.packageId as string).trim(), generatedAt: input.generatedAt as string, controls: { contactFormsSubmitted: false, chatSessionsStarted: false, outreachSent: false }, evidence, identityMappings, downtownGeography, websiteIntakeFindings, qualificationAssessments };
  return { accepted: Object.freeze(accepted), rejected: [], payloadSha256: await sha256(accepted), summary: summary(accepted) };
}

export type GtaProspectEvidencePackageReview = Readonly<{ plan: GtaProspectEvidenceImportPlan & Readonly<{ sourceSha256: string | null; packageId: string | null }>; summary: GtaProspectEvidenceImportPlan["summary"] & Readonly<{ reviewRequired: number }> }>;
export async function reviewGtaProspectEvidencePackage(input: unknown): Promise<GtaProspectEvidencePackageReview> { const payload = object(input) && object(input.payload) ? input.payload : input; const { listGtaProspectResearchForOperator } = await import("@/lib/gta-prospect-research-reader"); const ledger = await listGtaProspectResearchForOperator(); const plan = await buildGtaProspectEvidenceImportPlan(payload, { appliedSourceRecordKeys: new Set(ledger.map((record) => record.id)) }); const packageId = plan.accepted?.packageId ?? (object(payload) && text(payload.packageId) ? payload.packageId.trim() : null); return { plan: { ...plan, sourceSha256: plan.payloadSha256, packageId }, summary: { ...plan.summary, reviewRequired: plan.rejected.length } }; }
export function defaultGtaProspectEvidenceSourceName(value: unknown): string | null { if (value === undefined) return "gta-prospect-evidence"; if (typeof value !== "string") return null; const normalized = value.trim().toLocaleLowerCase("en-CA"); return /^[-_a-z0-9]{1,200}$/.test(normalized) ? normalized : null; }
