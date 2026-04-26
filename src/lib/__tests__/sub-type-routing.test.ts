/**
 * Sub-Type Routing Tests
 *
 * Verifies resolveQuestionSetKey() and umbrellaFromSubType() for every sub-type
 * in the taxonomy. Also confirms every sub-type key resolves to an entry in
 * DEFAULT_QUESTION_MODULES.
 */

import { describe, it, expect } from "vitest";
import { resolveQuestionSetKey, umbrellaFromSubType, SUB_TYPES, SINGLE_SET_PAS } from "../sub-types";
import { DEFAULT_QUESTION_MODULES } from "../default-question-modules";

// ─── resolveQuestionSetKey ────────────────────────────────────────────────────

describe("resolveQuestionSetKey  -  single-set PAs", () => {
  const singleSetSamples = ["real", "corp", "est", "llt", "ip", "tax", "admin", "bank", "priv"];

  for (const pa of singleSetSamples) {
    it(`returns the PA id for ${pa} regardless of sub-type`, () => {
      expect(resolveQuestionSetKey(pa, null)).toBe(pa);
      expect(resolveQuestionSetKey(pa, "some_subtype")).toBe(pa);
    });
  }
});

describe("resolveQuestionSetKey  -  sub-typed PAs with valid sub-type", () => {
  for (const [pa, subtypes] of Object.entries(SUB_TYPES)) {
    for (const subtype of subtypes) {
      it(`${pa} + ${subtype} → "${subtype}"`, () => {
        expect(resolveQuestionSetKey(pa, subtype)).toBe(subtype);
      });
    }
  }
});

describe("resolveQuestionSetKey  -  sub-typed PAs with null sub-type", () => {
  for (const pa of Object.keys(SUB_TYPES)) {
    it(`${pa} + null → "${pa}_other"`, () => {
      expect(resolveQuestionSetKey(pa, null)).toBe(`${pa}_other`);
    });
  }
});

describe("resolveQuestionSetKey  -  sub-typed PAs with invalid sub-type", () => {
  for (const pa of Object.keys(SUB_TYPES)) {
    it(`${pa} + "garbage" → "${pa}_other"`, () => {
      expect(resolveQuestionSetKey(pa, "garbage")).toBe(`${pa}_other`);
    });
  }
});

describe("resolveQuestionSetKey  -  cross-PA sub-type confusion", () => {
  it("pi sub-type is not valid for emp PA", () => {
    expect(resolveQuestionSetKey("emp", "pi_mva")).toBe("emp_other");
  });
  it("emp sub-type is not valid for fam PA", () => {
    expect(resolveQuestionSetKey("fam", "emp_dismissal")).toBe("fam_other");
  });
  it("crim sub-type is not valid for ins PA", () => {
    expect(resolveQuestionSetKey("ins", "crim_dui")).toBe("ins_other");
  });
  it("imm sub-type is not valid for civ PA", () => {
    expect(resolveQuestionSetKey("civ", "imm_ee")).toBe("civ_other");
  });
});

// ─── umbrellaFromSubType ──────────────────────────────────────────────────────

describe("umbrellaFromSubType", () => {
  const testCases: Array<[string, string]> = [
    ["pi_mva", "pi"],
    ["pi_slip_fall", "pi"],
    ["pi_dog_bite", "pi"],
    ["pi_med_mal", "pi"],
    ["pi_product", "pi"],
    ["pi_workplace", "pi"],
    ["pi_assault_ci", "pi"],
    ["pi_other", "pi"],
    ["emp_dismissal", "emp"],
    ["emp_harassment", "emp"],
    ["emp_wage", "emp"],
    ["emp_disc", "emp"],
    ["emp_constructive", "emp"],
    ["emp_other", "emp"],
    ["fam_divorce", "fam"],
    ["fam_custody", "fam"],
    ["fam_support", "fam"],
    ["fam_property", "fam"],
    ["fam_protection", "fam"],
    ["fam_other", "fam"],
    ["crim_dui", "crim"],
    ["crim_assault", "crim"],
    ["crim_drug", "crim"],
    ["crim_theft", "crim"],
    ["crim_domestic", "crim"],
    ["crim_other", "crim"],
    ["imm_ee", "imm"],
    ["imm_spousal", "imm"],
    ["imm_study", "imm"],
    ["imm_work_permit", "imm"],
    ["imm_refugee", "imm"],
    ["imm_pnp", "imm"],
    ["imm_other", "imm"],
    ["civ_contract", "civ"],
    ["civ_debt", "civ"],
    ["civ_tort", "civ"],
    ["civ_negligence", "civ"],
    ["civ_other", "civ"],
    ["ins_sabs", "ins"],
    ["ins_denial", "ins"],
    ["ins_bad_faith", "ins"],
    ["ins_other", "ins"],
  ];

  for (const [subtype, expected] of testCases) {
    it(`"${subtype}" → "${expected}"`, () => {
      expect(umbrellaFromSubType(subtype)).toBe(expected);
    });
  }

  it("returns null for unknown sub-type", () => {
    expect(umbrellaFromSubType("unknown_xyz")).toBeNull();
  });
});

// ─── DEFAULT_QUESTION_MODULES coverage ───────────────────────────────────────

describe("DEFAULT_QUESTION_MODULES  -  every sub-type key has a question set", () => {
  for (const [pa, subtypes] of Object.entries(SUB_TYPES)) {
    for (const subtype of subtypes) {
      it(`DEFAULT_QUESTION_MODULES["${subtype}"] exists`, () => {
        expect(DEFAULT_QUESTION_MODULES[subtype]).toBeDefined();
        expect(DEFAULT_QUESTION_MODULES[subtype].questions.length).toBeGreaterThan(0);
      });
    }

    it(`DEFAULT_QUESTION_MODULES["${pa}_other"] exists`, () => {
      // _other is included in the subtypes array, but verify explicitly
      expect(DEFAULT_QUESTION_MODULES[`${pa}_other`]).toBeDefined();
    });
  }

  it("every single-set PA has a question set entry", () => {
    for (const pa of SINGLE_SET_PAS) {
      expect(DEFAULT_QUESTION_MODULES[pa]).toBeDefined();
    }
  });
});

// ─── Practice area completeness ───────────────────────────────────────────────

describe("SUB_TYPES completeness", () => {
  it("every sub-typed PA has an _other fallback", () => {
    for (const [pa, subtypes] of Object.entries(SUB_TYPES)) {
      expect(subtypes).toContain(`${pa}_other`);
    }
  });

  it("fam is NOT in SINGLE_SET_PAS (it has sub-type routing)", () => {
    expect(SINGLE_SET_PAS.has("fam")).toBe(false);
  });

  it("pi is NOT in SINGLE_SET_PAS", () => {
    expect(SINGLE_SET_PAS.has("pi")).toBe(false);
  });

  it("ins is NOT in SINGLE_SET_PAS", () => {
    expect(SINGLE_SET_PAS.has("ins")).toBe(false);
  });

  it("real IS in SINGLE_SET_PAS", () => {
    expect(SINGLE_SET_PAS.has("real")).toBe(true);
  });

  it("llt IS in SINGLE_SET_PAS", () => {
    expect(SINGLE_SET_PAS.has("llt")).toBe(true);
  });
});
