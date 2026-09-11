import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260910141025_provision_prospect_source_batch.sql",
), "utf8");

describe("prospecting batch RPC migration contract", () => {
  it("is invoker-rights and callable only by service_role", () => {
    expect(migration).toMatch(/SECURITY INVOKER/i);
    expect(migration).not.toMatch(/SECURITY DEFINER/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.provision_prospect_source_batch\(jsonb, uuid, boolean\) FROM PUBLIC/i);
    expect(migration).toMatch(/FROM anon/i);
    expect(migration).toMatch(/FROM authenticated/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.provision_prospect_source_batch\(jsonb, uuid, boolean\) TO service_role/i);
  });

  it("enforces the exact cohort and deterministic source identity", () => {
    expect(migration).toContain("jsonb_array_length(p_manifest->'records') <> 100");
    expect(migration).toContain("v_ba_count <> 50 OR v_ae_count <> 50");
    expect(migration).toContain("'prospecting_control_plane'");
    expect(migration).toContain("'prospecting_control_plane:provision:' || v_cls_record_id || ':v1'");
    expect(migration).toMatch(/duplicate CLS record id/i);
    expect(migration).toMatch(/source_url must be first-party to organization website/i);
    expect(migration).toMatch(/generic firm inbox cannot populate person primary_email/i);
    expect(migration).toMatch(/person primary_email requires explicit named-person attribution/i);
    expect(migration).toMatch(/person email attribution evidence must be first-party/i);
    expect(migration).toContain("jsonb_array_elements(v_record->'source_payload'->'highlevel'->'workflow_ids')");
    expect(migration).toMatch(/invalid organization/i);
    expect(migration).toMatch(/provisioning basis is required/i);
    expect(migration).toMatch(/invalid person phone/i);
    expect(migration).toMatch(/invalid person role title/i);
    expect(migration).toContain("NOT (v_record->'organization' ?& ARRAY['display_name', 'city', 'website_url'])");
    expect(migration).toContain("NOT (v_record->'person' ?& ARRAY['display_name', 'primary_email', 'primary_phone', 'role_title', 'email_attribution'])");
    expect(migration).toContain("record is missing required fields");
    expect(migration).toContain("position('T' IN v_evidence->>'observed_at') = 0");
  });

  it("preflights before one guarded provisioning call and asserts the final state", () => {
    const preflight = migration.indexOf("-- Preflight every stable source key");
    const provision = migration.indexOf("FROM public.provision_prospect_source_record(");
    expect(preflight).toBeGreaterThan(0);
    expect(provision).toBeGreaterThan(preflight);
    expect(migration.match(/FROM public\.provision_prospect_source_record\(/g)).toHaveLength(1);
    expect(migration).toMatch(/expected exactly one provisioning event for existing source/i);
    expect(migration).toMatch(/existing source provenance conflicts with manifest/i);
    expect(migration).toContain("event.provisioning_basis");
    expect(migration).toContain("'operatorProvisionedOrganization'");
    expect(migration).toContain("'operatorProvisionedPerson'");
    expect(migration).toContain("'{person_email_attribution}'");
    expect(migration).toContain("v_record->'person'->'email_attribution'");
    expect(migration).toMatch(/source payload exceeds 50000 bytes after attribution preservation/i);
    expect(migration).toContain("IF p_apply THEN");
    expect(migration).toContain("v_total_after <> 100 OR v_receipt_count <> 100");
    expect(migration).toContain("jsonb_array_length(v_receipts) <> 100");
    expect(migration).toMatch(/existing organization identity conflicts with manifest/i);
    expect(migration).toMatch(/existing person identity conflicts with manifest/i);
    expect(migration).toMatch(/existing primary person role conflicts with manifest/i);
    expect(migration).toMatch(/existing conversation identity conflicts with source/i);
    expect(migration).toMatch(/existing primary conversation\/source association is inconsistent/i);
    expect(migration).toMatch(/post-apply canonical identity cardinality assertion failed/i);
    expect(migration).toMatch(/post-apply organization\/person\/role\/conversation\/association bijection assertion failed/i);
    expect(migration).toContain("count(DISTINCT source_link.organization_id)");
    expect(migration).toContain("count(DISTINCT event.conversation_id)");
    expect(migration).toContain("association.is_primary = true");
  });

  it("fails closed when an existing source has any material provenance drift", () => {
    expect(migration).toMatch(/v_existing_source_url IS DISTINCT FROM btrim\(v_record->>'source_url'\)/i);
    expect(migration).toMatch(/v_existing_source_payload IS DISTINCT FROM v_expected_source_payload/i);
    expect(migration).toMatch(/v_event_provisioning_basis IS DISTINCT FROM btrim\(v_record->>'provisioning_basis'\)/i);
    expect(migration).toMatch(/existing source provenance conflicts with manifest/i);
  });

  it("never mutates activities and proves their count is unchanged", () => {
    expect(migration).toContain("v_activity_after <> v_activity_before");
    expect(migration).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.prospect_activities/i);
  });
});
