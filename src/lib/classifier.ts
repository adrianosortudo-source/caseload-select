/**
 * CaseLoad Screen — Firm-Scoped Classifier
 *
 * Converts a raw conversation transcript into a structured classification:
 *   { practice_area, practice_sub_type, flags[], confidence, out_of_scope }
 *
 * Architecture:
 *   1. Firm-scoped: the firm's 1-9 practice areas constrain the output vocabulary.
 *      A match outside the firm's scope → immediate Band E routing.
 *   2. Deterministic first: detectFlags() runs regex over the text before the GPT call.
 *   3. Semantic second: GPT classifier produces PA + sub_type + semantic flags.
 *   4. Merge: mergeFlags() produces the final flag set (union, S1 ordered first).
 *
 * This classifier is called ONCE per session, on the first substantive message.
 * Re-classification is possible if the user significantly changes their description
 * (e.g. starts with employment, reveals it is a human rights matter).
 *
 * Integration point: src/app/api/screen/route.ts — called after session load,
 * before buildSystemPrompt(). Result stored in session state as `classifier_result`.
 */

import OpenAI from "openai";
import type { PracticeArea } from "@/lib/screen-prompt";
import { detectFlags, mergeFlags } from "@/lib/flag-registry";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ClassifierInput {
  /** Firm's practice areas — constrains the output vocabulary. */
  firmPracticeAreas: PracticeArea[];
  /** Full conversation text from the client (all user turns concatenated with newlines). */
  conversationText: string;
  /** Optional: channel context. */
  channel?: string;
}

