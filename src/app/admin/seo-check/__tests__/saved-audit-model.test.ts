import { describe, expect, it } from "vitest";
import { parseSavedMethodologyVersion, SAVED_AUDIT_LIST_COLUMNS } from "../saved-audit-model";

describe("saved SEO audit history projection", () => {
  it("selects only scalar methodology-version evidence from result JSON", () => {
    expect(SAVED_AUDIT_LIST_COLUMNS).toContain("methodologyVersion:result->>methodologyVersion");
    expect(SAVED_AUDIT_LIST_COLUMNS).not.toMatch(/,\s*result(?:,|$)/);
  });

  it("normalizes recorded versions and leaves absent or invalid values unrecorded", () => {
    expect(parseSavedMethodologyVersion("5")).toBe(5);
    expect(parseSavedMethodologyVersion(4)).toBe(4);
    expect(parseSavedMethodologyVersion(null)).toBeNull();
    expect(parseSavedMethodologyVersion("0")).toBeNull();
    expect(parseSavedMethodologyVersion("future")).toBeNull();
  });
});