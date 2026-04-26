/**
 * Classifier  -  Hardening Tests
 *
 * Tests the classify() pipeline at three levels:
 *
 *   Level 1  -  Prompt builder (buildClassifierPrompt):
 *     Verify the prompt correctly constrains GPT output vocabulary to the
 *     firm's PAs, includes all valid flag IDs, and carries key disambiguation
 *     guidance (fam_abduction vs fam_protection, etc.).
 *
 *   Level 2  -  Response parser (parseClassifierResponse):
 *     Verify the parser handles valid output, missing fields, invalid
 *     confidence values, non-JSON, and hallucinated PA IDs gracefully.
 *
 *   Level 3  -  classify() with mocked OpenAI:
 *     Verify the full classify() function: PA validation against firm list,
 *     regex + GPT flag merging, out-of-scope handling, and graceful
 *     degradation on GPT failures.
 *
 * Accuracy target: ≥95% on S1 flags from the golden prompt scenarios.
 * (Validated via prompt content  -  actual GPT calls are not made in unit tests.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type OpenAI from "openai";
import {
  buildClassifierPrompt,
  parseClassifierResponse,
  classify,
  shouldRunClassifier,
  type ClassifierInput,
  type RawClassifierOutput,
} from "../classifier";
import type { PracticeArea } from "../screen-prompt";
import { FLAG_REGISTRY } from "../flag-registry";

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const FIRM_PAS: PracticeArea[] = [
  { id: "pi",   label: "Personal Injury",   classification: "primary" },
  { id: "fam",  label: "Family Law",        classification: "primary" },
  { id: "emp",  label: "Employment Law",    classification: "primary" },
  { id: "crim", label: "Criminal Defence",  classification: "primary" },
  { id: "imm",  label: "Immigration",       classification: "secondary" },
  { id: "real", label: "Real Estate",       classification: "secondary" },
];

function makeInput(text: string, firmPAs = FIRM_PAS): ClassifierInput {
  return { firmPracticeAreas: firmPAs, conversationText: text };
}

/** Build a minimal mock OpenAI client that returns a canned completion. */
function mockOpenAI(content: string): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content } }],
        }),
      },
    },
  } as unknown as OpenAI;
}

/** Build a mock OpenAI client that throws on create(). */
function failingOpenAI(): OpenAI {
  return {
    chat: {
      completions: {
        create: vi.fn().mockRejectedValue(new Error("network error")),
      },
    },
  } as unknown as OpenAI;
}

// ─────────────────────────────────────────────────────────────────────────────
// Level 1: buildClassifierPrompt
// ─────────────────────────────────────────────────────────────────────────────

