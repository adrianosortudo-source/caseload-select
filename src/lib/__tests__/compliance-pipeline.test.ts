/**
 * Compliance Pipeline  -  Integration Tests
 *
 * Tests the full compliance layer pipeline end-to-end:
 *   detectFlags() → mergeFlags() → getGateQuestions() → gate injection text
 *
 * Unlike flag-registry.test.ts (unit tests for individual flags), these tests
 * verify that the layers work together correctly for realistic multi-turn intakes.
 *
 * Scenarios covered:
 *   1. International child abduction (fam)  -  fam_abduction vs fam_protection disambiguation
 *   2. MVA hit-and-run + no insurer notification (pi)  -  multiple S1 flags, cap enforcement
 *   3. HRTO 1-year clock  -  employment discrimination (emp)
 *   4. Post-closing defect discovery (real)
 *   5. RAD 15-day appeal deadline (imm)
 *   6. Cross-turn flag accumulation  -  turn 1 (no PA) → turn 2 (PA known)
 *   7. Gate injection text assembly  -  format, CRITICAL note, unasked filter
 *   8. shouldRunClassifier logic
 */

import { describe, it, expect } from "vitest";
import {
  detectFlags,
  mergeFlags,
  getGateQuestions,
  hasCriticalFlag,
  getFlagDefinitions,
  FLAG_REGISTRY,
  type GateQuestion,
} from "../flag-registry";
import { shouldRunClassifier } from "../classifier";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: simulate the gate injection block from route.ts
// Mirrors lines 1019-1038 of src/app/api/screen/route.ts exactly
// ─────────────────────────────────────────────────────────────────────────────

