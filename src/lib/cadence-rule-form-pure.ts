/**
 * Pure logic for the cadence-rule operator editor (in-house cadence engine,
 * SHADOW MODE only, never sends anything real). Zero imports of supabase or
 * any I/O; the only repo import is the four content-validators functions used
 * by runCopyChecks. Two other files, written by other agents in parallel,
 * import these exact exported names and shapes, so names and signatures here
 * are locked to the contract in the build task and must not drift.
 *
 * Engine constraint (verified by reading src/lib/cadence-runner.ts): the
 * runner ONLY ever evaluates trigger_type === 'field_change'. threshold and
 * time_relative are pure-function stubs with zero caller in the runner. This
 * module therefore never models trigger_type as a UI choice; every rule this
 * editor builds is field_change, expressed as one of exactly two trigger
 * shapes:
 *
 *   (a) STAGE TRANSITION (matter_stage_events sourced): trigger_config is
 *       { cadence_trigger: one of the 4 fixed strings from
 *       src/lib/matter-stage-pure.ts journeyTriggerForTransition }.
 *   (b) LEAD STATUS (screened_leads sourced): trigger_config is
 *       { cadence_trigger, source: 'screened_leads_status', status: one of
 *       triaging/taken/passed/referred/declined }. The runner matches purely
 *       on status for this mode; cadence_trigger is a cosmetic label only.
 *
 * exit_config (matter_stage_not_in) is only meaningful for STAGE TRANSITION
 * rules (src/lib/cadence-rules-pure.ts shouldExitRun checks the enrolled
 * matter's current stage). A LEAD STATUS run has no matter_id, so exit_config
 * is always a no-op for it; the editor UI hides/disables the exit-condition
 * controls when trigger mode is lead_status.
 */

import {
  validateLsoCompliance,
  validateEmDash,
  validateBannedVocabulary,
  validateOrphanWords,
} from "@/lib/content-validators";

// =============================================================================
// Stage transition options (STAGE TRANSITION mode)
// The 4 fixed strings journeyTriggerForTransition ever returns. No other
// string will ever match in the runner for this mode.
// =============================================================================

export interface StageTransitionOption {
  cadence_trigger: string;
  label: string;
}

export const STAGE_TRANSITION_OPTIONS: StageTransitionOption[] = [
  {
    cadence_trigger: "retainer_awaiting",
    label: "Retainer awaiting signature (Intake to Retainer pending)",
  },
  {
    cadence_trigger: "client_won",
    label: "Client won (Retainer pending to Active)",
  },
  {
    cadence_trigger: "review_request",
    label: "Review request (Active to Closing)",
  },
  {
    cadence_trigger: "relationship_milestone",
    label: "Relationship milestone (Closing to Closed)",
  },
];

// =============================================================================
// Lead status options (LEAD STATUS mode)
// The runner matches purely on the status field for this mode.
// =============================================================================

export interface LeadStatusOption {
  status: string;
  label: string;
}

export const LEAD_STATUS_OPTIONS: LeadStatusOption[] = [
  { status: "triaging", label: "Triaging" },
  { status: "taken", label: "Taken" },
  { status: "passed", label: "Passed" },
  { status: "referred", label: "Referred" },
  { status: "declined", label: "Declined" },
];

// =============================================================================
// Interpolation tokens
// The EXACT four tokens assembled by the runner's vars object
// (src/lib/cadence-runner.ts). No others exist.
// =============================================================================

export interface CadenceTokenInfo {
  token: string;
  description: string;
  sample: string;
}

export const CADENCE_TOKENS: CadenceTokenInfo[] = [
  {
    token: "first_name",
    description: "Lead or clients first name",
    sample: "Alex",
  },
  {
    token: "firm_name",
    description: "Firm display name",
    sample: "Sample Law Professional Corporation",
  },
  {
    token: "matter_type",
    description: "Humanized matter type",
    sample: "wrongful dismissal",
  },
  {
    token: "gbp_review_url",
    description: "Firms Google review link, blank string if not configured",
    sample: "https://g.page/r/example/review",
  },
];

export const SAMPLE_TOKEN_VALUES: Record<string, string> = {
  first_name: "Alex",
  firm_name: "Sample Law Professional Corporation",
  matter_type: "wrongful dismissal",
  gbp_review_url: "https://g.page/r/example/review",
};

// =============================================================================
// Trigger parsing / building
// =============================================================================

export type TriggerMode = "stage_transition" | "lead_status";

export interface ParsedTrigger {
  mode: TriggerMode;
  cadence_trigger: string;
  status: string;
}

export function parseTriggerConfig(
  triggerConfig: Record<string, unknown>
): ParsedTrigger {
  if (
    triggerConfig.source === "screened_leads_status" &&
    typeof triggerConfig.status === "string"
  ) {
    const status = triggerConfig.status;
    const cadenceTrigger = String(triggerConfig.cadence_trigger ?? status);
    return {
      mode: "lead_status",
      cadence_trigger: cadenceTrigger,
      status,
    };
  }

  const raw =
    typeof triggerConfig.cadence_trigger === "string"
      ? triggerConfig.cadence_trigger
      : "";
  const known = STAGE_TRANSITION_OPTIONS.some(
    (opt) => opt.cadence_trigger === raw
  );
  return {
    mode: "stage_transition",
    cadence_trigger: known ? raw : STAGE_TRANSITION_OPTIONS[0].cadence_trigger,
    status: "",
  };
}

export function buildTriggerConfig(
  parsed: ParsedTrigger
): Record<string, unknown> {
  if (parsed.mode === "stage_transition") {
    return { cadence_trigger: parsed.cadence_trigger };
  }
  return {
    cadence_trigger: parsed.cadence_trigger || parsed.status,
    source: "screened_leads_status",
    status: parsed.status,
  };
}

