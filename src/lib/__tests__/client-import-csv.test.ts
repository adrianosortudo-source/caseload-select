import { describe, expect, it } from "vitest";
import { parseClientImportCsv, parseCsvRecords } from "@/lib/client-import-csv";

const HEADER = "first_name,last_name,email,phone,relationship_type,practice_area,matter_closed_year,marketing_permission";

describe("Secure Import Room CSV parsing", () => {
  it("handles BOM, CRLF, quoted commas, and quoted newlines", () => {
    const records = parseCsvRecords('\uFEFFfirst_name,practice_area\r\n"Ana","Corporate, Commercial"\r\n"Jo","Family\nLaw"');
    expect(records).toEqual([
      ["first_name", "practice_area"],
      ["Ana", "Corporate, Commercial"],
      ["Jo", "Family\nLaw"],
    ]);
  });

  it("normalizes identity but never infers permission", () => {
    const result = parseClientImportCsv(`${HEADER}\nAna,Silva,ANA@EXAMPLE.COM,(416) 555-0123,former client,Corporate,2025,`);
    expect(result.ok).toBe(true);
    expect(result.rows[0]).toMatchObject({
      email: "ana@example.com",
      phone: "+14165550123",
      relationshipType: "former_client",
      marketingPermission: "unknown",
    });
  });

  it("rejects missing or duplicate headers", () => {
    const missing = parseClientImportCsv("first_name,email\nAna,a@example.com");
    expect(missing.ok).toBe(false);
    expect(missing.missingHeaders).toContain("marketing_permission");
    const duplicate = parseClientImportCsv(`${HEADER},email\nAna,S,a@example.com,,former_client,Corporate,2025,unknown,a@example.com`);
    expect(duplicate.issues[0]?.message).toContain("Duplicate columns");
  });

  it("rejects privileged-content columns", () => {
    const result = parseClientImportCsv(`${HEADER},notes\nAna,S,a@example.com,,former_client,Corporate,2025,unknown,legal advice`);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain("privileged");
  });

  it("rejects duplicate normalized identities", () => {
    const result = parseClientImportCsv(
      `${HEADER}\nAna,S,A@example.com,,former_client,Corporate,2025,unknown\nAna,S,a@example.com,,former_client,Corporate,2025,unknown`,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes("Duplicates row 2"))).toBe(true);
  });

  it("requires a name and at least one valid identifier", () => {
    const result = parseClientImportCsv(`${HEADER}\n,,,,unknown,,,unknown`);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(["name", "identity"]));
  });
});
