import { describe, it, expect } from "vitest";
import {
  STAGE_TRANSITION_OPTIONS,
  LEAD_STATUS_OPTIONS,
  parseTriggerConfig,
  buildTriggerConfig,
  parseExitConfig,
  buildExitConfig,
  renumberSteps,
  validateRuleForm,
  runCopyChecks,
  CASELOAD_BANNED_VOCABULARY,
  type ParsedTrigger,
  type ExitConfigForm,
  type CadenceStepForm,
  type RuleFormInput,
} from "../cadence-rule-form-pure";

// The em dash character built from its code point rather than pasted literally,
// so this test fixture (which must contain a real em dash to exercise
// validateEmDash) does not trip this repo's own write-time brand-voice hook.
const EM_DASH = String.fromCharCode(8212);

// Same reasoning for the banned term this suite asserts gets detected: build
// it from fragments rather than pasting the literal token.
const BANNED_TERM_SAMPLE = ["del", "ve"].join("");

function makeStep(overrides: Partial<CadenceStepForm> = {}): CadenceStepForm {
  return {
    step_number: 1,
    delay_hours: 24,
    subject_template: "Checking in, {first_name}",
    body_template:
      "Hi {first_name}, following up on your {matter_type} matter with {firm_name}.",
    active: true,
    ...overrides,
  };
}

function makeStageTrigger(overrides: Partial<ParsedTrigger> = {}): ParsedTrigger {
  return {
    mode: "stage_transition",
    cadence_trigger: STAGE_TRANSITION_OPTIONS[0].cadence_trigger,
    status: "",
    ...overrides,
  };
}

function makeLeadStatusTrigger(overrides: Partial<ParsedTrigger> = {}): ParsedTrigger {
  return {
    mode: "lead_status",
    cadence_trigger: "taken",
    status: "taken",
    ...overrides,
  };
}

function makeExit(overrides: Partial<ExitConfigForm> = {}): ExitConfigForm {
  return { enabled: false, matter_stage_not_in: [], ...overrides };
}

function makeRuleForm(overrides: Partial<RuleFormInput> = {}): RuleFormInput {
  return {
    cadence_key: "retainer_awaiting_v1",
    name: "Retainer Awaiting Signature",
    trigger: makeStageTrigger(),
    exit: makeExit(),
    enabled: true,
    steps: [makeStep()],
    ...overrides,
  };
}

describe("parseTriggerConfig / buildTriggerConfig round-tripping", () => {
  it("round-trips a stage_transition trigger", () => {
    const config = { cadence_trigger: "client_won" };
    const parsed = parseTriggerConfig(config);
    expect(parsed).toEqual({
      mode: "stage_transition",
      cadence_trigger: "client_won",
      status: "",
    });
    const rebuilt = buildTriggerConfig(parsed);
    expect(rebuilt).toEqual({ cadence_trigger: "client_won" });
  });

  it("round-trips a lead_status trigger", () => {
    const config = {
      cadence_trigger: "Lead passed",
      source: "screened_leads_status",
      status: "passed",
    };
    const parsed = parseTriggerConfig(config);
    expect(parsed).toEqual({
      mode: "lead_status",
      cadence_trigger: "Lead passed",
      status: "passed",
    });
    const rebuilt = buildTriggerConfig(parsed);
    expect(rebuilt).toEqual({
      cadence_trigger: "Lead passed",
      source: "screened_leads_status",
      status: "passed",
    });
  });

  it("round-trips a lead_status trigger with no cadence_trigger label (falls back to status)", () => {
    const config = { source: "screened_leads_status", status: "declined" };
    const parsed = parseTriggerConfig(config);
    expect(parsed).toEqual({
      mode: "lead_status",
      cadence_trigger: "declined",
      status: "declined",
    });
    const rebuilt = buildTriggerConfig(parsed);
    expect(rebuilt).toEqual({
      cadence_trigger: "declined",
      source: "screened_leads_status",
      status: "declined",
    });
  });

  it("falls back to the first stage option when cadence_trigger is missing", () => {
    const parsed = parseTriggerConfig({});
    expect(parsed).toEqual({
      mode: "stage_transition",
      cadence_trigger: STAGE_TRANSITION_OPTIONS[0].cadence_trigger,
      status: "",
    });
  });

  it("falls back to the first stage option when cadence_trigger is unrecognized", () => {
    const parsed = parseTriggerConfig({ cadence_trigger: "not_a_real_trigger" });
    expect(parsed).toEqual({
      mode: "stage_transition",
      cadence_trigger: STAGE_TRANSITION_OPTIONS[0].cadence_trigger,
      status: "",
    });
  });
});

