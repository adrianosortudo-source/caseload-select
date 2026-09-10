import { PROSPECTING_MANIFEST_SCHEMA_VERSION, validateProspectProvisionManifest, type ProspectProvisionManifest } from "./manifest";
import { buildProvisionRecord, type InputDigests } from "./provision-compiler-record";
import { EXPECTED_CLS_IDS, assertExactIds, normalizedTimestamp, object, parseAe, parseBa, recordsById, text } from "./provision-compiler-source";

export interface CompileInputs {
  baManifest: unknown;
  aeManifest: unknown;
  evidenceManifest: unknown;
  inputSha256?: InputDigests;
}
export interface CompileReport { manifest_sha256: string; counts: Record<string, number>; unknowns: string[]; }

export function serializeProvisionManifest(manifest: ProspectProvisionManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
export function compileProvisionManifest(inputs: CompileInputs): ProspectProvisionManifest {
  const aeRoot = object(inputs.aeManifest, "AE manifest");
  const evidenceRoot = object(inputs.evidenceManifest, "HighLevel evidence manifest");
  const bas = recordsById(inputs.baManifest, "BA manifest");
  const aes = recordsById(aeRoot.records, "AE manifest.records");
  const evidence = recordsById(evidenceRoot.records, "HighLevel evidence manifest.records");
  assertExactIds(bas.keys(), EXPECTED_CLS_IDS.filter((id) => id.startsWith("BA-")), "BA manifest");
  assertExactIds(aes.keys(), EXPECTED_CLS_IDS.filter((id) => id.startsWith("AE-")), "AE manifest");
  assertExactIds(evidence.keys(), EXPECTED_CLS_IDS, "HighLevel evidence manifest");
  const aeVersion = text(aeRoot.schema_version, "AE manifest.schema_version");
  const evidenceVersion = text(evidenceRoot.schema_version, "HighLevel evidence manifest.schema_version");
  const records = EXPECTED_CLS_IDS.map((id) => buildProvisionRecord(
    id.startsWith("BA-") ? parseBa(bas.get(id)!) : parseAe(aes.get(id)!, aeVersion),
    evidence.get(id)!, evidenceVersion, inputs.inputSha256,
  ));
  const manifest: ProspectProvisionManifest = {
    schema_version: PROSPECTING_MANIFEST_SCHEMA_VERSION,
    generated_at: normalizedTimestamp(text(evidenceRoot.generated_at, "HighLevel evidence manifest.generated_at"), "HighLevel evidence manifest.generated_at"),
    records,
  };
  validateProspectProvisionManifest(serializeProvisionManifest(manifest));
  return manifest;
}

export function summarizeProvisionManifest(raw: string): CompileReport {
  const manifest = validateProspectProvisionManifest(raw);
  const locations = new Set<string>();
  const lists = new Set<string>();
  const workflows = new Set<string>();
  let named = 0; let generic = 0; let unreconciled = 0; let stageUnknown = 0;
  for (const record of manifest.records) {
    const ghl = record.source_payload.highlevel;
    if (ghl.location_id) locations.add(ghl.location_id);
    if (ghl.smart_list_id) lists.add(ghl.smart_list_id);
    ghl.workflow_ids.forEach((id) => workflows.add(id));
    if (record.person?.primary_email) named += 1;
    if (object(record.source_payload.contact_route, `${record.cls_record_id}.contact_route`).generic_inbox_withheld_from_person_primary_email === true) generic += 1;
    const history = object(record.source_payload.execution_history, `${record.cls_record_id}.execution_history`);
    if (history.reconciliation_state === "unreconciled") unreconciled += 1;
    if (history.current_stage === "unknown") stageUnknown += 1;
  }
  return {
    manifest_sha256: manifest.manifest_sha256,
    counts: {
      total: manifest.records.length,
      BA: manifest.records.filter((record) => record.arm === "BA").length,
      AE: manifest.records.filter((record) => record.arm === "AE").length,
      unique_cls_record_ids: new Set(manifest.records.map((record) => record.cls_record_id)).size,
      highlevel_contact_ids: new Set(manifest.records.map((record) => record.source_payload.highlevel.contact_id).filter(Boolean)).size,
      highlevel_location_ids: locations.size,
      highlevel_smart_list_ids: lists.size,
      highlevel_workflow_ids: workflows.size,
      named_person_primary_emails: named,
      generic_routes_withheld_from_primary_email: generic,
      execution_history_unreconciled: unreconciled,
      current_stage_unknown: stageUnknown,
    },
    unknowns: [
      "Current journey stage for all 100 records",
      "Exact per-contact send timestamp and provider event/message ID for all 100 records",
      "Final delivery, later sends, replies, bounce/complaint/DND, and meeting state for all 100 records",
      "Operating-system existing/new state until authenticated read-only application/database reconciliation",
    ],
  };
}
