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

/** A bootstrap signature is usable for manifest registration only when it binds the complete final request. */
export function assertBootstrapRegistrationBinding(snapshot: unknown, expectedRequestSha256: string): asserts snapshot is ComparisonSnapshot {
  if (!object(snapshot) || !object(snapshot.provenance) || !["admin-prospect-enrichment-bootstrap/v1", "admin-prospect-enrichment-bootstrap-resume/v1"].includes(String(snapshot.provenance.reader)) ||
      snapshot.provenance.sourceArtifactSha256 !== expectedRequestSha256 || !Array.isArray(snapshot.packages) || snapshot.packages.length !== 0) {
    throw new Error("bootstrap_comparison_binding_invalid");
  }
}

/** Registration recovery may also use the finalized reader after the final receipt was lost. */
export function assertManifestRegistrationBinding(snapshot: unknown, expectedRequestSha256: string): asserts snapshot is ComparisonSnapshot {
  if (!object(snapshot) || !object(snapshot.provenance)) throw new Error("manifest_registration_comparison_invalid");
  if (snapshot.provenance.reader === "admin-prospect-enrichment-comparison/v1") {
    assertFinalizedComparisonReader(snapshot, expectedRequestSha256);
    return;
  }
  assertBootstrapRegistrationBinding(snapshot, expectedRequestSha256);
}

/** Package delivery is permitted only from the unchanged finalized-run read path. */
export function assertFinalizedComparisonReader(snapshot: unknown, expectedRequestSha256: string): asserts snapshot is ComparisonSnapshot {
  if (!object(snapshot) || !object(snapshot.provenance) || snapshot.provenance.reader !== "admin-prospect-enrichment-comparison/v1" ||
      snapshot.provenance.sourceArtifactSha256 !== expectedRequestSha256) {
    throw new Error("finalized_comparison_required");
  }
}

/** Exact recovery is bound to the still-open run through its signed resume reader. */
export function assertOpenRunRecoveryBinding(snapshot: unknown, expectedRequestSha256: string): asserts snapshot is ComparisonSnapshot {
  if (!object(snapshot) || !object(snapshot.provenance) ||
      snapshot.provenance.reader !== "admin-prospect-enrichment-bootstrap-resume/v1" ||
      snapshot.provenance.operatorAuthenticated !== true ||
      snapshot.provenance.sourceArtifactSha256 !== expectedRequestSha256 ||
      !Array.isArray(snapshot.packages) || snapshot.packages.length !== 0) {
    throw new Error("open_run_recovery_comparison_required");
  }
}

/** Machine-authenticated bootstrap snapshots are accepted only by the exact, empty-package recovery path. */
export function assertMachineOpenRunRecoveryBinding(snapshot: unknown, expectedRequestSha256: string): asserts snapshot is ComparisonSnapshot {
  if (!object(snapshot) || !object(snapshot.provenance) ||
      !["admin-prospect-enrichment-bootstrap-github-actions/v1", "admin-prospect-enrichment-bootstrap-resume-github-actions/v1"].includes(String(snapshot.provenance.reader)) ||
      snapshot.provenance.machineAuthenticated !== true || snapshot.provenance.operatorAuthenticated !== undefined ||
      snapshot.provenance.sourceArtifactSha256 !== expectedRequestSha256 || snapshot.provenance.repository !== "adrianosortudo-source/caseload-select" ||
      snapshot.provenance.repositoryId !== "1206232496" || snapshot.provenance.ref !== "refs/heads/main" ||
      snapshot.provenance.workflowRef !== "adrianosortudo-source/caseload-select/.github/workflows/prospect-enrichment-comparison-read.yml@refs/heads/main" ||
      snapshot.provenance.environment !== "Prospect comparison read" || snapshot.provenance.eventName !== "workflow_dispatch" ||
      !/^[a-f0-9]{40}$/.test(String(snapshot.provenance.sha)) || !/^[1-9][0-9]{0,19}$/.test(String(snapshot.provenance.runId)) ||
      !/^[1-9][0-9]{0,5}$/.test(String(snapshot.provenance.runAttempt)) || !/^[a-f0-9]{64}$/.test(String(snapshot.provenance.jtiSha256)) ||
      !Array.isArray(snapshot.packages) || snapshot.packages.length !== 0) throw new Error("machine_open_run_recovery_comparison_required");
}