export interface ClassifierResult {
  /** Resolved practice area ID from the firm's list, or null if unresolved. */
  practice_area: string | null;
  /** Sub-type ID within the umbrella PA, or null if no specific sub-type detected. */
  practice_sub_type: string | null;
  /** Active flag IDs (S1 before S2). Union of regex + GPT detection. */
  flags: string[];
  /** High = strong match, Medium = probable match, Low = weak signal or ambiguous. */
  confidence: "high" | "medium" | "low";
  /** True if the matter is clearly outside all of the firm's practice areas. */
  out_of_scope: boolean;
  /** Raw GPT flags before merge — preserved for conflict monitoring. */
  gpt_flags_raw: string[];
  /** Regex flags before merge — preserved for conflict monitoring. */
  regex_flags_raw: string[];
  /** GPT's brief reasoning — used for debugging and conflict log. */
  reasoning?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Classifier Prompt Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All flag IDs the classifier may emit — used to constrain GPT hallucination.
 * Imported lazily to avoid circular dependency at module load.
 */
function getAllFlagIds(): string[] {
  // Inline the list rather than importing FLAG_REGISTRY to keep this module light.
  // If new flags are added to flag-registry.ts, add them here too.
  return [
    // Universal
    "limitation_proximity", "conflict_adverse_party", "prior_counsel",
    "minor_claimant", "vulnerable_client",
    // PI / MVA / Med-mal / Slip
    "pi_limitation_window", "pi_unidentified_parties", "pi_evidence_preservation",
    "mvac_insurer_not_notified", "mvac_hit_and_run", "mvac_accident_benefits",
    "medmal_causation_unclear", "medmal_multiple_providers",
    "slip_ice_snow", "slip_municipality",
    "ltd_appeal_clock_running", "ltd_policy_definition",
    // Family
    "fam_property_clock", "fam_abduction", "fam_domestic_violence", "fam_hidden_assets",
    "child_apprehension_recent", "child_protection_allegations",
    // Immigration
    "imm_rad_deadline", "imm_removal_order", "imm_inadmissibility",
    // Criminal
    "crim_charter_violation", "crim_co_accused", "crim_bail_conditions",
    // Employment / HR
    "emp_hrto_clock", "emp_severance_signed", "emp_constructive_dismissal",
    "hrto_respondent_id",
    // Real Estate / Estates / Corporate
    "real_estate_dual_representation", "real_estate_undisclosed_defects", "real_estate_closing_date",
    "estates_capacity", "estates_undue_influence", "estates_dependant_relief",
    "corp_oppression", "corp_personal_liability",
    // Construction / Landlord / IP / Insurance / Admin / WSIB
    "construction_lien_deadline", "construction_contract_dispute",
    "llt_notice_validity", "llt_non_payment", "llt_illegal_entry",
    "ip_maintenance_lapse", "ip_infringement",
    "ins_claim_denial",
    "admin_jr_deadline",
    "wsib_six_month_claim", "wsib_dearos", "wsib_appeal_deadline",
    // Defamation / Tax / Labour / Social Benefits / Municipal / Environmental
    "defamation_media_notice", "defamation_online",
    "tax_objection_deadline", "tax_voluntary_disclosure",
    "labour_ulp_complaint",
    "social_benefits_appeal",
    "municipal_injury_notice", "municipal_bylaw_appeal",
    "env_remediation_order",
    // Immigration (extended)
    "immigration_misrepresentation",
    // Elder / Privacy / Securities / Animal / Class / Youth
    "elder_poa_abuse",
    "privacy_data_breach",
    "sec_misrepresentation",
    "animal_bite_injury",
    "class_action_opt_out",
    "youth_ycja_charges",
    "youth_school_discipline",
    // Insolvency
    "insolvency_creditor_action", "insolvency_asset_disclosure",
  ];
}

/** @internal — exported for testing only */
export function buildClassifierPrompt(input: ClassifierInput): string {
  const primaryPAs = input.firmPracticeAreas
    .filter(a => a.classification === "primary")
    .map(a => `  - id: "${a.id}" | label: "${a.label}"`)
    .join("\n");
  const secondaryPAs = input.firmPracticeAreas
    .filter(a => a.classification === "secondary")
    .map(a => `  - id: "${a.id}" | label: "${a.label}"`)
    .join("\n");

  const validFlagIds = getAllFlagIds().join(", ");

  return `You are a legal intake classifier for a Canadian law firm operating in Ontario. Your job is to read a client's initial message and classify the matter with precision.

## Firm's Practice Areas (your output MUST use IDs from this list only)

### Primary (firm actively takes these cases):
${primaryPAs || "  (none listed)"}

### Secondary (firm takes occasionally):
${secondaryPAs || "  (none listed)"}

## Classification Task

Read the client's message and output a JSON object with exactly these fields:

{
  "practice_area": string | null,
  "practice_sub_type": string | null,
  "flags": string[],
  "confidence": "high" | "medium" | "low",
  "out_of_scope": boolean,
  "reasoning": string
}

### Rules:

**practice_area:**
- MUST be one of the firm's practice area IDs listed above, or null.
- If the matter clearly falls outside all listed practice areas, set "out_of_scope": true and "practice_area": null.
- If ambiguous between two PAs, pick the most specific match and note it in "reasoning".
- Never invent a practice area ID not listed above.

**practice_sub_type:**
- Only populate if you are confident about the sub-type.
- Family Law sub-types: fam_abduction, fam_divorce, fam_custody, fam_support, fam_property, fam_protection, fam_other
- Personal Injury sub-types: pi_mva, pi_slip_fall, pi_dog_bite, pi_med_mal, pi_product, pi_workplace, pi_assault_ci, pi_other
- Employment sub-types: emp_dismissal, emp_harassment, emp_wage, emp_disc, emp_constructive, emp_other
- Criminal sub-types: crim_dui, crim_assault, crim_drug, crim_theft, crim_domestic, crim_other
- Immigration sub-types: imm_ee, imm_spousal, imm_study, imm_work_permit, imm_refugee, imm_pnp, imm_other
- Civil sub-types: civ_contract, civ_debt, civ_tort, civ_negligence, civ_other
- Insurance sub-types: ins_sabs, ins_denial, ins_bad_faith, ins_other
- If none of the above applies to the PA, set null.

**flags:**
- Select ONLY from this validated list: ${validFlagIds}
- Flag an issue ONLY when you have clear evidence in the text, not just possibility.
- Prioritize S1 (critical) flags — these represent malpractice or claim-barring risks.

### Key Flag Guidance:

**fam_abduction** (not fam_custody, not fam_protection): when a parent took a child to ANOTHER COUNTRY without consent, or cross-border child movement is described.

**limitation_proximity**: when the incident appears to have occurred 18+ months ago or the text suggests significant time has passed.

**mvac_insurer_not_notified**: when a car accident was recent (days ago) and client has not yet notified insurer.

**slip_ice_snow**: when fall involved ice, snow, or slippery winter conditions — triggers 60-day Occupiers' Liability Act notice obligation.

**slip_municipality**: when fall occurred on city sidewalk, road, or municipal property — triggers Municipal Act notice.

**emp_hrto_clock**: when discrimination on a protected ground is described — triggers 1-year HRTO deadline (stricter than 2-year).

**emp_severance_signed**: when client mentions having already signed a document after termination.

**imm_rad_deadline**: when refugee claim was refused or denied by RPD — 15-day appeal window.

**construction_lien_deadline**: when contractor/subcontractor describes work done and non-payment — 60-day lien window.

**ltd_appeal_clock_running**: when long-term disability claim was denied and client is in or considering internal appeal.

**crim_charter_violation**: when police conduct (search, arrest, right to counsel) appears to violate Charter.

**wsib_six_month_claim**: when a worker was injured on the job and has not yet filed a WSIB claim — strict 6-month filing deadline from date of injury or awareness.

**out_of_scope:**
- Set true if the matter is clearly outside ALL of the firm's listed practice areas.
- Do not set true if it's ambiguous — low confidence and a best-match PA is better than out_of_scope.

**confidence:**
- "high": clear single PA match with specific facts.
- "medium": probable PA but some ambiguity, or limited facts.
- "low": very little information provided, multiple possible PAs, or first message is too vague.

**reasoning:**
- 1-2 sentences explaining your PA choice, sub-type choice, and flagged issues.
- Note any ambiguities.

## Client's Message

${input.conversationText}

## Output

Respond with ONLY valid JSON. No markdown, no explanation outside the JSON object.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GPT Call
// ─────────────────────────────────────────────────────────────────────────────

/** @internal — exported for testing only */
export interface RawClassifierOutput {
  practice_area: string | null;
  practice_sub_type: string | null;
  flags: string[];
  confidence: "high" | "medium" | "low";
  out_of_scope: boolean;
  reasoning?: string;
}

/** @internal — exported for testing only */
export function parseClassifierResponse(raw: string): RawClassifierOutput | null {
  try {
    const parsed = JSON.parse(raw.trim()) as RawClassifierOutput;
    // Minimal validation
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    if (!Array.isArray(parsed.flags)) parsed.flags = [];
    if (!["high", "medium", "low"].includes(parsed.confidence)) parsed.confidence = "low";
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Classify a client's intake message against a firm's practice area scope.
 *
 * @param openai   Shared OpenAI client instance.
 * @param input    Classifier input (firm PAs + conversation text).
 * @param model    Model to use for classification. Defaults to gpt-4o-mini.
 * @returns        ClassifierResult with PA, sub-type, flags, and confidence.
 */
export async function classify(
  openai: OpenAI,
  input: ClassifierInput,
  model = "gpt-4o-mini",
): Promise<ClassifierResult> {
  const prompt = buildClassifierPrompt(input);

  // Step 1: GPT call
  let gptOutput: RawClassifierOutput | null = null;
  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1, // Low temperature — classification should be deterministic
      max_tokens: 512,
      response_format: { type: "json_object" },
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    gptOutput = parseClassifierResponse(raw);
  } catch (err) {
    console.error("[classifier] GPT call failed:", err);
    // Graceful degradation: return low-confidence null result
    return {
      practice_area: null,
      practice_sub_type: null,
      flags: [],
      confidence: "low",
      out_of_scope: false,
      gpt_flags_raw: [],
      regex_flags_raw: [],
      reasoning: "classifier_error: GPT call failed",
    };
  }

  if (!gptOutput) {
    return {
      practice_area: null,
      practice_sub_type: null,
      flags: [],
      confidence: "low",
      out_of_scope: false,
      gpt_flags_raw: [],
      regex_flags_raw: [],
      reasoning: "classifier_error: invalid GPT response",
    };
  }

  // Step 2: Validate PA against firm's actual PA list
  const firmPAIds = new Set(input.firmPracticeAreas.map(a => a.id));
  const resolvedPA = gptOutput.practice_area && firmPAIds.has(gptOutput.practice_area)
    ? gptOutput.practice_area
    : null;

  // Step 3: Regex flag detection (deterministic)
  const regexFlags = detectFlags(input.conversationText, resolvedPA ?? "");

  // Step 4: Merge flags (regex + GPT, S1 first, deduplicated)
  const mergedFlags = mergeFlags(regexFlags, gptOutput.flags ?? []);

  return {
    practice_area: resolvedPA,
    practice_sub_type: gptOutput.practice_sub_type ?? null,
    flags: mergedFlags,
    confidence: gptOutput.confidence ?? "low",
    out_of_scope: resolvedPA === null && (gptOutput.out_of_scope ?? false),
    gpt_flags_raw: gptOutput.flags ?? [],
    regex_flags_raw: regexFlags,
    reasoning: gptOutput.reasoning,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Session State Integration Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines whether the classifier should run on this turn.
 *
 * Classifier runs:
 *   - On the first substantive user message (turn_count === 1)
 *   - On re-classification trigger (GPT returned `needs_reclassification: true`)
 *   - NOT on identity/contact turns, OTP turns, or after sub-type is locked
 *
 * @param turnCount     Current turn number in the session (1-indexed).
 * @param step          Current intake step (e.g. "intent", "questions", "identity").
 * @param isLocked      True if sub-type has been locked after first re-classification.
 */
export function shouldRunClassifier(
  turnCount: number,
  step: string,
  isLocked: boolean,
): boolean {
  if (isLocked) return false;
  if (step === "identity" || step === "otp" || step === "result") return false;
  return turnCount <= 2; // Run on turn 1 (always) and optionally turn 2 if PA not resolved
}