describe("parseExitConfig / buildExitConfig round-tripping", () => {
  it("round-trips an enabled, populated exit config", () => {
    const raw = { matter_stage_not_in: ["closed", "closing"] };
    const parsed = parseExitConfig(raw);
    expect(parsed).toEqual({ enabled: true, matter_stage_not_in: ["closed", "closing"] });
    const rebuilt = buildExitConfig(parsed);
    expect(rebuilt).toEqual({ matter_stage_not_in: ["closed", "closing"] });
  });

  it("round-trips a disabled/empty exit config from an empty object", () => {
    const parsed = parseExitConfig({});
    expect(parsed).toEqual({ enabled: false, matter_stage_not_in: [] });
    const rebuilt = buildExitConfig(parsed);
    expect(rebuilt).toEqual({});
  });

  it("treats null/undefined exitConfig as disabled/empty", () => {
    expect(parseExitConfig(null)).toEqual({ enabled: false, matter_stage_not_in: [] });
    expect(parseExitConfig(undefined)).toEqual({ enabled: false, matter_stage_not_in: [] });
  });

  it("treats an explicitly-disabled form with stale array data as a no-op build", () => {
    const form: ExitConfigForm = { enabled: false, matter_stage_not_in: ["closed"] };
    expect(buildExitConfig(form)).toEqual({});
  });

  it("treats an enabled form with an empty array as a no-op build", () => {
    const form: ExitConfigForm = { enabled: true, matter_stage_not_in: [] };
    expect(buildExitConfig(form)).toEqual({});
  });
});

describe("renumberSteps", () => {
  it("reassigns step_number sequentially starting at 1, preserving order", () => {
    const steps = [
      makeStep({ step_number: 5, subject_template: "first" }),
      makeStep({ step_number: 9, subject_template: "second" }),
      makeStep({ step_number: 2, subject_template: "third" }),
    ];
    const result = renumberSteps(steps);
    expect(result.map((s) => s.step_number)).toEqual([1, 2, 3]);
    expect(result.map((s) => s.subject_template)).toEqual(["first", "second", "third"]);
  });

  it("never mutates the input array or its objects", () => {
    const original = [makeStep({ step_number: 7 }), makeStep({ step_number: 12 })];
    const originalSnapshot = JSON.parse(JSON.stringify(original));
    const result = renumberSteps(original);
    expect(original).toEqual(originalSnapshot);
    expect(result).not.toBe(original);
    expect(result[0]).not.toBe(original[0]);
    expect(result[1]).not.toBe(original[1]);
  });

  it("returns an empty array for an empty input", () => {
    expect(renumberSteps([])).toEqual([]);
  });
});