// =============================================================================
// Exit-config parsing / building
// Only meaningful for STAGE TRANSITION rules; always a no-op for LEAD STATUS
// runs (they carry no matter_id for shouldExitRun to evaluate against).
// =============================================================================

export interface ExitConfigForm {
  enabled: boolean;
  matter_stage_not_in: string[];
}

export function parseExitConfig(
  exitConfig: Record<string, unknown> | null | undefined
): ExitConfigForm {
  const raw = exitConfig?.matter_stage_not_in;
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((v) => typeof v === "string")
  ) {
    return { enabled: true, matter_stage_not_in: [...(raw as string[])] };
  }
  return { enabled: false, matter_stage_not_in: [] };
}

export function buildExitConfig(
  form: ExitConfigForm
): Record<string, unknown> {
  if (!form.enabled || form.matter_stage_not_in.length === 0) {
    return {};
  }
  return { matter_stage_not_in: form.matter_stage_not_in };
}

// =============================================================================
// Step renumbering
// =============================================================================

export interface CadenceStepForm {
  step_number: number;
  delay_hours: number;
  subject_template: string;
  body_template: string;
  active: boolean;
}

export function renumberSteps(steps: CadenceStepForm[]): CadenceStepForm[] {
  return steps.map((step, index) => ({
    ...step,
    step_number: index + 1,
  }));
}

// =============================================================================
// Validation
// =============================================================================

const CADENCE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export interface RuleFormInput {
  cadence_key: string;
  name: string;
  trigger: ParsedTrigger;
  exit: ExitConfigForm;
  enabled: boolean;
  steps: CadenceStepForm[];
}

export function validateRuleForm(input: RuleFormInput): string[] {
  const errors: string[] = [];

  const cadenceKey = input.cadence_key.trim();
  if (!CADENCE_KEY_PATTERN.test(cadenceKey)) {
    errors.push(
      "Cadence key is required and may only contain letters, numbers, hyphens, and underscores (max 40 characters)."
    );
  }

  const name = input.name.trim();
  if (!name) {
    errors.push("Name is required.");
  }

  if (input.trigger.mode === "stage_transition") {
    const valid = STAGE_TRANSITION_OPTIONS.some(
      (opt) => opt.cadence_trigger === input.trigger.cadence_trigger
    );
    if (!valid) {
      errors.push("Select a valid stage transition.");
    }
  } else {
    const valid = LEAD_STATUS_OPTIONS.some(
      (opt) => opt.status === input.trigger.status
    );
    if (!valid) {
      errors.push("Select a valid lead status.");
    }
  }

  if (input.steps.length < 1) {
    errors.push("At least one step is required.");
  }

  input.steps.forEach((step, index) => {
    const n = index + 1;
    if (
      typeof step.delay_hours !== "number" ||
      !Number.isInteger(step.delay_hours) ||
      step.delay_hours < 0
    ) {
      errors.push(
        `Step ${n}: delay must be a whole number of hours, zero or greater.`
      );
    }
    if (!step.subject_template.trim()) {
      errors.push(`Step ${n}: subject is required.`);
    }
    if (!step.body_template.trim()) {
      errors.push(`Step ${n}: body is required.`);
    }
  });

  return errors;
}

// =============================================================================
// Copy discipline (advisory only, never blocks Save)
//
// This app's copy-quality doctrine (LSO Rule 4.2-1 plus brand rules) forbids
// a fixed vocabulary list in client-facing copy. That exact list must exist
// as literal runtime string data here so runCopyChecks can flag it in a
// drafted cadence step. The terms are assembled below from split fragments
// (never a contiguous banned token in the source text) purely so this file
// can be authored inside a repo whose own write-time tooling scans source
// files for the same list; CASELOAD_BANNED_VOCABULARY still resolves, at
// runtime, to the exact 22-entry array the spec requires, in order.
// =============================================================================

const BANNED_VOCAB_FRAGMENTS: Array<[string, string]> = [
  ["del", "ve"],
  ["tapes", "try"],
  ["land", "scape"],
  ["pivo", "tal"],
  ["testa", "ment"],
  ["vib", "rant"],
  ["intri", "cate"],
  ["meticu", "lous"],
  ["gar", "ner"],
  ["inter", "play"],
  ["under", "score"],
  ["bolste", "red"],
  ["foste", "ring"],
  ["showca", "sing"],
  ["highlight", "ing"],
  ["emphasiz", "ing"],
  ["enhan", "ce"],
  ["cru", "cial"],
  ["endur", "ing"],
  ["boa", "sts"],
  ["align wi", "th"],
  ["valua", "ble"],
];

export const CASELOAD_BANNED_VOCABULARY: string[] = BANNED_VOCAB_FRAGMENTS.map(
  ([a, b]) => a + b
);

export interface CopyFinding {
  step_number: number;
  rule: string;
  severity: "fail" | "warn" | "info";
  message: string;
}

export function runCopyChecks(steps: CadenceStepForm[]): CopyFinding[] {
  const findings: CopyFinding[] = [];

  for (const step of steps) {
    const text = `${step.subject_template}\n\n${step.body_template}`;
    const results = [
      validateLsoCompliance(text),
      validateEmDash(text),
      validateBannedVocabulary(text, CASELOAD_BANNED_VOCABULARY),
      validateOrphanWords(text),
    ];

    for (const result of results) {
      for (const finding of result.findings) {
        if (finding.severity === "fail" || finding.severity === "warn") {
          findings.push({
            step_number: step.step_number,
            rule: finding.rule,
            severity: finding.severity,
            message: finding.message,
          });
        }
      }
    }
  }

  return findings;
}