function buildGateBlock(
  activeFlags: string[],
  allCollected: Record<string, unknown>,
): string | null {
  if (activeFlags.length === 0) return null;

  const gateQuestions = getGateQuestions(activeFlags);
  const unaskedGate = gateQuestions.filter(q => !(q.id in allCollected));
  if (unaskedGate.length === 0) return null;

  const gateLines = unaskedGate
    .slice(0, 3)
    .map((q, i) => `  ${i + 1}. [${q.id}] ${q.text}`)
    .join("\n");

  const criticalNote = hasCriticalFlag(activeFlags)
    ? `\n\nCRITICAL: One or more flags represent potential malpractice exposure or a time-sensitive deadline. These MUST be asked before any other qualification question.`
    : "";

  return (
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
    `\nCOMPLIANCE FLAGS  -  MANDATORY GATE QUESTIONS\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `These compliance signals were detected in the conversation. Ask the following questions before standard qualification questions. Integrate them naturally:\n\n` +
    gateLines +
    criticalNote +
    `\n\nOnce these are answered, resume normal scoring and question flow. ` +
    `Store answers in extracted_entities using the question ID as the key.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: International Child Abduction
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 1  -  International child abduction (fam)", () => {
  const clientMessage =
    "My ex-wife brought our son to her home country without my consent and now she won't respond to my messages.";

  it("detects fam_abduction (not fam_protection)", () => {
    const flags = detectFlags(clientMessage, "fam");
    expect(flags).toContain("fam_abduction");
    expect(flags).not.toContain("fam_domestic_violence");
    expect(flags).not.toContain("fam_protection");
  });

  it("fam_abduction is S1  -  critical flag", () => {
    const flags = detectFlags(clientMessage, "fam");
    expect(hasCriticalFlag(flags)).toBe(true);
  });

  it("gate block includes CRITICAL note", () => {
    const flags = detectFlags(clientMessage, "fam");
    const block = buildGateBlock(flags, {});
    expect(block).not.toBeNull();
    expect(block).toContain("CRITICAL");
    expect(block).toContain("MANDATORY GATE QUESTIONS");
  });

  it("gate questions are relevant to Hague/cross-border", () => {
    const flags = detectFlags(clientMessage, "fam");
    const questions = getGateQuestions(flags);
    const texts = questions.map(q => q.text.toLowerCase());
    // First question should be about destination country
    expect(texts.some(t => t.includes("country"))).toBe(true);
  });

  it("capped at 3 gate questions per turn", () => {
    const flags = detectFlags(clientMessage, "fam");
    const block = buildGateBlock(flags, {});
    // Count the numbered entries
    const numbered = (block ?? "").match(/^\s+\d+\./gm) ?? [];
    expect(numbered.length).toBeLessThanOrEqual(3);
  });

  it("already-answered gate question is filtered out", () => {
    const flags = detectFlags(clientMessage, "fam");
    const allQuestions = getGateQuestions(flags);
    const firstQ = allQuestions[0];

    // Simulate first gate question already answered
    const collected: Record<string, unknown> = { [firstQ.id]: "UK" };
    const block = buildGateBlock(flags, collected);

    // Block should still exist (other gate questions remain)
    expect(block).not.toBeNull();
    // First question ID should not appear in the injected block
    expect(block).not.toContain(`[${firstQ.id}]`);
  });

  it("returns null gate block when all gate questions already answered", () => {
    const flags = detectFlags(clientMessage, "fam");
    const questions = getGateQuestions(flags);
    // Mark all gate questions as collected
    const allAnswered: Record<string, unknown> = Object.fromEntries(
      questions.map(q => [q.id, "answered"])
    );
    const block = buildGateBlock(flags, allAnswered);
    expect(block).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: MVA Hit-and-Run + No Insurer Notification
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 2  -  MVA hit-and-run + no insurer notification (pi)", () => {
  const clientMessage =
    "I was in a car accident this morning. The other driver sped away. I couldn't get the license plate. I haven't called my insurance yet.";

  it("detects both mvac_hit_and_run and mvac_insurer_not_notified", () => {
    const flags = detectFlags(clientMessage, "pi");
    expect(flags).toContain("mvac_hit_and_run");
    expect(flags).toContain("mvac_insurer_not_notified");
  });

  it("both flags are S1", () => {
    const defs = getFlagDefinitions(["mvac_hit_and_run", "mvac_insurer_not_notified"]);
    expect(defs.every(d => d.severity === "S1")).toBe(true);
  });

  it("merged flags maintain S1-first ordering", () => {
    const flags = detectFlags(clientMessage, "pi");
    const merged = mergeFlags(flags, []);
    const s1Flags = merged.filter(id => FLAG_REGISTRY.get(id)?.severity === "S1");
    const s2Flags = merged.filter(id => FLAG_REGISTRY.get(id)?.severity === "S2");
    if (s1Flags.length > 0 && s2Flags.length > 0) {
      const lastS1Idx = merged.indexOf(s1Flags[s1Flags.length - 1]);
      const firstS2Idx = merged.indexOf(s2Flags[0]);
      expect(lastS1Idx).toBeLessThan(firstS2Idx);
    }
  });

  it("gate block is injected and critical note present", () => {
    const flags = detectFlags(clientMessage, "pi");
    const block = buildGateBlock(flags, {});
    expect(block).not.toBeNull();
    expect(block).toContain("CRITICAL");
  });

  it("gate is capped at 3 questions even with multiple flags", () => {
    const flags = detectFlags(clientMessage, "pi");
    const block = buildGateBlock(flags, {});
    const numbered = (block ?? "").match(/^\s+\d+\./gm) ?? [];
    expect(numbered.length).toBeLessThanOrEqual(3);
  });

  it("gate questions are drawn from S1 flags first", () => {
    const flags = detectFlags(clientMessage, "pi");
    const questions = getGateQuestions(flags);
    // Gate questions from S1 flags should precede S2 flags' questions
    const s1FlagDefs = getFlagDefinitions(flags.filter(id => FLAG_REGISTRY.get(id)?.severity === "S1"));
    const s1QIds = s1FlagDefs.flatMap(d => d.gateQuestions.map(q => q.id));
    const s2FlagDefs = getFlagDefinitions(flags.filter(id => FLAG_REGISTRY.get(id)?.severity === "S2"));
    const s2QIds = s2FlagDefs.flatMap(d => d.gateQuestions.map(q => q.id));
    if (s1QIds.length > 0 && s2QIds.length > 0) {
      const firstS1QIdx = questions.findIndex(q => s1QIds.includes(q.id));
      const firstS2QIdx = questions.findIndex(q => s2QIds.includes(q.id));
      if (firstS1QIdx !== -1 && firstS2QIdx !== -1) {
        expect(firstS1QIdx).toBeLessThan(firstS2QIdx);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: HRTO 1-Year Clock  -  Employment Discrimination
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 3  -  HRTO clock, employment discrimination (emp)", () => {
  const clientMessage =
    "My employer fired me shortly after I disclosed my disability. I believe this is discrimination.";

  it("detects emp_hrto_clock", () => {
    const flags = detectFlags(clientMessage, "emp");
    expect(flags).toContain("emp_hrto_clock");
  });

  it("emp_hrto_clock is S1", () => {
    expect(FLAG_REGISTRY.get("emp_hrto_clock")?.severity).toBe("S1");
  });

  it("gate includes question about timing of last discriminatory act", () => {
    const flags = detectFlags(clientMessage, "emp");
    const questions = getGateQuestions(flags);
    const texts = questions.map(q => q.text.toLowerCase());
    expect(texts.some(t => t.includes("when") || t.includes("last act") || t.includes("last"))).toBe(true);
  });

  it("no false positives  -  emp_severance_signed does NOT fire (nothing signed)", () => {
    const flags = detectFlags(clientMessage, "emp");
    expect(flags).not.toContain("emp_severance_signed");
  });

  it("gate block is critical", () => {
    const flags = detectFlags(clientMessage, "emp");
    expect(hasCriticalFlag(flags)).toBe(true);
    const block = buildGateBlock(flags, {});
    expect(block).toContain("CRITICAL");
  });

  it("discrimination via protected ground BEFORE 'discrimination' keyword also fires", () => {
    // Bidirectional pattern  -  ground comes first, then discrimination label
    const text = "I was passed over for promotions because of my age. I think this is discrimination.";
    const flags = detectFlags(text, "emp");
    expect(flags).toContain("emp_hrto_clock");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: Post-Closing Defect Discovery (real estate)
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 4  -  Post-closing defect discovery (real)", () => {
  const clientMessage =
    "After I moved in I found mold throughout the basement. The sellers never disclosed it.";

  it("detects real_estate_undisclosed_defects", () => {
    const flags = detectFlags(clientMessage, "real");
    expect(flags).toContain("real_estate_undisclosed_defects");
  });

  it("real_estate_undisclosed_defects is S1", () => {
    expect(FLAG_REGISTRY.get("real_estate_undisclosed_defects")?.severity).toBe("S1");
  });

  it("gate includes questions about possession date and discovery", () => {
    const flags = detectFlags(clientMessage, "real");
    const questions = getGateQuestions(flags);
    const texts = questions.map(q => q.text.toLowerCase());
    expect(texts.some(t => t.includes("possession") || t.includes("close") || t.includes("discover") || t.includes("when"))).toBe(true);
  });

  it("alternate phrasing also fires: found mold after buying", () => {
    const alt = "I found mold in the basement after buying the house. They never mentioned it.";
    const flags = detectFlags(alt, "real");
    expect(flags).toContain("real_estate_undisclosed_defects");
  });

  it("gate block is injected for both phrasings", () => {
    const msg1 = "After I moved in I found mold throughout the basement. The sellers never disclosed it.";
    const msg2 = "I found mold in the basement after buying the house. They never mentioned it.";
    expect(buildGateBlock(detectFlags(msg1, "real"), {})).not.toBeNull();
    expect(buildGateBlock(detectFlags(msg2, "real"), {})).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 5: RAD 15-Day Appeal Deadline (immigration)
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 5  -  RAD appeal deadline (imm)", () => {
  const clientMessage =
    "My refugee claim was refused by the RPD last week and I need to appeal.";

  it("detects imm_rad_deadline", () => {
    const flags = detectFlags(clientMessage, "imm");
    expect(flags).toContain("imm_rad_deadline");
  });

  it("imm_rad_deadline is S1", () => {
    expect(FLAG_REGISTRY.get("imm_rad_deadline")?.severity).toBe("S1");
  });

  it("gate includes question about RPD decision date", () => {
    const flags = detectFlags(clientMessage, "imm");
    const questions = getGateQuestions(flags);
    const texts = questions.map(q => q.text.toLowerCase());
    expect(texts.some(t => t.includes("date") || t.includes("rpd") || t.includes("decision") || t.includes("received"))).toBe(true);
  });

  it("gate block is critical with CRITICAL note", () => {
    const flags = detectFlags(clientMessage, "imm");
    const block = buildGateBlock(flags, {});
    expect(block).not.toBeNull();
    expect(block).toContain("CRITICAL");
  });

  it("imm_removal_order does NOT fire (no deportation order mentioned)", () => {
    const flags = detectFlags(clientMessage, "imm");
    expect(flags).not.toContain("imm_removal_order");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 6: Cross-Turn Flag Accumulation
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 6  -  Cross-turn flag accumulation", () => {
  const turn1Text = "I had a car accident two years ago and I had a lawyer before but fired them.";
  const turn2Text = "I was in a car accident this morning. The other driver sped away.";
  const combinedText = `${turn1Text}\n${turn2Text}`;

  it("turn 1 (no PA): universal flags only  -  limitation_proximity + prior_counsel", () => {
    const flags = detectFlags(turn1Text, "");
    expect(flags).toContain("limitation_proximity");
    expect(flags).toContain("prior_counsel");
    // PA-specific flags must NOT fire when PA is unknown
    expect(flags).not.toContain("mvac_hit_and_run");
    expect(flags).not.toContain("mvac_insurer_not_notified");
  });

  it("turn 2 (PA=pi): PA-specific flags added", () => {
    const turn2Flags = detectFlags(turn2Text, "pi");
    expect(turn2Flags).toContain("mvac_hit_and_run");
  });

  it("merged flags across turns preserve all detections", () => {
    const storedFromTurn1 = detectFlags(turn1Text, "");
    const turn2Flags = detectFlags(turn2Text, "pi");
    const merged = mergeFlags(storedFromTurn1, turn2Flags);
    expect(merged).toContain("limitation_proximity");
    expect(merged).toContain("prior_counsel");
    expect(merged).toContain("mvac_hit_and_run");
  });

  it("running detectFlags on combined text with PA produces full flag set", () => {
    const flags = detectFlags(combinedText, "pi");
    expect(flags).toContain("limitation_proximity");
    expect(flags).toContain("prior_counsel");
    expect(flags).toContain("mvac_hit_and_run");
  });

  it("mergeFlags deduplicates  -  no flag appears twice", () => {
    const a = detectFlags(turn1Text, "");
    const b = detectFlags(combinedText, "pi");
    const merged = mergeFlags(a, b);
    const seen = new Set<string>();
    for (const id of merged) {
      expect(seen.has(id), `Duplicate flag: ${id}`).toBe(false);
      seen.add(id);
    }
  });

  it("S1 flags always precede S2 in merged result across turns", () => {
    const a = detectFlags(turn1Text, "");
    const b = detectFlags(turn2Text, "pi");
    const merged = mergeFlags(a, b);
    let seenS2 = false;
    for (const id of merged) {
      const sev = FLAG_REGISTRY.get(id)?.severity;
      if (sev === "S2") seenS2 = true;
      if (seenS2 && sev === "S1") {
        throw new Error(`S1 flag ${id} appeared after an S2 flag in merged result`);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 7: Gate Injection Text Assembly
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 7  -  Gate injection text assembly", () => {
  it("no gate block when no flags", () => {
    const block = buildGateBlock([], {});
    expect(block).toBeNull();
  });

  it("no gate block when all gate questions already answered", () => {
    const flags = ["slip_ice_snow"];
    const questions = getGateQuestions(flags);
    const allAnswered = Object.fromEntries(questions.map(q => [q.id, "yes"]));
    expect(buildGateBlock(flags, allAnswered)).toBeNull();
  });

  it("gate block contains separator and section header", () => {
    const flags = ["slip_ice_snow"];
    const block = buildGateBlock(flags, {});
    expect(block).toContain("━━━");
    expect(block).toContain("COMPLIANCE FLAGS");
    expect(block).toContain("MANDATORY GATE QUESTIONS");
  });

  it("S2-only flags do NOT produce CRITICAL note", () => {
    // pi_evidence_preservation is S2
    const flags = ["pi_evidence_preservation"];
    const block = buildGateBlock(flags, {});
    expect(block).not.toBeNull();
    expect(block).not.toContain("CRITICAL");
  });

  it("S1 flag produces CRITICAL note", () => {
    // mvac_hit_and_run is S1
    const flags = ["mvac_hit_and_run"];
    const block = buildGateBlock(flags, {});
    expect(block).toContain("CRITICAL");
  });

  it("gate lines include question IDs in brackets", () => {
    const flags = ["mvac_insurer_not_notified"];
    const block = buildGateBlock(flags, {});
    expect(block).toMatch(/\[\w+__q\d+\]/);
  });

  it("question numbering starts at 1", () => {
    const flags = ["mvac_insurer_not_notified"];
    const block = buildGateBlock(flags, {});
    expect(block).toContain("  1. [");
  });

  it("partial answer  -  only unanswered questions injected", () => {
    const flags = ["mvac_insurer_not_notified"];
    const questions = getGateQuestions(flags);
    expect(questions.length).toBeGreaterThanOrEqual(2);

    // Answer q1 only
    const partial = { [questions[0].id]: "yes" };
    const block = buildGateBlock(flags, partial);

    expect(block).not.toBeNull();
    expect(block).not.toContain(`[${questions[0].id}]`);
    expect(block).toContain(`[${questions[1].id}]`);
  });

  it("mixed S1+S2 flags: S1 gate questions precede S2 gate questions", () => {
    // mvac_insurer_not_notified (S1), pi_evidence_preservation (S2)
    const flags = mergeFlags(["pi_evidence_preservation"], ["mvac_insurer_not_notified"]);
    const questions = getGateQuestions(flags);

    const s1QIds = getFlagDefinitions(["mvac_insurer_not_notified"])
      .flatMap(d => d.gateQuestions.map(q => q.id));
    const s2QIds = getFlagDefinitions(["pi_evidence_preservation"])
      .flatMap(d => d.gateQuestions.map(q => q.id));

    const firstS1 = questions.findIndex(q => s1QIds.includes(q.id));
    const firstS2 = questions.findIndex(q => s2QIds.includes(q.id));

    if (firstS1 !== -1 && firstS2 !== -1) {
      expect(firstS1).toBeLessThan(firstS2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 8: shouldRunClassifier logic
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 8  -  shouldRunClassifier", () => {
  it("runs on turn 1 with intent step, not locked", () => {
    expect(shouldRunClassifier(1, "intent", false)).toBe(true);
  });

  it("runs on turn 2 with questions step, not locked", () => {
    expect(shouldRunClassifier(2, "questions", false)).toBe(true);
  });

  it("does NOT run on turn 3 or later", () => {
    expect(shouldRunClassifier(3, "questions", false)).toBe(false);
    expect(shouldRunClassifier(5, "questions", false)).toBe(false);
  });

  it("does NOT run when sub-type is locked", () => {
    expect(shouldRunClassifier(1, "intent", true)).toBe(false);
  });

  it("does NOT run on identity step", () => {
    expect(shouldRunClassifier(1, "identity", false)).toBe(false);
  });

  it("does NOT run on otp step", () => {
    expect(shouldRunClassifier(1, "otp", false)).toBe(false);
  });

  it("does NOT run on result step", () => {
    expect(shouldRunClassifier(1, "result", false)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 9: No false positives on clean messages
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 9  -  No false positives on clean messages", () => {
  it("standard divorce inquiry: no S1 flags", () => {
    const text = "My wife and I are separating. We want to know how to divide our assets.";
    const flags = detectFlags(text, "fam");
    const s1Flags = flags.filter(id => FLAG_REGISTRY.get(id)?.severity === "S1");
    expect(s1Flags).toHaveLength(0);
  });

  it("recent MVA without hit-and-run: no mvac_hit_and_run", () => {
    const text = "I was rear-ended at a traffic light last Tuesday. The other driver stopped and gave me their insurance.";
    const flags = detectFlags(text, "pi");
    expect(flags).not.toContain("mvac_hit_and_run");
  });

  it("workplace complaint without protected ground: no emp_hrto_clock", () => {
    const text = "My employer has been treating me badly and I want to know my options.";
    const flags = detectFlags(text, "emp");
    expect(flags).not.toContain("emp_hrto_clock");
  });

  it("online defamation (social media only): no defamation_media_notice", () => {
    const text = "Someone posted lies about me on Facebook and Instagram. It has gone viral.";
    const flags = detectFlags(text, "defam");
    expect(flags).not.toContain("defamation_media_notice");
  });

  it("domestic custody (no international element): no fam_abduction", () => {
    const text = "My ex won't let me see the kids. He moved to Ottawa and I'm in Toronto.";
    const flags = detectFlags(text, "fam");
    expect(flags).not.toContain("fam_abduction");
  });

  it("completely out-of-scope message: no flags fire for unknown PA", () => {
    const text = "Hello, I'd like some general advice about starting a business.";
    const flags = detectFlags(text, "");
    // Only universal flags with clear trigger patterns could fire  -  none should for this text
    expect(flags).not.toContain("limitation_proximity");
    expect(flags).not.toContain("fam_abduction");
    expect(flags).not.toContain("mvac_hit_and_run");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 10: Gate question deduplication across overlapping flags
// ─────────────────────────────────────────────────────────────────────────────

describe("Scenario 10  -  Gate question deduplication", () => {
  it("no duplicate question IDs when multiple flags active", () => {
    // Both ltd_appeal_clock_running and ins_claim_denial are active for insurance denial
    const flags = mergeFlags(["ltd_appeal_clock_running"], ["ins_claim_denial"]);
    const questions = getGateQuestions(flags);
    const ids = questions.map(q => q.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("question IDs are globally unique across all flags in registry", () => {
    const allQIds: string[] = [];
    for (const [, flag] of FLAG_REGISTRY) {
      for (const q of flag.gateQuestions) {
        allQIds.push(q.id);
      }
    }
    const unique = new Set(allQIds);
    expect(unique.size).toBe(allQIds.length);
  });

  it("gateQuestions returns empty for empty flags list", () => {
    expect(getGateQuestions([])).toHaveLength(0);
  });

  it("gateQuestions silently ignores unknown flag IDs", () => {
    const questions = getGateQuestions(["nonexistent_xyz_flag", "slip_ice_snow"]);
    expect(questions.length).toBeGreaterThan(0);
  });
});
