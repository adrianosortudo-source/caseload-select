/**
 * Tests for parseProspectsPaste: JSON array / wrapper / single object, CSV with
 * header aliasing and quoted fields, fit_score coercion, and the no-firm_name
 * guard. This is the logic behind the operator bulk-import panel.
 */
import { describe, it, expect } from "vitest";
import { parseProspectsPaste } from "@/lib/agency-prospect-paste";

describe("parseProspectsPaste: JSON", () => {
  it("parses a JSON array of prospects", () => {
    const r = parseProspectsPaste('[{"firm_name":"Acme Law","city":"Toronto"}]');
    expect(r.format).toBe("json");
    expect(r.error).toBeNull();
    expect(r.withFirmName).toBe(1);
    expect(r.rows[0]).toMatchObject({ firm_name: "Acme Law", city: "Toronto" });
  });

  it("aliases export keys (email, phone, practice_areas) onto canonical fields", () => {
    const r = parseProspectsPaste(
      '{"firms":[{"firm_name":"Beta Law","email":"a@b.ca","phone":"416-555-0100","practice_areas":"Family"}]}',
    );
    expect(r.rows[0]).toMatchObject({
      firm_name: "Beta Law",
      contact_email: "a@b.ca",
      contact_phone: "416-555-0100",
      practice_area: "Family",
    });
  });

  it("treats a single JSON object as one prospect", () => {
    const r = parseProspectsPaste('{"firm_name":"Solo Law"}');
    expect(r.withFirmName).toBe(1);
    expect(r.rows).toHaveLength(1);
  });

  it("coerces a numeric-string fit_score and drops a non-numeric one", () => {
    expect(parseProspectsPaste('[{"firm_name":"A","fit_score":"80"}]').rows[0].fit_score).toBe(80);
    expect(parseProspectsPaste('[{"firm_name":"A","fit_score":"high"}]').rows[0].fit_score).toBeUndefined();
  });

  it("reports a parse error on malformed JSON", () => {
    const r = parseProspectsPaste("[{bad json}]");
    expect(r.error).toContain("JSON");
    expect(r.rows).toHaveLength(0);
  });
});

describe("parseProspectsPaste: CSV", () => {
  it("parses CSV with a header row and aliased columns", () => {
    const csv = "Firm Name,Email,City\nAcme Law,a@b.ca,Toronto\nBeta Law,,Markham";
    const r = parseProspectsPaste(csv);
    expect(r.format).toBe("csv");
    expect(r.withFirmName).toBe(2);
    expect(r.rows[0]).toMatchObject({ firm_name: "Acme Law", contact_email: "a@b.ca", city: "Toronto" });
    expect(r.rows[1]).toMatchObject({ firm_name: "Beta Law", city: "Markham" });
  });

  it("handles quoted fields containing commas and escaped quotes", () => {
    const csv = 'firm_name,notes\n"Smith, Jones LLP","Said ""yes"" on call"';
    const r = parseProspectsPaste(csv);
    expect(r.rows[0].firm_name).toBe("Smith, Jones LLP");
    expect(r.rows[0].notes).toBe('Said "yes" on call');
  });

  it("errors when CSV has only a header row", () => {
    const r = parseProspectsPaste("firm_name,city");
    expect(r.error).toContain("data row");
  });
});

describe("parseProspectsPaste: guards", () => {
  it("returns empty (no error) on blank input", () => {
    const r = parseProspectsPaste("   ");
    expect(r.format).toBe("empty");
    expect(r.rows).toHaveLength(0);
    expect(r.error).toBeNull();
  });

  it("flags input with no firm_name", () => {
    const r = parseProspectsPaste('[{"city":"Toronto"}]');
    expect(r.withFirmName).toBe(0);
    expect(r.error).toContain("firm_name");
  });
});
