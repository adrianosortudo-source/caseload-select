import { describe, expect, it } from "vitest";
import { compileProvisionManifest, serializeProvisionManifest, summarizeProvisionManifest } from "../compile-provision-manifest";

function fixture() {
  const ba = Array.from({ length: 50 }, (_, i) => {
    const n = i + 1; const id = `BA-B${n <= 25 ? 1 : 2}-${String(n).padStart(2, "0")}`; const host = `ba-${n}.example.test`;
    return { record_id: id, public_firm_name: `BA Firm ${n}`, domain: host, owner: `BA Owner ${n}`, owner_role: "Founder", recipient_email: `${n === 1 ? "info" : `owner${n}`}@${host}`, route_class: n === 1 ? "generic_same_domain_solo" : "Direct", owner_evidence_url: `https://${host}/contact`, evidence_observed_at: "2026-08-25", asset_path: `assets/${id}.md`, asset_sha256: String(n).padStart(64, "0") };
  });
  const ae = Array.from({ length: 50 }, (_, i) => {
    const n = i + 1; const id = `AE-${String(n).padStart(3, "0")}`; const host = `ae-${n}.example.test`;
    return { record_id: id, firm: `AE Firm ${n}`, domain: host, recipient: `${n === 1 ? "help" : `owner${n}`}@${host}`, owner: `AE Owner ${n}`, owner_role: "Principal", route_class: n === 1 ? "generic_owner_operated" : "named_published", evidence_observed_at: "2026-08-25T23:30:02Z", journey_path: `journeys/${id}.json`, journey_sha256: String(n + 50).padStart(64, "0"), source_urls: [`https://${host}/team/owner`] };
  });
  const rows = [...ba.map((row) => ({ row, arm: "BA" })), ...ae.map((row) => ({ row, arm: "AE" }))];
  const evidence = rows.map(({ row, arm }) => ({ record_id: row.record_id, arm, firm: arm === "BA" ? row.public_firm_name : row.firm, person: row.owner, email: arm === "BA" ? row.recipient_email : row.recipient, domain: row.domain, ghl_contact_id: `contact-${row.record_id}`, ghl_smart_list_id: `list-${arm}`, touch_1: { payload_sha256: arm === "BA" ? row.asset_sha256 : row.journey_sha256, provisional_idempotency_key: `prospect-activity:v1:ghl:location:workflow-${arm}:${row.record_id}:touch-1:email` } }));
  return { baManifest: ba, aeManifest: { schema_version: "AE-evidence-first-manifest.v1.4", records: ae }, evidenceManifest: { schema_version: "verified-evidence.v0.1", generated_at: "2026-09-10T12:29:58.856Z", records: evidence } };
}

describe("provision manifest compiler", () => {
  it("is deterministic and enforces exact counts and unknown execution state", () => {
    const input = fixture(); const first = serializeProvisionManifest(compileProvisionManifest(input)); const second = serializeProvisionManifest(compileProvisionManifest(input)); const report = summarizeProvisionManifest(first);
    expect(second).toBe(first);
    expect(report.counts).toMatchObject({ total: 100, BA: 50, AE: 50, unique_cls_record_ids: 100, highlevel_contact_ids: 100, highlevel_location_ids: 1, highlevel_smart_list_ids: 2, highlevel_workflow_ids: 2, execution_history_unreconciled: 100, current_stage_unknown: 100 });
    expect(report.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("withholds generic routes and preserves named attribution and evidence dates", () => {
    const rows = compileProvisionManifest(fixture()).records; const generic = rows[0]; const named = rows[51];
    expect(generic.person?.primary_email).toBeNull();
    expect(generic.source_payload.contact_route).toMatchObject({ email: "info@ba-1.example.test", generic_inbox_withheld_from_person_primary_email: true });
    expect(named.person?.email_attribution).toMatchObject({ mailbox_type: "named_person", person_attribution_proven: true });
    expect(generic.source_payload.evidence[0].observed_at).toBe("2026-08-25T00:00:00.000Z");
    expect(named.source_payload.evidence[0].observed_at).toBe("2026-08-25T23:30:02.000Z");
  });
  it("fails closed on ID, identity, first-party, and payload drift", () => {
    const missing = fixture(); missing.baManifest.pop(); expect(() => compileProvisionManifest(missing)).toThrow("CLS ID set mismatch");
    const identity = fixture(); identity.evidenceManifest.records[0].firm = "Wrong"; expect(() => compileProvisionManifest(identity)).toThrow("firm differs");
    const external = fixture(); external.aeManifest.records[0].source_urls = ["https://directory.example/contact"]; expect(() => compileProvisionManifest(external)).toThrow("not first-party");
    const payload = fixture(); payload.evidenceManifest.records[0].touch_1.payload_sha256 = "f".repeat(64); expect(() => compileProvisionManifest(payload)).toThrow("payload SHA-256 differs");
  });
});
