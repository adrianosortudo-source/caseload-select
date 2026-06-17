import { describe, it, expect } from "vitest";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  roleLabel,
  isAssignableRole,
  normalizeEmail,
  validateMemberInput,
  memberStatusLabel,
} from "../firm-members-pure";

describe("isAssignableRole", () => {
  it("accepts admin and staff", () => {
    for (const r of ASSIGNABLE_ROLES) expect(isAssignableRole(r)).toBe(true);
    expect(isAssignableRole("admin")).toBe(true);
    expect(isAssignableRole("staff")).toBe(true);
  });

  it("rejects operator, lawyer, and junk (not assignable from the tool)", () => {
    expect(isAssignableRole("operator")).toBe(false);
    expect(isAssignableRole("lawyer")).toBe(false);
    expect(isAssignableRole("")).toBe(false);
    expect(isAssignableRole("owner")).toBe(false);
  });
});

describe("roleLabel", () => {
  it("labels known roles", () => {
    expect(roleLabel("admin")).toBe(ROLE_LABELS.admin);
    expect(roleLabel("staff")).toBe(ROLE_LABELS.staff);
    expect(roleLabel("lawyer")).toBe("Lawyer");
    expect(roleLabel("operator")).toBe("Operator");
  });

  it("falls back for unknown / empty", () => {
    expect(roleLabel(null)).toBe("Member");
    expect(roleLabel(undefined)).toBe("Member");
    expect(roleLabel("captain")).toBe("captain");
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Damaris@DRG.COM ")).toBe("damaris@drg.com");
    expect(normalizeEmail("")).toBe("");
  });
});

describe("validateMemberInput", () => {
  const base = { email: "damaris@drg.com", role: "admin", displayName: "Damaris", title: "Principal" };

  it("accepts a clean input and normalises", () => {
    const v = validateMemberInput({ ...base, email: "  Damaris@DRG.com " });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.email).toBe("damaris@drg.com");
      expect(v.role).toBe("admin");
      expect(v.displayName).toBe("Damaris");
      expect(v.title).toBe("Principal");
    }
  });

  it("collapses blank optional fields to null", () => {
    const v = validateMemberInput({ email: "a@b.com", role: "staff", displayName: "   ", title: "" });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.displayName).toBeNull();
      expect(v.title).toBeNull();
    }
  });

  it("rejects a missing email", () => {
    const v = validateMemberInput({ ...base, email: "   " });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("missing_email");
  });

  it("rejects an invalid email", () => {
    const v = validateMemberInput({ ...base, email: "not-an-email" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("invalid_email");
  });

  it("rejects a non-assignable role", () => {
    expect(validateMemberInput({ ...base, role: "operator" }).ok).toBe(false);
    const v = validateMemberInput({ ...base, role: "lawyer" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("invalid_role");
  });
});

describe("memberStatusLabel", () => {
  it("Disabled wins over everything", () => {
    expect(
      memberStatusLabel({ disabled: true, last_signed_in_at: "2026-06-01", invitation_sent_at: "2026-06-01" }),
    ).toBe("Disabled");
  });

  it("Active when signed in", () => {
    expect(
      memberStatusLabel({ disabled: false, last_signed_in_at: "2026-06-01", invitation_sent_at: "2026-06-01" }),
    ).toBe("Active");
  });

  it("Invited when invite sent but never signed in", () => {
    expect(
      memberStatusLabel({ disabled: false, last_signed_in_at: null, invitation_sent_at: "2026-06-01" }),
    ).toBe("Invited");
  });

  it("Not invited when nothing has happened", () => {
    expect(
      memberStatusLabel({ disabled: false, last_signed_in_at: null, invitation_sent_at: null }),
    ).toBe("Not invited");
  });
});
