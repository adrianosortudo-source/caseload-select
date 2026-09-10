import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const readback = readFileSync(resolve(process.cwd(), "scripts/ghl-prospect-readback/index.mjs"), "utf8");

describe("HighLevel prospect read-back safety contract", () => {
  it("requires the canonical provisioning manifest and all fixed-location contact identities before GET", () => {
    expect(readback).toContain("PROVISION_MANIFEST_SCHEMA = 'prospecting-control-plane-provision-manifest-v1'");
    expect(readback).toContain("manifest: null");
    expect(readback).toContain("--manifest is required and must name the canonical provisioning manifest");
    expect(readback).toContain("record.cls_record_id");
    expect(readback).toContain("record?.source_payload?.highlevel");
    expect(readback).toContain("non-null HighLevel contact_id is required");
    expect(readback).toContain("highlevel.location_id === LOCATION_ID");
    expect(readback.indexOf("canonicalReadbackRecords(manifest)")).toBeLessThan(readback.indexOf("const preflight = await ghGet"));
  });

  it("halts on any provider payload carrying a different location", () => {
    expect(readback).toContain("function locationMismatches");
    expect(readback).toContain("HighLevel returned data for a different location");
    expect(readback).toContain("key === 'locationId' || key === 'location_id'");
  });
});
