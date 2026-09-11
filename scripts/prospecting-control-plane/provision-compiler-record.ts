import type { ProspectArm, ProspectManifestRecord } from "./manifest";
import { isGenericRoute, normalizedDomain, normalizedIdentity, object, text, type AuthorityRecord, type JsonObject } from "./provision-compiler-source";

export interface InputDigests { ba: string; ae: string; evidence: string; }

function assertIdentity(record: AuthorityRecord, evidence: JsonObject): void {
  const checks: Array<[string, string, string]> = [
    ["firm", record.firm, text(evidence.firm, `${record.id}.evidence.firm`)],
    ["person", record.person, text(evidence.person, `${record.id}.evidence.person`)],
    ["email", record.email, text(evidence.email, `${record.id}.evidence.email`).toLowerCase()],
    ["domain", record.domain, normalizedDomain(text(evidence.domain, `${record.id}.evidence.domain`))],
  ];
  for (const [field, expected, actual] of checks) {
    if (normalizedIdentity(expected) !== normalizedIdentity(actual)) throw new Error(`${record.id} ${field} differs between the authoritative journey manifest and verified HighLevel evidence.`);
  }
}
function highlevel(evidence: JsonObject, id: string) {
  const touch = object(evidence.touch_1, `${id}.touch_1`);
  const parts = text(touch.provisional_idempotency_key, `${id}.touch_1.provisional_idempotency_key`).split(":");
  if (parts.length !== 8 || parts[0] !== "prospect-activity" || parts[1] !== "v1" || parts[2] !== "ghl" || parts[5] !== id || parts[6] !== "touch-1" || parts[7] !== "email") throw new Error(`${id} provisional activity key does not contain exact HighLevel location/workflow IDs.`);
  return { location_id: text(parts[3], `${id}.location_id`), contact_id: text(evidence.ghl_contact_id, `${id}.ghl_contact_id`), smart_list_id: text(evidence.ghl_smart_list_id, `${id}.ghl_smart_list_id`), workflow_ids: [text(parts[4], `${id}.workflow_id`)] };
}

export function buildProvisionRecord(record: AuthorityRecord, evidence: JsonObject, evidenceVersion: string, hashes?: InputDigests): ProspectManifestRecord {
  const arm = text(evidence.arm, `${record.id}.evidence.arm`) as ProspectArm;
  if ((arm !== "BA" && arm !== "AE") || !record.id.startsWith(`${arm}-`)) throw new Error(`${record.id} arm mismatch.`);
  assertIdentity(record, evidence);
  const touch = object(evidence.touch_1, `${record.id}.touch_1`);
  if (text(touch.payload_sha256, `${record.id}.touch_1.payload_sha256`).toLowerCase() !== record.payloadSha256) throw new Error(`${record.id} payload SHA-256 differs between authority and evidence.`);
  const generic = isGenericRoute(record);
  if (!generic && !/named|direct|buffer/i.test(record.route)) throw new Error(`${record.id} email lacks explicit named/direct first-party attribution.`);
  const email = generic ? null : record.email;
  const url = record.urls[0];
  return {
    cls_record_id: record.id,
    arm,
    source_url: url,
    organization: { display_name: record.firm, city: null, website_url: `https://${record.domain}/` },
    person: { display_name: record.person, primary_email: email, primary_phone: null, role_title: record.role, email_attribution: email ? { mailbox_type: "named_person", person_attribution_proven: true, evidence_url: url } : null },
    source_payload: {
      arm,
      method: arm === "BA" ? "beyond_agency" : "adam_erhart",
      evidence: record.urls.map((source, i) => ({ url: source, observed_at: record.observedAt, label: i ? "Additional first-party inquiry-route evidence" : "First-party person and inquiry-route evidence" })),
      highlevel: highlevel(evidence, record.id),
      contact_route: { email: record.email, route_class: record.route, generic_inbox_withheld_from_person_primary_email: generic, person_email_attribution: email ? "explicit_first_party_named_or_direct" : "not_applicable_generic_route" },
      authoritative_lineage: { source_manifest_schema_version: record.version, payload_path: record.payloadPath, payload_sha256: record.payloadSha256, input_sha256: { arm_manifest: arm === "BA" ? hashes?.ba ?? null : hashes?.ae ?? null, evidence_manifest: hashes?.evidence ?? null } },
      execution_history: { reconciliation_state: "unreconciled", current_stage: "unknown", activities_imported: false, occurred_at: null, provider_event_ids: [], last_verified_at: null },
      operational_unknowns: ["current_journey_stage", "exact_per_contact_send_timestamp", "provider_message_or_event_id", "final_delivery_status", "later_sends", "reply_state", "bounce_complaint_or_dnd_state", "meeting_state"],
      evidence_manifest_schema_version: evidenceVersion,
    },
    provisioning_basis: `Exact ${record.id} join across the authoritative ${arm} journey manifest and verified offline HighLevel evidence; execution history is unreconciled and current stage is unknown.`,
  };
}
