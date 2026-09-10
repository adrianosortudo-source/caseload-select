import { describe, expect, it } from "vitest";

import {
  PROSPECTING_MANIFEST_SCHEMA_VERSION,
  provisioningIdempotencyKey,
  validateProspectProvisionManifest,
} from "../manifest";

function record(arm: "BA" | "AE", index: number) {
  const domain = `${arm.toLowerCase()}-${index}.example.test`;
  return {
    cls_record_id: `${arm}-B1-${String(index).padStart(2, "0")}`,
    arm,
    source_url: `https://${domain}/team/owner`,
    organization: { display_name: `${arm} Firm ${index}`, city: "Toronto", website_url: `https://${domain}/` },
    person: {
      display_name: `${arm} Owner ${index}`,
      primary_email: `owner${index}@${domain}`,
      primary_phone: null,
      role_title: "Owner",
      email_attribution: {
        mailbox_type: "named_person",
        person_attribution_proven: true,
        evidence_url: `https://${domain}/team/owner`,
      },
    },
    source_payload: {
      arm,
      method: arm === "BA" ? "beyond_agency" : "adam_erhart",
      evidence: [{ url: `https://${domain}/team/owner`, observed_at: "2026-09-10T12:00:00Z", label: "Owner page" }],
      highlevel: { location_id: "location", contact_id: `contact-${arm}-${index}`, smart_list_id: null, workflow_ids: [] },
    },
    provisioning_basis: "First-party owner page and reconciled Control Plane identity.",
  };
}

function manifest() {
  return {
    schema_version: PROSPECTING_MANIFEST_SCHEMA_VERSION,
    generated_at: "2026-09-10T12:00:00Z",
    records: [
      ...Array.from({ length: 50 }, (_, index) => record("BA", index + 1)),
      ...Array.from({ length: 50 }, (_, index) => record("AE", index + 1)),
    ],
  };
}

describe("validateProspectProvisionManifest", () => {
  it("accepts exactly 50 BA and 50 AE records and derives stable idempotency keys", () => {
    const validated = validateProspectProvisionManifest(JSON.stringify(manifest()));
    expect(validated.records).toHaveLength(100);
    expect(validated.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(provisioningIdempotencyKey("BA-B1-01")).toBe("prospecting_control_plane:provision:BA-B1-01:v1");
  });

  it("rejects the wrong total or arm split", () => {
    const tooShort = manifest();
    tooShort.records.pop();
    expect(() => validateProspectProvisionManifest(JSON.stringify(tooShort))).toThrow("exactly 100");

    const wrongSplit = manifest();
    wrongSplit.records[0] = record("AE", 51);
    expect(() => validateProspectProvisionManifest(JSON.stringify(wrongSplit))).toThrow("exactly 50 BA");
  });

  it("rejects duplicate firm identities rather than fuzzy-merging them", () => {
    const duplicateWebsite = manifest();
    duplicateWebsite.records[1].organization.website_url = duplicateWebsite.records[0].organization.website_url;
    duplicateWebsite.records[1].source_url = duplicateWebsite.records[0].source_url;
    expect(() => validateProspectProvisionManifest(JSON.stringify(duplicateWebsite))).toThrow("Duplicate organization website");

    const duplicateEmail = manifest();
    duplicateEmail.records[1].person!.primary_email = duplicateEmail.records[0].person!.primary_email;
    expect(() => validateProspectProvisionManifest(JSON.stringify(duplicateEmail))).toThrow("Duplicate person primary email");
  });

  it("requires a first-party source and complete evidence/HighLevel payload", () => {
    const externalSource = manifest();
    externalSource.records[0].source_url = "https://directory.example.test/owner";
    expect(() => validateProspectProvisionManifest(JSON.stringify(externalSource))).toThrow("must be first-party");

    const missingHighLevel = manifest() as ReturnType<typeof manifest> & { records: Array<Record<string, unknown>> };
    delete (missingHighLevel.records[0].source_payload as Record<string, unknown>).highlevel;
    expect(() => validateProspectProvisionManifest(JSON.stringify(missingHighLevel))).toThrow("source_payload.highlevel must be an object");
  });

  it("always blocks a generic firm inbox from person.primary_email", () => {
    const generic = manifest();
    generic.records[0].person!.primary_email = "info@ba-1.example.test";
    generic.records[0].person!.email_attribution = {
      mailbox_type: "generic_firm",
      person_attribution_proven: true,
      evidence_url: "https://ba-1.example.test/team/owner",
    };
    expect(() => validateProspectProvisionManifest(JSON.stringify(generic))).toThrow("generic firm inbox");
    generic.records[0].person!.primary_email = null;
    generic.records[0].person!.email_attribution = null;
    expect(validateProspectProvisionManifest(JSON.stringify(generic)).records[0].person?.primary_email).toBeNull();
  });

  it("requires first-party named-person attribution for every person email", () => {
    const unproven = manifest();
    unproven.records[0].person!.email_attribution!.person_attribution_proven = false;
    expect(() => validateProspectProvisionManifest(JSON.stringify(unproven))).toThrow("named-person attribution");

    const attributionWithoutEmail = manifest();
    attributionWithoutEmail.records[0].person!.primary_email = null;
    expect(() => validateProspectProvisionManifest(JSON.stringify(attributionWithoutEmail))).toThrow("must be null");
  });

  it("rejects null or undersized material provenance fields before RPC", () => {
    const missingFirmName = manifest();
    (missingFirmName.records[0].organization as { display_name: unknown }).display_name = null;
    expect(() => validateProspectProvisionManifest(JSON.stringify(missingFirmName))).toThrow("display_name must be a string");

    const shortPhone = manifest();
    shortPhone.records[0].person!.primary_phone = "1";
    expect(() => validateProspectProvisionManifest(JSON.stringify(shortPhone))).toThrow("3-80 characters");

    const missingBasis = manifest();
    (missingBasis.records[0] as { provisioning_basis: unknown }).provisioning_basis = null;
    expect(() => validateProspectProvisionManifest(JSON.stringify(missingBasis))).toThrow("provisioning_basis must be a string");
  });

  it("rejects oversized source payloads", () => {
    const oversized = manifest();
    (oversized.records[0].source_payload as Record<string, unknown>).oversized = "x".repeat(50_001);
    expect(() => validateProspectProvisionManifest(JSON.stringify(oversized))).toThrow("source_payload exceeds");
  });
});