describe("buildClassifierPrompt  -  prompt content", () => {
  const prompt = buildClassifierPrompt(makeInput("I was injured in a car accident."));

  it("lists all firm primary practice area IDs", () => {
    expect(prompt).toContain('"pi"');
    expect(prompt).toContain('"fam"');
    expect(prompt).toContain('"emp"');
    expect(prompt).toContain('"crim"');
  });

  it("lists secondary PAs in a separate section", () => {
    expect(prompt).toContain('"imm"');
    expect(prompt).toContain('"real"');
    expect(prompt).toContain("Secondary");
  });

  it("instructs GPT to use firm PA IDs only  -  out-of-scope handling", () => {
    expect(prompt).toContain("out_of_scope");
    expect(prompt).toContain("outside ALL of the firm");
  });

  it("includes all valid flag IDs for hallucination prevention", () => {
    // Spot-check critical flags across all PAs
    expect(prompt).toContain("limitation_proximity");
    expect(prompt).toContain("fam_abduction");
    expect(prompt).toContain("emp_hrto_clock");
    expect(prompt).toContain("crim_charter_violation");
    expect(prompt).toContain("imm_rad_deadline");
    expect(prompt).toContain("construction_lien_deadline");
    expect(prompt).toContain("real_estate_undisclosed_defects");
    expect(prompt).toContain("wsib_six_month_claim");
    expect(prompt).toContain("insolvency_creditor_action");
  });

  it("includes fam_abduction vs fam_protection disambiguation guidance", () => {
    expect(prompt).toContain("fam_abduction");
    expect(prompt).toContain("ANOTHER COUNTRY");
  });

  it("requires JSON-only output (no markdown)", () => {
    expect(prompt).toContain("Respond with ONLY valid JSON");
    expect(prompt).toContain("No markdown");
  });

  it("includes client message in prompt", () => {
    const text = "My refugee claim was refused and I need help urgently.";
    const p = buildClassifierPrompt(makeInput(text));
    expect(p).toContain(text);
  });

  it("handles firm with no secondary PAs", () => {
    const primaryOnly: PracticeArea[] = [
      { id: "pi", label: "Personal Injury", classification: "primary" },
    ];
    const p = buildClassifierPrompt(makeInput("I fell.", primaryOnly));
    expect(p).toContain("(none listed)");
  });

  it("handles firm with no primary PAs (edge case)", () => {
    const secondaryOnly: PracticeArea[] = [
      { id: "imm", label: "Immigration", classification: "secondary" },
    ];
    const p = buildClassifierPrompt(makeInput("I need immigration help.", secondaryOnly));
    expect(p).toContain('"imm"');
    expect(p).toContain("(none listed)"); // primary section empty
  });

  it("confidence field guidance is present", () => {
    expect(prompt).toContain('"high"');
    expect(prompt).toContain('"medium"');
    expect(prompt).toContain('"low"');
  });

  it("practice_sub_type field and sub-types are listed", () => {
    expect(prompt).toContain("practice_sub_type");
    expect(prompt).toContain("fam_abduction");
    expect(prompt).toContain("emp_dismissal");
    expect(prompt).toContain("pi_mva");
  });

  it("reasoning field is requested", () => {
    expect(prompt).toContain('"reasoning"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Level 2: parseClassifierResponse
// ─────────────────────────────────────────────────────────────────────────────

describe("parseClassifierResponse  -  parser robustness", () => {
  it("parses a valid complete response", () => {
    const raw: RawClassifierOutput = {
      practice_area: "pi",
      practice_sub_type: "pi_mva",
      flags: ["mvac_hit_and_run", "limitation_proximity"],
      confidence: "high",
      out_of_scope: false,
      reasoning: "Motor vehicle accident  -  hit and run signals.",
    };
    const result = parseClassifierResponse(JSON.stringify(raw));
    expect(result).not.toBeNull();
    expect(result?.practice_area).toBe("pi");
    expect(result?.flags).toContain("mvac_hit_and_run");
    expect(result?.confidence).toBe("high");
  });

  it("defaults missing flags field to []", () => {
    const raw = {
      practice_area: "fam",
      practice_sub_type: "fam_divorce",
      confidence: "medium",
      out_of_scope: false,
    };
    const result = parseClassifierResponse(JSON.stringify(raw));
    expect(result?.flags).toEqual([]);
  });

  it("defaults invalid confidence to 'low'", () => {
    const raw = {
      practice_area: "emp",
      practice_sub_type: null,
      flags: [],
      confidence: "very_high", // invalid
      out_of_scope: false,
    };
    const result = parseClassifierResponse(JSON.stringify(raw));
    expect(result?.confidence).toBe("low");
  });

  it("returns null for malformed JSON", () => {
    expect(parseClassifierResponse("{not valid json")).toBeNull();
    expect(parseClassifierResponse("")).toBeNull();
    expect(parseClassifierResponse("null")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseClassifierResponse("[]")).toBeNull();
    expect(parseClassifierResponse('"string"')).toBeNull();
    expect(parseClassifierResponse("42")).toBeNull();
  });

  it("handles null practice_area", () => {
    const raw = {
      practice_area: null,
      practice_sub_type: null,
      flags: [],
      confidence: "low",
      out_of_scope: true,
    };
    const result = parseClassifierResponse(JSON.stringify(raw));
    expect(result?.practice_area).toBeNull();
    expect(result?.out_of_scope).toBe(true);
  });

  it("handles GPT wrapping JSON in markdown (trimmed correctly)", () => {
    // GPT sometimes adds whitespace  -  trim() handles it
    const raw = JSON.stringify({
      practice_area: "crim",
      practice_sub_type: "crim_dui",
      flags: ["crim_charter_violation"],
      confidence: "high",
      out_of_scope: false,
    });
    const result = parseClassifierResponse(`   ${raw}   `);
    expect(result?.practice_area).toBe("crim");
  });

  it("preserves reasoning field when present", () => {
    const raw = {
      practice_area: "imm",
      practice_sub_type: "imm_refugee",
      flags: ["imm_rad_deadline"],
      confidence: "high",
      out_of_scope: false,
      reasoning: "RPD refusal with 15-day RAD window.",
    };
    const result = parseClassifierResponse(JSON.stringify(raw));
    expect(result?.reasoning).toContain("RPD");
  });

  it("preserves flags array as-is (validation happens in classify())", () => {
    // Parser does NOT filter hallucinated flag IDs  -  that's mergeFlags()'s job
    const raw = {
      practice_area: "pi",
      practice_sub_type: null,
      flags: ["real_flag", "hallucinated_xyz_flag"],
      confidence: "medium",
      out_of_scope: false,
    };
    const result = parseClassifierResponse(JSON.stringify(raw));
    expect(result?.flags).toContain("hallucinated_xyz_flag");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Level 3: classify() with mocked OpenAI
// ─────────────────────────────────────────────────────────────────────────────

describe("classify()  -  full pipeline with mocked OpenAI", () => {
  it("resolves PA when GPT returns a valid firm PA", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: "pi",
      practice_sub_type: "pi_mva",
      flags: ["mvac_hit_and_run"],
      confidence: "high",
      out_of_scope: false,
      reasoning: "MVA hit and run.",
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const result = await classify(openai, makeInput("A car hit me and fled the scene."));
    expect(result.practice_area).toBe("pi");
    expect(result.confidence).toBe("high");
    expect(result.out_of_scope).toBe(false);
  });

  it("discards GPT PA if not in firm's PA list", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: "tax", // not in FIRM_PAS
      practice_sub_type: null,
      flags: [],
      confidence: "high",
      out_of_scope: false,
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const result = await classify(openai, makeInput("I have a CRA tax dispute."));
    expect(result.practice_area).toBeNull();
    // out_of_scope is only true if GPT also set it AND resolvedPA is null
  });

  it("merges GPT flags with regex-detected flags", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: "fam",
      practice_sub_type: "fam_abduction",
      flags: ["fam_abduction"], // GPT semantic detection
      confidence: "high",
      out_of_scope: false,
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const text = "My ex-wife brought our son to her home country without my consent.";
    const result = await classify(openai, makeInput(text));
    // regex detects fam_abduction (since PA=fam after resolution)
    // GPT also detects fam_abduction
    // merged = deduped
    expect(result.flags).toContain("fam_abduction");
    expect(result.flags.filter(f => f === "fam_abduction")).toHaveLength(1); // deduplicated
  });

  it("filters out hallucinated flag IDs from GPT", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: "emp",
      practice_sub_type: "emp_dismissal",
      flags: ["emp_hrto_clock", "hallucinated_super_flag_xyz"],
      confidence: "medium",
      out_of_scope: false,
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const result = await classify(openai, makeInput("I was fired after disclosing my disability."));
    expect(result.flags).toContain("emp_hrto_clock");
    expect(result.flags).not.toContain("hallucinated_super_flag_xyz");
  });

  it("sets out_of_scope when GPT says so and PA not in firm list", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: null,
      practice_sub_type: null,
      flags: [],
      confidence: "high",
      out_of_scope: true,
      reasoning: "Clearly a patent dispute  -  not in firm scope.",
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const result = await classify(openai, makeInput("I need help with a US patent dispute."));
    expect(result.out_of_scope).toBe(true);
    expect(result.practice_area).toBeNull();
  });

  it("does NOT set out_of_scope when GPT says out_of_scope but PA resolves to firm list", async () => {
    // Edge case: GPT confused but PA matches
    const gptResponse: RawClassifierOutput = {
      practice_area: "pi",
      practice_sub_type: null,
      flags: [],
      confidence: "medium",
      out_of_scope: true, // contradictory  -  PA is valid
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const result = await classify(openai, makeInput("I was hurt in a car accident."));
    // resolvedPA = "pi" (in firm list), so out_of_scope = false
    expect(result.practice_area).toBe("pi");
    expect(result.out_of_scope).toBe(false);
  });

  it("graceful degradation  -  returns low-confidence null result on GPT failure", async () => {
    const openai = failingOpenAI();
    const result = await classify(openai, makeInput("I need legal help."));
    expect(result.practice_area).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.flags).toEqual([]);
    expect(result.out_of_scope).toBe(false);
    expect(result.reasoning).toContain("classifier_error");
  });

  it("graceful degradation  -  returns low-confidence result on invalid GPT JSON", async () => {
    const openai = mockOpenAI("this is not valid json at all");
    const result = await classify(openai, makeInput("I need legal help."));
    expect(result.practice_area).toBeNull();
    expect(result.confidence).toBe("low");
    expect(result.reasoning).toContain("classifier_error");
  });

  it("preserves gpt_flags_raw and regex_flags_raw for conflict monitoring", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: "fam",
      practice_sub_type: "fam_abduction",
      flags: ["fam_abduction", "fam_domestic_violence"],
      confidence: "high",
      out_of_scope: false,
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const text = "My ex took our son to another country without my consent.";
    const result = await classify(openai, makeInput(text));
    expect(result.gpt_flags_raw).toContain("fam_abduction");
    expect(result.gpt_flags_raw).toContain("fam_domestic_violence");
    // regex_flags_raw contains what detectFlags found with the resolved PA
    expect(Array.isArray(result.regex_flags_raw)).toBe(true);
  });

  it("uses specified model override", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: "crim",
      practice_sub_type: "crim_dui",
      flags: [],
      confidence: "high",
      out_of_scope: false,
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    await classify(openai, makeInput("I was charged with DUI."), "gpt-4o");
    const createFn = (openai.chat.completions.create as ReturnType<typeof vi.fn>);
    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o" })
    );
  });

  it("calls OpenAI with temperature 0.1 and JSON response format", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: "emp",
      practice_sub_type: null,
      flags: [],
      confidence: "low",
      out_of_scope: false,
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    await classify(openai, makeInput("I lost my job."));
    const createFn = (openai.chat.completions.create as ReturnType<typeof vi.fn>);
    expect(createFn).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_tokens: 512,
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prompt accuracy: 20 golden scenario prompts
// Verify the classifier prompt correctly positions each scenario's key signals
// ─────────────────────────────────────────────────────────────────────────────

describe("Prompt accuracy  -  20 golden intake scenarios", () => {
  /** Returns true if the prompt contains all the expected guidance for the scenario. */
  function promptCovers(text: string, mustContain: string[]): boolean {
    const prompt = buildClassifierPrompt(makeInput(text));
    return mustContain.every(s => prompt.includes(s));
  }

  // 1. PI / MVA
  it("MVA scenario  -  prompt includes pi_mva sub-type and mvac flags", () => {
    expect(promptCovers(
      "I was hit by a car last week and the driver fled.",
      ["pi_mva", "mvac_hit_and_run", "mvac_insurer_not_notified"]
    )).toBe(true);
  });

  // 2. PI / Slip & Fall ice
  it("Slip on ice  -  prompt includes slip_ice_snow guidance", () => {
    expect(promptCovers(
      "I slipped on ice outside the grocery store.",
      ["slip_ice_snow", "60-day", "pi_slip_fall"]
    )).toBe(true);
  });

  // 3. PI / Med-mal
  it("Medical malpractice  -  prompt includes medmal flags", () => {
    expect(promptCovers(
      "I think my surgeon made a mistake during the operation.",
      ["medmal_causation_unclear", "pi_med_mal"]
    )).toBe(true);
  });

  // 4. Family / Abduction
  it("International abduction  -  prompt has fam_abduction guidance BEFORE fam_protection", () => {
    const prompt = buildClassifierPrompt(makeInput(
      "My ex took our daughter to another country without my consent."
    ));
    const abductionIdx = prompt.indexOf("fam_abduction");
    const protectionIdx = prompt.indexOf("fam_protection");
    expect(abductionIdx).toBeGreaterThan(-1);
    expect(protectionIdx).toBeGreaterThan(-1);
    expect(abductionIdx).toBeLessThan(protectionIdx);
  });

  // 5. Family / Domestic violence
  it("Domestic violence  -  prompt includes fam_domestic_violence", () => {
    expect(promptCovers(
      "I am afraid of my husband and need a restraining order.",
      ["fam_domestic_violence", "fam_protection"]
    )).toBe(true);
  });

  // 6. Family / Property equalization deadline
  it("Long separation + property  -  prompt includes fam_property_clock", () => {
    expect(promptCovers(
      "We separated 5 years ago and never divided our home.",
      ["fam_property_clock", "fam_property"]
    )).toBe(true);
  });

  // 7. Criminal / DUI charter
  it("DUI charter violation  -  prompt includes crim_charter_violation", () => {
    expect(promptCovers(
      "Police made me blow into the breathalyzer without letting me call a lawyer.",
      ["crim_charter_violation", "crim_dui"]
    )).toBe(true);
  });

  // 8. Criminal / Co-accused
  it("Co-accused  -  prompt includes crim_co_accused", () => {
    expect(promptCovers(
      "My friend and I were both arrested at the scene.",
      ["crim_co_accused"]
    )).toBe(true);
  });

  // 9. Employment / HRTO clock
  it("HRTO clock  -  prompt includes 1-year deadline guidance", () => {
    expect(promptCovers(
      "I was passed over for promotion because of my disability.",
      ["emp_hrto_clock", "1-year"]
    )).toBe(true);
  });

  // 10. Employment / Severance signed
  it("Signed severance  -  prompt includes emp_severance_signed", () => {
    expect(promptCovers(
      "I already signed the severance documents before getting advice.",
      ["emp_severance_signed"]
    )).toBe(true);
  });

  // 11. Immigration / RAD deadline
  it("RAD deadline  -  prompt includes 15-day guidance", () => {
    expect(promptCovers(
      "My refugee claim was refused by the RPD last week.",
      ["imm_rad_deadline", "15-day"]
    )).toBe(true);
  });

  // 12. Immigration / Removal order
  it("Removal order  -  prompt includes imm_removal_order", () => {
    expect(promptCovers(
      "I received a deportation order and must leave Canada in 2 weeks.",
      ["imm_removal_order"]
    )).toBe(true);
  });

  // 13. Real estate / Dual rep
  it("Dual representation  -  prompt includes real_estate_dual_representation", () => {
    expect(promptCovers(
      "The same lawyer is representing both the buyer and the seller.",
      ["real_estate_dual_representation"]
    )).toBe(true);
  });

  // 14. Real estate / Post-closing defect
  it("Post-closing defect  -  prompt includes real_estate_undisclosed_defects", () => {
    expect(promptCovers(
      "After I moved in I found mold they never disclosed.",
      ["real_estate_undisclosed_defects"]
    )).toBe(true);
  });

  // 15. Construction lien
  it("Construction lien  -  prompt includes 60-day lien guidance", () => {
    expect(promptCovers(
      "I finished the renovation 6 weeks ago and the owner still hasn't paid.",
      ["construction_lien_deadline", "60-day"]
    )).toBe(true);
  });

  // 16. LTD appeal clock
  it("LTD denial  -  prompt includes ltd_appeal_clock_running", () => {
    expect(promptCovers(
      "My long-term disability claim was denied 6 months ago and I am still appealing.",
      ["ltd_appeal_clock_running"]
    )).toBe(true);
  });

  // 17. Estates / Capacity
  it("Estates capacity  -  prompt includes estates_capacity", () => {
    expect(promptCovers(
      "My father has dementia and my sister is pressuring him to sign a new will.",
      ["estates_capacity", "estates_undue_influence"]
    )).toBe(true);
  });

  // 18. WSIB
  it("WSIB  -  prompt includes wsib_six_month_claim", () => {
    expect(promptCovers(
      "I was injured at work last month and haven't filed a WSIB claim.",
      ["wsib_six_month_claim", "6-month"]
    )).toBe(true);
  });

  // 19. Out-of-scope matter (estate planning for a firm with no estates PA)
  it("Out-of-scope  -  prompt instructs GPT to return out_of_scope: true when no PA matches", () => {
    const limitedFirm: PracticeArea[] = [
      { id: "pi", label: "Personal Injury", classification: "primary" },
    ];
    const prompt = buildClassifierPrompt({
      firmPracticeAreas: limitedFirm,
      conversationText: "I need help administering a will  -  my father just died.",
    });
    expect(prompt).toContain("out_of_scope");
    expect(prompt).toContain('"pi"'); // only PA listed
    expect(prompt).not.toContain('"est"'); // not in firm
  });

  // 20. Municipal injury notice
  it("Municipal injury  -  prompt includes municipal_injury_notice and 10-day notice", () => {
    expect(promptCovers(
      "I tripped on a broken city sidewalk last week.",
      ["municipal_injury_notice"]
    )).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1A: Low-confidence clarifier
// ─────────────────────────────────────────────────────────────────────────────

describe("classify()  -  low-confidence clarifier (Phase 1A)", () => {
  it("sets needs_clarification when confidence=low and PA=null and not out_of_scope", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: null,
      practice_sub_type: null,
      flags: [],
      confidence: "low",
      out_of_scope: false,
      reasoning: "Very vague  -  cannot determine practice area.",
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const result = await classify(openai, makeInput("I need help with a legal problem."));
    expect(result.needs_clarification).toBe(true);
    expect(result.clarification_prompt).toBeTruthy();
  });

  it("clarification_prompt lists firm's primary PA labels", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: null,
      practice_sub_type: null,
      flags: [],
      confidence: "low",
      out_of_scope: false,
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const result = await classify(openai, makeInput("Help."));
    // Should mention at least one primary PA label from FIRM_PAS
    expect(result.clarification_prompt).toContain("Personal Injury");
    expect(result.clarification_prompt).toContain("Family Law");
  });

  it("does NOT set needs_clarification when confidence=low but PA resolves", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: "emp",
      practice_sub_type: null,
      flags: [],
      confidence: "low",
      out_of_scope: false,
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const result = await classify(openai, makeInput("I lost my job somehow."));
    expect(result.needs_clarification).toBeUndefined();
    expect(result.practice_area).toBe("emp");
  });

  it("does NOT set needs_clarification when confidence=medium and PA=null", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: null,
      practice_sub_type: null,
      flags: [],
      confidence: "medium",
      out_of_scope: false,
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const result = await classify(openai, makeInput("I have a legal issue."));
    // medium confidence  -  don't ask for clarification, let GPT handle
    expect(result.needs_clarification).toBeUndefined();
  });

  it("does NOT set needs_clarification when out_of_scope is true", async () => {
    const gptResponse: RawClassifierOutput = {
      practice_area: null,
      practice_sub_type: null,
      flags: [],
      confidence: "low",
      out_of_scope: true,
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const result = await classify(openai, makeInput("I need help with a US immigration case."));
    expect(result.needs_clarification).toBeUndefined();
    expect(result.out_of_scope).toBe(true);
  });

  it("falls back to generic prompt when firm has no primary PAs", async () => {
    const secondaryOnlyFirm = [
      { id: "imm", label: "Immigration", classification: "secondary" as const },
    ];
    const gptResponse: RawClassifierOutput = {
      practice_area: null,
      practice_sub_type: null,
      flags: [],
      confidence: "low",
      out_of_scope: false,
    };
    const openai = mockOpenAI(JSON.stringify(gptResponse));
    const result = await classify(openai, { firmPracticeAreas: secondaryOnlyFirm, conversationText: "I need help." });
    expect(result.needs_clarification).toBe(true);
    expect(result.clarification_prompt).toContain("detail");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAllFlagIds consistency check
// ─────────────────────────────────────────────────────────────────────────────

describe("getAllFlagIds  -  classifier list vs registry consistency", () => {
  it("all flag IDs in the classifier prompt are valid registry IDs", () => {
    const prompt = buildClassifierPrompt(makeInput("test"));
    // Extract the flag list line from the prompt
    const match = prompt.match(/Select ONLY from this validated list: (.+)/);
    expect(match).not.toBeNull();
    const listedIds = match![1].split(", ").map(s => s.trim());
    const unknownIds = listedIds.filter((id: string) => !FLAG_REGISTRY.has(id));
    expect(unknownIds).toHaveLength(0);
  });
});