const machineProvenanceKeys = ["reader", "sourceArtifactSha256", "machineAuthenticated", "repository", "repositoryId", "ref", "sha", "workflowRef", "environment", "eventName", "runId", "runAttempt", "jtiSha256"];
function validMachineProvenance(value: unknown): value is Record<string, unknown> {
  return object(value) && exactKeys(value, machineProvenanceKeys) &&
    ["admin-prospect-enrichment-bootstrap-github-actions/v1", "admin-prospect-enrichment-bootstrap-resume-github-actions/v1"].includes(String(value.reader)) &&
    value.machineAuthenticated === true && value.repository === "adrianosortudo-source/caseload-select" && value.repositoryId === "1206232496" &&
    value.ref === "refs/heads/main" && /^[a-f0-9]{40}$/.test(String(value.sha)) &&
    value.workflowRef === "adrianosortudo-source/caseload-select/.github/workflows/prospect-enrichment-comparison-read.yml@refs/heads/main" &&
    value.environment === "Prospect comparison read" && value.eventName === "workflow_dispatch" && /^[1-9][0-9]{0,19}$/.test(String(value.runId)) &&
    /^[1-9][0-9]{0,5}$/.test(String(value.runAttempt)) && /^[a-f0-9]{64}$/.test(String(value.jtiSha256));
}

/** Server-only GitHub workflow signer. It emits no operatorAuthenticated claim. */
export function serializeMachineComparisonExport(input: unknown, now = new Date().toISOString(), signingKey?: ComparisonSigningKey) {
  if (!object(input) || !validMachineProvenance(input.provenance) || !hash(input.provenance.sourceArtifactSha256) || !Array.isArray(input.packages) || input.packages.length !== 0) throw Error("machine_comparison_export_schema_invalid");
  const compatible = { ...input, provenance: { reader: input.provenance.reader, sourceArtifactSha256: input.provenance.sourceArtifactSha256, operatorAuthenticated: true } };
  if (!validContent(compatible)) throw Error("machine_comparison_export_schema_invalid");
  if (!signingKey) throw Error("comparison_signing_key_missing");
  const content = JSON.parse(canonicalJson(input)) as ComparisonExportInput;
  const snapshot = signComparisonSnapshot({ ...content, snapshotSha256: protocolHash(content) }, signingKey);
  const issues = validateComparisonSnapshot(snapshot, now, signingKeyTrust(signingKey), "github-actions-machine");
  if (issues.length) throw Error(issues[0].code);
  const body = canonicalJson(snapshot) + "\n";
  return { snapshot, body, bodySha256: sha256(body) };
}

/** Offline verifier reserved for the recovery command; general reconcile still rejects machine provenance. */
export function verifyAndSerializeMachineComparisonExport(input: unknown, now = new Date().toISOString(), trust?: ComparisonTrust | null) {
  if (!object(input) || !hash(input.snapshotSha256) || !Object.hasOwn(input, "signature") || !validMachineProvenance(input.provenance) || !hash(input.provenance.sourceArtifactSha256) || !Array.isArray(input.packages) || input.packages.length !== 0) throw Error("machine_comparison_export_schema_invalid");
  const compatible = { ...input, provenance: { reader: input.provenance.reader, sourceArtifactSha256: input.provenance.sourceArtifactSha256, operatorAuthenticated: true } };
  const { snapshotSha256: _hash, signature: _signature, ...content } = compatible; void _hash; void _signature;
  if (!validContent(content)) throw Error("machine_comparison_export_schema_invalid");
  const snapshot = JSON.parse(canonicalJson(input)) as ComparisonSnapshot;
  const issues = validateComparisonSnapshot(snapshot, now, trust, "github-actions-machine");
  if (issues.length) throw Error(issues[0].code);
  const body = canonicalJson(snapshot) + "\n";
  return { snapshot, body, bodySha256: sha256(body) };
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
