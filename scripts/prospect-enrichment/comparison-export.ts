import type { ComparisonSnapshot } from "./reconciliation";
import { validateComparisonSnapshot, validLegacyAssessmentProjectionProof } from "./reconciliation";
import { canonicalJson, object, protocolHash, sha256 } from "./model";
import { signComparisonSnapshot, signingKeyTrust, type ComparisonSigningKey, type ComparisonTrust } from "./comparison-signature";

export type ComparisonExportInput = Omit<ComparisonSnapshot, "snapshotSha256" | "signature">;
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nonempty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const nullableText = (value: unknown) => value === null || nonempty(value);
const visibility = (value: unknown) => value === null || typeof value === "boolean";
function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function records(value: unknown, check: (row: Record<string, unknown>) => boolean): boolean {
  return Array.isArray(value) && value.every(row => object(row) && check(row));
}
function validContent(value: unknown): value is ComparisonExportInput {
  if (!object(value) || !exactKeys(value, ["schemaVersion", "projectId", "capturedAt", "provenance", "identities", "packages", "events"], ["currentAssessments"])) return false;
  if (value.schemaVersion !== "prospect-enrichment-comparison/v1" || value.projectId !== "ssxryjxifwiivghglqer" || typeof value.capturedAt !== "string" || !/^\d{4}-\d\d-\d\dT.*Z$/.test(value.capturedAt) || !Number.isFinite(Date.parse(value.capturedAt))) return false;
  if (!object(value.provenance) || !exactKeys(value.provenance, ["reader", "sourceArtifactSha256", "operatorAuthenticated"]) || !nonempty(value.provenance.reader) || !hash(value.provenance.sourceArtifactSha256) || value.provenance.operatorAuthenticated !== true) return false;
  if (!records(value.identities, row => exactKeys(row, ["researchKey", "databaseFirmId", "stableFirmId", "sourceRecordKey", "canonicalDomain"]) && nonempty(row.researchKey) && nonempty(row.databaseFirmId) && nullableText(row.stableFirmId) && nonempty(row.sourceRecordKey) && nullableText(row.canonicalDomain))) return false;
  if (!records(value.packages, row => exactKeys(row, ["clientPackageId", "payloadSha256", "state", "serverPackageId", "visible"]) && nonempty(row.clientPackageId) && hash(row.payloadSha256) && nonempty(row.state) && (row.state === "missing" ? row.serverPackageId === null && row.visible === null : nonempty(row.serverPackageId) && visibility(row.visible)))) return false;
  if (!records(value.events, row => exactKeys(row, ["sourceEventKey", "semanticSha256", "researchKey", "targets", "primaryTarget", "visible"], ["parentAssessmentClientId", "legacyAssessmentProjections"]) && (!Object.hasOwn(row,"legacyAssessmentProjections") || (Array.isArray(row.legacyAssessmentProjections) && row.legacyAssessmentProjections.every(validLegacyAssessmentProjectionProof))) && nonempty(row.sourceEventKey) && hash(row.semanticSha256) && nonempty(row.researchKey) && visibility(row.visible) && (row.primaryTarget === null || (object(row.primaryTarget) && exactKeys(row.primaryTarget, ["table", "id", "rowSha256"]) && nonempty(row.primaryTarget.table) && nonempty(row.primaryTarget.id) && hash(row.primaryTarget.rowSha256) && Array.isArray(row.targets) && row.targets.filter(t => canonicalJson(t) === canonicalJson(row.primaryTarget)).length === 1)) && (!Object.hasOwn(row, "parentAssessmentClientId") || nonempty(row.parentAssessmentClientId)) && records(row.targets, target => exactKeys(target, ["table", "id", "rowSha256"]) && nonempty(target.table) && nonempty(target.id) && hash(target.rowSha256)))) return false;
  if (Object.hasOwn(value, "currentAssessments") && !records(value.currentAssessments, row => exactKeys(row, ["researchKey", "clientAssessmentId"]) && nonempty(row.researchKey) && nonempty(row.clientAssessmentId))) return false;
  return true;
}

/** Serializes an actual supported-reader result. This function grants no auth and performs no I/O. */
export function serializeComparisonExport(input: unknown, now = new Date().toISOString(), signingKey?:ComparisonSigningKey): { snapshot: ComparisonSnapshot; body: string; bodySha256: string } {
  if (!validContent(input)) throw new Error("comparison_export_schema_invalid");
  // JSON canonicalization gives a detached copy and prevents later caller mutation.
  const content = JSON.parse(canonicalJson(input)) as ComparisonExportInput;
  if(!signingKey)throw Error("comparison_signing_key_missing");
  const snapshot: ComparisonSnapshot = signComparisonSnapshot({ ...content, snapshotSha256: protocolHash(content) },signingKey);
  const issues = validateComparisonSnapshot(snapshot, now, signingKeyTrust(signingKey));
  if (issues.length) throw new Error(issues[0].code);
  const body = canonicalJson(snapshot) + "\n";
  return { snapshot, body, bodySha256: sha256(body) };
}

/** Offline clients only preserve already signed server artifacts; they cannot mint server provenance. */
export function verifyAndSerializeComparisonExport(input:unknown,now=new Date().toISOString(),trust?:ComparisonTrust|null){
  if(!object(input)||!hash(input.snapshotSha256)||!Object.hasOwn(input,"signature"))throw Error("comparison_export_schema_invalid");
  const {snapshotSha256:_hash,signature:_signature,...content}=input;void _hash;void _signature;
  if(!validContent(content))throw Error("comparison_export_schema_invalid");
  const snapshot=JSON.parse(canonicalJson(input)) as ComparisonSnapshot;
  const issues=validateComparisonSnapshot(snapshot,now,trust);if(issues.length)throw Error(issues[0].code);
  const body=canonicalJson(snapshot)+"\n";return{snapshot,body,bodySha256:sha256(body)};
}