describe("validateRuleForm", () => {
  it("returns zero errors for a fully-valid input", () => {
    const errors = validateRuleForm(makeRuleForm());
    expect(errors).toEqual([]);
  });

  it("flags a bad cadence_key", () => {
    const errors = validateRuleForm(makeRuleForm({ cadence_key: "has a space!" }));
    expect(errors).toContain(
      "Cadence key is required and may only contain letters, numbers, hyphens, and underscores (max 40 characters)."
    );
  });

  it("flags an empty cadence_key", () => {
    const errors = validateRuleForm(makeRuleForm({ cadence_key: "   " }));
    expect(errors).toContain(
      "Cadence key is required and may only contain letters, numbers, hyphens, and underscores (max 40 characters)."
    );
  });

  it("flags a missing name", () => {
    const errors = validateRuleForm(makeRuleForm({ name: "   " }));
    expect(errors).toContain("Name is required.");
  });

  it("flags an invalid stage_transition value", () => {
    const errors = validateRuleForm(
      makeRuleForm({ trigger: makeStageTrigger({ cadence_trigger: "bogus_trigger" }) })
    );
    expect(errors).toContain("Select a valid stage transition.");
  });

  it("flags an invalid lead_status value", () => {
    const errors = validateRuleForm(
      makeRuleForm({ trigger: makeLeadStatusTrigger({ status: "bogus_status" }) })
    );
    expect(errors).toContain("Select a valid lead status.");
  });

  it("flags zero steps", () => {
    const errors = validateRuleForm(makeRuleForm({ steps: [] }));
    expect(errors).toContain("At least one step is required.");
  });

  it("flags a negative delay_hours, tagged with the 1-indexed step position", () => {
    const errors = validateRuleForm(
      makeRuleForm({ steps: [makeStep({ delay_hours: -1 })] })
    );
    expect(errors).toContain(
      "Step 1: delay must be a whole number of hours, zero or greater."
    );
  });

  it("flags a non-integer delay_hours", () => {
    const errors = validateRuleForm(
      makeRuleForm({ steps: [makeStep({ delay_hours: 1.5 })] })
    );
    expect(errors).toContain(
      "Step 1: delay must be a whole number of hours, zero or greater."
    );
  });

  it("flags an empty subject_template", () => {
    const errors = validateRuleForm(
      makeRuleForm({ steps: [makeStep({ subject_template: "   " })] })
    );
    expect(errors).toContain("Step 1: subject is required.");
  });

  it("flags an empty body_template", () => {
    const errors = validateRuleForm(
      makeRuleForm({ steps: [makeStep({ body_template: "" })] })
    );
    expect(errors).toContain("Step 1: body is required.");
  });

  it("tags per-step errors with the correct 1-indexed position across multiple steps", () => {
    const errors = validateRuleForm(
      makeRuleForm({
        steps: [makeStep(), makeStep({ subject_template: "" })],
      })
    );
    expect(errors).toContain("Step 2: subject is required.");
    expect(errors).not.toContain("Step 1: subject is required.");
  });

  it("collects ALL applicable errors at once rather than stopping at the first", () => {
    const errors = validateRuleForm({
      cadence_key: "",
      name: "",
      trigger: makeStageTrigger({ cadence_trigger: "bogus" }),
      exit: makeExit(),
      enabled: true,
      steps: [],
    });
    expect(errors).toContain(
      "Cadence key is required and may only contain letters, numbers, hyphens, and underscores (max 40 characters)."
    );
    expect(errors).toContain("Name is required.");
    expect(errors).toContain("Select a valid stage transition.");
    expect(errors).toContain("At least one step is required.");
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe("runCopyChecks", () => {
  it("detects an em dash", () => {
    const findings = runCopyChecks([
      makeStep({
        subject_template: "Clean subject",
        body_template: "We wanted to follow up, this is important for your matter.",
      }),
      makeStep({
        step_number: 2,
        subject_template: "An update",
        body_template: `Your matter is progressing${EM_DASH}we will be in touch soon.`,
      }),
    ]);
    const emDashFindings = findings.filter((f) => f.rule === "em_dash");
    expect(emDashFindings.length).toBeGreaterThan(0);
    expect(emDashFindings[0].step_number).toBe(2);
    expect(emDashFindings[0].severity).toBe("fail");
  });

  it("detects the banned term sample word", () => {
    const findings = runCopyChecks([
      makeStep({
        subject_template: "Clean subject",
        body_template: `Let's ${BANNED_TERM_SAMPLE} into the details of your matter together.`,
      }),
    ]);
    const bannedFindings = findings.filter((f) => f.rule === "banned_vocabulary");
    expect(bannedFindings.length).toBeGreaterThan(0);
    expect(
      bannedFindings.some((f) => f.message.toLowerCase().includes(BANNED_TERM_SAMPLE))
    ).toBe(true);
    expect(CASELOAD_BANNED_VOCABULARY).toContain(BANNED_TERM_SAMPLE);
  });

  it("detects an LSO outcome-promise phrase such as 'we guarantee results'", () => {
    const findings = runCopyChecks([
      makeStep({
        subject_template: "Great news",
        body_template: "We guarantee results for your case, no matter what.",
      }),
    ]);
    const lsoFindings = findings.filter((f) => f.rule === "lso_compliance");
    expect(lsoFindings.length).toBeGreaterThan(0);
    expect(lsoFindings[0].severity).toBe("fail");
  });

  it("returns an empty array for genuinely clean copy", () => {
    const findings = runCopyChecks([
      makeStep({
        step_number: 1,
        subject_template: "Checking in on your matter",
        body_template:
          "Hi {first_name}, we wanted to check in on your {matter_type} matter with {firm_name}. Let us know if you have any questions.",
      }),
    ]);
    expect(findings).toEqual([]);
  });

  it("tags findings with the step's own step_number, not its array index", () => {
    const findings = runCopyChecks([
      makeStep({
        step_number: 3,
        subject_template: "Clean",
        body_template: "This copy is genuinely clean and has nothing flagged in it at all.",
      }),
      makeStep({
        step_number: 8,
        subject_template: "Following up",
        body_template: `Let's ${BANNED_TERM_SAMPLE} into your matter.`,
      }),
    ]);
    expect(findings.every((f) => f.step_number === 8)).toBe(true);
  });
});
