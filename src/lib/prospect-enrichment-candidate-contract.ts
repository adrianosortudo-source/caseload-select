/** Operator-only read DTO. Candidate UUIDs never stand in for verified firm UUIDs. */
export type CandidateJson = null | boolean | number | string | CandidateJson[] | { [key: string]: CandidateJson };
export const CANDIDATE_FILTER_KEYS = ["firmId", "identityNamespace", "identityKey", "text", "originalStatus", "selectionDisposition", "processingDisposition", "qualificationState", "identityState", "fieldPointer", "fieldValue", "fieldRefRevision", "fieldRefPointerSha256", "sourceUrl", "observedFrom", "observedTo", "retrievedFrom", "retrievedTo", "observedUnknown", "retrievedUnknown"] as const;
export type CandidateFilterKey = typeof CANDIDATE_FILTER_KEYS[number];
export type CandidateFilters = Partial<Record<CandidateFilterKey, string>>;
export type CandidateSummary = Readonly<{
  id: string; identityNamespace: string; identityKey: string; displayName: string;
  verifiedFirmId: string | null; identityState: "unresolved" | "resolved" | "conflict";
  revisionCount: number; originalStatuses: string[]; selectionDispositions: string[];
  processingDispositions: string[]; qualificationStates: string[];
  latestRecordedAt: string; readWarnings: string[];
}>;
export type CandidateField = Readonly<{
  pointer: string; scalarType: "string" | "number" | "boolean" | "null" | "array" | "object";
  value: CandidateJson; sourceItemId: string | null; sourceIds: CandidateJson;
  observedAt: string | null; retrievedAt: string | null; validationState: string;
}>;
export type CandidateHistoryItem = Readonly<{
  id: string; candidateId: string; contentDeferred: boolean;
  itemKind: "research_revision" | "package_event" | "identity_link" | "profile_choice" | "provenance_revision";
  runId: string | null; entryId: string | null; packageId: string | null;
  originalStatus: string | null; selectionDisposition: string | null; processingDisposition: string | null;
  qualificationState: string | null; sourceRoot: string | null; relativePath: string | null;
  sourcePointer: string | null; sourceFileSha256: string | null; payloadSha256: string; originalJsonSha256: string;
  originalJson: CandidateJson; unmappedPaths: CandidateJson; observedAt: string | null;
  retrievedAt: string | null; recordedAt: string; readWarnings: string[]; fields: CandidateField[];
}>;
export type CandidateReadMetadata = Readonly<{ coverageRevision: number; readWarnings: string[]; complete: boolean }>;
export type CandidateList = CandidateReadMetadata & Readonly<{
  items: CandidateSummary[]; nextCursor: string | null; inventoryCount: number; filteredCount: number;
}>;
export type CandidateProfileChoice = { [key: string]: CandidateJson } & Readonly<{ evidenceState: "retained" | "retracted"; retractions: CandidateJson[] }>;
export type CandidateDetail = CandidateReadMetadata & Readonly<{ candidate: CandidateSummary; profileChoices: CandidateProfileChoice[] }>;
export type CandidateHistory = CandidateReadMetadata & Readonly<{ items: CandidateHistoryItem[]; nextCursor: string | null }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const POINTER = /^(?:\/(?:[^~]|~[01])*)*$/;
const BAD_KEYS = new Set(["__proto__", "prototype", "constructor"]);
export class CandidateContractError extends Error {
  constructor(message = "Candidate research is incomplete or unavailable.") { super(message); this.name = "CandidateContractError"; }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new CandidateContractError();
  return value as Record<string, unknown>;
}
function text(value: unknown, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.length)) throw new CandidateContractError(); return value;
}
function nullable(value: unknown): string | null { return value === null ? null : text(value, true); }
function uuid(value: unknown): string { const id = text(value); if (!UUID.test(id)) throw new CandidateContractError(); return id; }
function count(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new CandidateContractError(); return value as number; }
function strings(value: unknown, allowEmpty = false): string[] { if (!Array.isArray(value)) throw new CandidateContractError(); return value.map(item => text(item, allowEmpty)); }
function date(value: unknown): string { const result = text(value); if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) throw new CandidateContractError(); return result; }
function hash(value: unknown): string { const result = text(value); if (!SHA.test(result)) throw new CandidateContractError(); return result; }
/** No key is interpreted as an instruction, HTML, SQL, or a property assignment. */
function json(value: unknown): CandidateJson {
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (item === null || typeof item === "string" || typeof item === "boolean") continue;
    if (typeof item === "number" && Number.isFinite(item)) continue;
    if (Array.isArray(item)) { for (const child of item) pending.push(child); continue; }
    for (const child of Object.values(record(item))) pending.push(child);
  }
  // The input comes from parsed JSON. No values are assigned to an object's prototype.
  return value as CandidateJson;
}
export function parseCandidateSummary(value: unknown): CandidateSummary {
  const row = record(value), identityState = text(row.identityState);
  if (!["resolved", "unresolved", "conflict"].includes(identityState)) throw new CandidateContractError();
  const verifiedFirmId = row.verifiedFirmId === null ? null : uuid(row.verifiedFirmId);
  if ((identityState === "resolved") !== (verifiedFirmId !== null)) throw new CandidateContractError();
  return {
    id: uuid(row.id), identityNamespace: text(row.identityNamespace), identityKey: text(row.identityKey), displayName: text(row.displayName),
    verifiedFirmId, identityState: identityState as CandidateSummary["identityState"], revisionCount: count(row.revisionCount),
    originalStatuses: strings(row.originalStatuses, true), selectionDispositions: strings(row.selectionDispositions, true), processingDispositions: strings(row.processingDispositions, true), qualificationStates: strings(row.qualificationStates, true),
    latestRecordedAt: date(row.latestRecordedAt), readWarnings: strings(row.readWarnings),
  };
}
export function parseCandidateMetadata(value: unknown): CandidateReadMetadata {
  const row = record(value); if (typeof row.complete !== "boolean") throw new CandidateContractError();
  const readWarnings = strings(row.readWarnings);
  if (row.complete && readWarnings.length) throw new CandidateContractError();
  return { coverageRevision: count(row.coverageRevision), readWarnings, complete: row.complete };
}
export function parseCandidateField(value: unknown): CandidateField {
  const row = record(value), pointer = text(row.pointer, true), scalarType = text(row.scalarType), scalar = json(row.value);
  if (!POINTER.test(pointer) || !["string", "number", "boolean", "null", "array", "object"].includes(scalarType)) throw new CandidateContractError();
  const actual = scalar === null ? "null" : Array.isArray(scalar) ? "array" : typeof scalar;
  if (actual !== scalarType || (actual === "array" && (scalar as CandidateJson[]).length) || (actual === "object" && Object.keys(scalar as object).length)) throw new CandidateContractError();
  return { pointer, scalarType: scalarType as CandidateField["scalarType"], value: scalar, sourceItemId: nullable(row.sourceItemId), sourceIds: json(row.sourceIds), observedAt: nullable(row.observedAt), retrievedAt: nullable(row.retrievedAt), validationState: text(row.validationState) };
}
export function parseCandidateHistoryItem(value: unknown): CandidateHistoryItem {
  const row = record(value), itemKind = text(row.itemKind);
  if (typeof row.contentDeferred !== "boolean" || (row.contentDeferred && (row.originalJson !== null || !Array.isArray(row.fields) || row.fields.length !== 0 || !Array.isArray(row.unmappedPaths) || row.unmappedPaths.length !== 0))) throw new CandidateContractError();
  if (!["research_revision", "package_event", "identity_link", "profile_choice", "provenance_revision"].includes(itemKind) || !Array.isArray(row.fields)) throw new CandidateContractError();
  return {
    id: uuid(row.id), candidateId: uuid(row.candidateId), contentDeferred: row.contentDeferred, itemKind: itemKind as CandidateHistoryItem["itemKind"], runId: row.runId === null ? null : uuid(row.runId), entryId: nullable(row.entryId), packageId: row.packageId === null ? null : uuid(row.packageId),
    originalStatus: nullable(row.originalStatus), selectionDisposition: nullable(row.selectionDisposition), processingDisposition: nullable(row.processingDisposition), qualificationState: nullable(row.qualificationState), sourceRoot: nullable(row.sourceRoot), relativePath: nullable(row.relativePath), sourcePointer: nullable(row.sourcePointer), sourceFileSha256: row.sourceFileSha256 === null ? null : hash(row.sourceFileSha256), payloadSha256: hash(row.payloadSha256), originalJsonSha256: hash(row.originalJsonSha256),
    originalJson: json(row.originalJson), unmappedPaths: json(row.unmappedPaths), observedAt: nullable(row.observedAt), retrievedAt: nullable(row.retrievedAt), recordedAt: date(row.recordedAt), readWarnings: strings(row.readWarnings), fields: row.fields.map(parseCandidateField),
  };
}
export function parseCandidateProfileChoice(value: unknown): CandidateProfileChoice {
  const row = record(value);
  if (!["retained", "retracted"].includes(String(row.evidenceState)) || !Array.isArray(row.retractions) || (row.evidenceState === "retracted") !== (row.retractions.length > 0)) throw new CandidateContractError();
  return json(row) as CandidateProfileChoice;
}
export function parseCandidateDetail(value: unknown): CandidateDetail {
  const row = record(value); if (!Array.isArray(row.profileChoices)) throw new CandidateContractError();
  return { ...parseCandidateMetadata(row), candidate: parseCandidateSummary(row.candidate), profileChoices: row.profileChoices.map(parseCandidateProfileChoice) };
}
export function parseCandidateFilters(params: URLSearchParams): CandidateFilters {
  const result: CandidateFilters = {};
  for (const key of CANDIDATE_FILTER_KEYS) {
    const value = params.get(key); if (value === null) continue;
    if (params.getAll(key).length !== 1 || !value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) throw new CandidateContractError("Research filters must be unique and bounded.");
    result[key] = value;
  }
  if (result.firmId) { if (!UUID.test(result.firmId)) throw new CandidateContractError("A verified firm filter requires a firm UUID."); result.firmId = result.firmId.toLowerCase(); }
  if ((result.identityKey === undefined) !== (result.identityNamespace === undefined)) throw new CandidateContractError("Exact candidate lookup requires both the source namespace and key.");
  if (result.identityState && !["unresolved", "resolved", "conflict"].includes(result.identityState)) throw new CandidateContractError("Invalid identity filter.");
  for (const key of ["observedUnknown", "retrievedUnknown"] as const) if (result[key] && result[key] !== "true") throw new CandidateContractError("Unknown-date filters require true.");
  for (const key of ["observedFrom", "observedTo", "retrievedFrom", "retrievedTo"] as const) {
    const value = result[key]; if (value && (!/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value)) throw new CandidateContractError("Use a real UTC calendar date.");
  }
  for (const prefix of ["observed", "retrieved"] as const) {
    const from = result[`${prefix}From`], to = result[`${prefix}To`];
    if ((from && to && from > to) || (result[`${prefix}Unknown`] && (from || to))) throw new CandidateContractError("Date bounds conflict with the unknown-date filter.");
  }
  if ((result.fieldRefRevision === undefined) !== (result.fieldRefPointerSha256 === undefined) || (result.fieldRefRevision !== undefined && (!UUID.test(result.fieldRefRevision) || !SHA.test(result.fieldRefPointerSha256!) || result.fieldPointer !== undefined || result.fieldValue !== undefined))) throw new CandidateContractError("Exact field references require an immutable revision UUID and pointer SHA256, without another field filter.");
  if (result.fieldValue !== undefined && result.fieldPointer === undefined) throw new CandidateContractError("A field value requires its exact JSON pointer.");
  if (result.fieldPointer !== undefined && !POINTER.test(result.fieldPointer)) throw new CandidateContractError("Use an RFC 6901 research field pointer.");
  if (result.fieldValue !== undefined) {
    let value: unknown; try { value = JSON.parse(result.fieldValue); } catch { throw new CandidateContractError("Use a JSON scalar or empty container for the field value."); }
    if (typeof value === "object" && value !== null && (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0)) throw new CandidateContractError("Field filters accept a scalar or empty container.");
    if (typeof value === "number" && !Number.isFinite(value)) throw new CandidateContractError("The field number is invalid.");
    result.fieldValue = JSON.stringify(value);
  }
  if (result.sourceUrl) {
    try { const url = new URL(result.sourceUrl); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { throw new CandidateContractError("Source URL must be HTTP or HTTPS without credentials."); }
  }
  if (Object.keys(result).some(key => BAD_KEYS.has(key))) throw new CandidateContractError();
  return result;
}
