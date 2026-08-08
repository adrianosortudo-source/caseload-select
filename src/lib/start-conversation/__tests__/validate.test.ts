import { describe, it, expect } from "vitest";
import {
  validateSubmission,
  isValidEmail,
  provinceLabel,
  honeypotTripped,
  HONEYPOT_FIELD,
  MAX_NAME,
  MAX_FREE_TEXT,
} from "../validate";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    practice_area: "employment",
    practice_area_other: "",
    firm_size: "just_me",
    prompt_reason: "too_few_inquiries",
    prompt_reason_other: "",
    decision_role: "i_do",
    timeline: "this_month",
    name: "Jordan Lee",
    firm_name: "Lee Law",
    email: "jordan@leelaw.ca",
    province: "ON",
    ...overrides,
  };
}

describe("isValidEmail", () => {
  it("accepts a plain address", () => {
    expect(isValidEmail("adriano@caseloadselect.ca")).toBe(true);
  });

  it("rejects missing @, whitespace, and header-injection shapes", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a b@example.com")).toBe(false);
    expect(isValidEmail("a@example.com\r\nBcc: x@evil.com")).toBe(false);
    expect(isValidEmail("a@example.com,b@example.com")).toBe(false);
  });

  it("rejects an address longer than the RFC 5321 path cap", () => {
    const long = "a".repeat(250) + "@x.co";
    expect(isValidEmail(long)).toBe(false);
  });
});

describe("provinceLabel", () => {
  it("resolves a known code", () => {
    expect(provinceLabel("ON")).toBe("Ontario");
  });

  it("returns null for an unknown code", () => {
    expect(provinceLabel("XX")).toBeNull();
  });
});

describe("validateSubmission — happy path", () => {
  it("accepts a fully valid body and resolves the outcome", () => {
    const result = validateSubmission(validBody());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.submission.contact.email).toBe("jordan@leelaw.ca");
    expect(result.submission.outcome).toBe("booking");
  });

  it("keeps free text only for the option that reveals it", () => {
    const result = validateSubmission(
      validBody({ practice_area: "something_else", practice_area_other: "Notary work" }),
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.submission.answers.practice_area_other).toBe("Notary work");
  });

  it("drops free text posted against a non-revealing option", () => {
    const result = validateSubmission(validBody({ practice_area: "family", practice_area_other: "ignored" }));
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.submission.answers.practice_area_other).toBeNull();
  });
});

describe("validateSubmission — rejections", () => {
  it("rejects a non-object body", () => {
    expect(validateSubmission(null).valid).toBe(false);
    expect(validateSubmission("string").valid).toBe(false);
    expect(validateSubmission([]).valid).toBe(false);
  });

  it("rejects a missing question answer", () => {
    const body = validBody();
    delete (body as Record<string, unknown>).timeline;
    const result = validateSubmission(body);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error).toContain("timeline");
  });

  it("rejects a question answer outside the closed option list", () => {
    const result = validateSubmission(validBody({ practice_area: "tax_law" }));
    expect(result.valid).toBe(false);
  });

  it("rejects free text longer than the cap", () => {
    const result = validateSubmission(
      validBody({ practice_area: "something_else", practice_area_other: "x".repeat(MAX_FREE_TEXT + 1) }),
    );
    expect(result.valid).toBe(false);
  });

  it("rejects a missing name", () => {
    const body = validBody({ name: "" });
    expect(validateSubmission(body).valid).toBe(false);
  });

  it("rejects a name longer than the cap", () => {
    const result = validateSubmission(validBody({ name: "x".repeat(MAX_NAME + 1) }));
    expect(result.valid).toBe(false);
  });

  it("rejects a missing or invalid email", () => {
    expect(validateSubmission(validBody({ email: "" })).valid).toBe(false);
    expect(validateSubmission(validBody({ email: "not-an-email" })).valid).toBe(false);
  });

  it("rejects an invalid province", () => {
    expect(validateSubmission(validBody({ province: "ZZ" })).valid).toBe(false);
  });

  it("does not throw on wrong-typed fields", () => {
    const body = validBody({ name: 12345, email: { nested: true } });
    expect(() => validateSubmission(body)).not.toThrow();
    expect(validateSubmission(body).valid).toBe(false);
  });
});

describe("honeypotTripped", () => {
  it("is false when the honeypot field is empty or absent", () => {
    expect(honeypotTripped(validBody())).toBe(false);
    expect(honeypotTripped(validBody({ [HONEYPOT_FIELD]: "" }))).toBe(false);
  });

  it("is true when the honeypot field carries any value", () => {
    expect(honeypotTripped(validBody({ [HONEYPOT_FIELD]: "http://spam.example" }))).toBe(true);
  });

  it("does not throw on a non-object body", () => {
    expect(honeypotTripped(null)).toBe(false);
    expect(honeypotTripped("x")).toBe(false);
  });
});
