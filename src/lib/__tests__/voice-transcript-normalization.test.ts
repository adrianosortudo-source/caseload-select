import { describe, it, expect } from "vitest";
import { normalizeVoiceTranscript } from "../voice-transcript-normalization";
import { initialiseState } from "../screen-engine/extractor";

/**
 * Tests for the voice-transcript-normalization adapter.
 *
 * Codex pushback 2026-05-27 (commit: forthcoming) — five named cases:
 *   1. "state planning" classifies as estates
 *   2. "planning a bill" classifies as will drafting only when adjacent
 *      to planning / my / mine
 *   3. assistant matter confirmation + human yes produces a canonical
 *      confirmation line
 *   4. generic opener listing practice areas still does not affect
 *      classification
 *   5. "yes" to "do you own property?" does not become invoice_exists
 *
 * Plus end-to-end tests that pipe the normalized transcript through
 * `initialiseState` to confirm the downstream matter-type
 * classification actually flips to the correct value.
 */

describe("normalizeVoiceTranscript — ASR fixes", () => {
  it("rewrites 'state planning' → 'estate planning'", () => {
    const input = "human: I am looking for help with state planning.";
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).toContain("estate planning");
    // Word-bounded check: bare "state planning" (preceded by anything but
    // "e") should be gone. The output "estate planning" contains
    // "state planning" as a substring but not as a free-standing token.
    expect(r.normalized).not.toMatch(/(^|[^a-zA-Z])state planning\b/);
    expect(r.changes.some((c) => c.detail.includes("state planning"))).toBe(true);
  });

  it("rewrites 'planning a bill' → 'planning a will' when adjacent", () => {
    const input = "human: I'm planning a bill.";
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).toContain("planning a will");
    expect(r.normalized).not.toContain("planning a bill");
  });

  it("rewrites 'planning my bill' and 'planning the bill' too", () => {
    expect(normalizeVoiceTranscript("planning my bill").normalized).toContain("planning my will");
    expect(normalizeVoiceTranscript("planning the bill").normalized).toContain("planning the will");
  });

  it("leaves 'pay a bill' / 'send the bill' alone (not adjacent to planning)", () => {
    // Codex test case 2: scope tightly. "planning to pay a bill" is a
    // payment context, NOT estate planning.
    const input = "human: I need help planning to pay a bill that is overdue.";
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).toContain("pay a bill");
    expect(r.normalized).not.toContain("pay a will");
  });

  it("leaves bare 'state' alone (only fixes the 'state planning' bigram)", () => {
    const input = "human: I live in the state of Ontario.";
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).toContain("state of Ontario");
  });

  it("'plan my state' → 'plan my estate'", () => {
    const input = "human: I want to plan my state before I retire.";
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).toContain("plan my estate");
  });

  it("'power of eternity' → 'power of attorney'", () => {
    const input = "human: I need a power of eternity for my mother.";
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).toContain("power of attorney");
    expect(r.normalized).not.toContain("power of eternity");
  });

  it("'wrongful determination' → 'wrongful termination'", () => {
    const input = "human: I was let go and I think this is wrongful determination.";
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).toContain("wrongful termination");
  });

  it("case-insensitive ASR fixes", () => {
    const input = "HUMAN: STATE PLANNING please.";
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized.toLowerCase()).toContain("estate planning");
  });

  it("empty / null input is safe", () => {
    expect(normalizeVoiceTranscript("").normalized).toBe("");
    expect(normalizeVoiceTranscript("" as string).changes).toEqual([]);
    // null / undefined are guarded at the helper level
    expect(normalizeVoiceTranscript(null as unknown as string).normalized).toBe("");
  });

  it("no changes when transcript has no ASR errors", () => {
    const input = "human: I want a will and estate planning, please.";
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).toBe(input);
    expect(r.changes).toEqual([]);
  });
});

describe("normalizeVoiceTranscript — confirmation preservation", () => {
  it("injects synthetic confirmation line after bot readback + human yes", () => {
    // Codex test case 3.
    const input = [
      "bot: Just to make sure I have this right, you're looking for help with will and estate planning, is that correct?",
      "human: Yes.",
    ].join("\n");
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).toContain("Caller confirmed they are looking for help with will and estate planning");
    expect(r.changes.some((c) => c.kind === "confirmation_injection")).toBe(true);
  });

  it("preserves the original human 'Yes' line — does not replace it", () => {
    const input = [
      "bot: Just to make sure I have this right, you're describing a wrongful dismissal, is that correct?",
      "human: Yes.",
    ].join("\n");
    const r = normalizeVoiceTranscript(input);
    // The original "Yes" stays, the synthetic confirmation is added.
    expect(r.normalized).toMatch(/human: Yes\./);
    expect(r.normalized).toContain("Caller confirmed they are looking for help with wrongful dismissal");
  });

  it("recognises multiple affirmative phrasings", () => {
    const variants = ["Yes.", "Yeah.", "Yep.", "Right.", "Correct.", "That's right.", "That's correct.", "Exactly."];
    for (const v of variants) {
      const input = [
        "bot: Just to make sure, you're describing a shareholder dispute, is that correct?",
        `human: ${v}`,
      ].join("\n");
      const r = normalizeVoiceTranscript(input);
      expect(r.normalized).toContain("Caller confirmed they are looking for help with shareholder dispute");
    }
  });

  it("does NOT inject when human's next turn is a 'No' / correction", () => {
    const input = [
      "bot: Just to make sure, you're describing a shareholder dispute, is that correct?",
      "human: No, this is an estate matter.",
    ].join("\n");
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).not.toContain("Caller confirmed they are looking for help with shareholder dispute");
    expect(r.changes.filter((c) => c.kind === "confirmation_injection")).toHaveLength(0);
  });

  // Codex pushback 2026-05-27: "Yes, but actually X" starts affirmative
  // but the caller is correcting the bot's understanding. Must NOT inject.
  it("does NOT inject when affirmative line carries a correction marker ('Yes, but actually probate')", () => {
    const input = [
      "bot: Just to make sure, you're describing a will and estate planning matter, is that correct?",
      "human: Yes, but actually probate.",
    ].join("\n");
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).not.toContain("Caller confirmed they are looking for help with will and estate planning");
    expect(r.changes.filter((c) => c.kind === "confirmation_injection")).toHaveLength(0);
  });

  it("does NOT inject on other correction markers (no, not, instead, however, wait, rather)", () => {
    const variants = [
      "Yes, no, it's an estate dispute.",
      "Yes, not really — it's probate.",
      "Yes, instead I want a power of attorney.",
      "Yes, however the real issue is probate.",
      "Yes, wait, actually probate.",
      "Yes, rather a power of attorney.",
      "Yes, except it's probate, not drafting.",
    ];
    for (const reply of variants) {
      const input = [
        "bot: Just to make sure, you're describing a will and estate planning matter, is that correct?",
        `human: ${reply}`,
      ].join("\n");
      const r = normalizeVoiceTranscript(input);
      expect(r.normalized, `failed on reply: ${reply}`).not.toContain(
        "Caller confirmed they are looking for help with will and estate planning",
      );
    }
  });

  it("STILL injects on clean affirmatives that happen to share letters with a marker", () => {
    // Safety: "Yes" alone, "Yes." with punctuation, "Yes that's right" —
    // none of these contain any correction marker, so injection fires.
    const variants = ["Yes.", "Yes that's right.", "Yeah exactly.", "Yep correct."];
    for (const reply of variants) {
      const input = [
        "bot: Just to make sure, you're describing a will and estate planning matter, is that correct?",
        `human: ${reply}`,
      ].join("\n");
      const r = normalizeVoiceTranscript(input);
      expect(r.normalized, `failed on reply: ${reply}`).toContain(
        "Caller confirmed they are looking for help with will and estate planning",
      );
    }
  });

  it("does NOT inject when bot's line lacks a confirmation-question shape", () => {
    // Codex test case 4: the opener that lists multiple practice areas
    // must NOT trip the confirmation injection — it's not a readback.
    const input = [
      "bot: Thanks for calling DRG Law. We help with corporate, real estate, wills and estates, and employment matters. Tell me your name and what we can help with.",
      "human: Yes.",
    ].join("\n");
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).not.toContain("Caller confirmed");
    expect(r.changes.filter((c) => c.kind === "confirmation_injection")).toHaveLength(0);
  });

  it("does NOT inject for a generic 'do you own property?' confirmation", () => {
    // Codex test case 5: the engine's old bug was that "yes" to "do
    // you own property?" became invoice_exists. The normalisation
    // adapter must NOT make this worse by injecting any matter-area
    // confirmation — there isn't a canonical phrase in that bot line.
    const input = [
      "bot: Do you own property, a business, or any other significant assets?",
      "human: Yes.",
    ].join("\n");
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).not.toContain("Caller confirmed");
  });

  it("handles longest-matching canonical phrase (greedy)", () => {
    // "will and estate planning" should win over "estate planning" so
    // the injected line carries the more specific phrase.
    const input = [
      "bot: Just to make sure I have this right, you're looking for help with will and estate planning, is that correct?",
      "human: Yes.",
    ].join("\n");
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).toContain("will and estate planning");
    expect(r.normalized).not.toContain("Caller confirmed they are looking for help with estate planning\n");
  });

  it("handles whitespace and blank lines between bot turn and human reply", () => {
    const input = [
      "bot: Just to make sure, you're describing a wrongful dismissal, is that correct?",
      "",
      "",
      "human: Yes.",
    ].join("\n");
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized).toContain("Caller confirmed they are looking for help with wrongful dismissal");
  });

  it("multiple readbacks in one transcript each get their own confirmation", () => {
    const input = [
      "bot: Just to make sure, you're describing a wrongful dismissal, is that correct?",
      "human: Yes.",
      "bot: And you also need help with will and estate planning, is that right?",
      "human: Yes.",
    ].join("\n");
    const r = normalizeVoiceTranscript(input);
    expect(r.normalized.match(/Caller confirmed/g)?.length ?? 0).toBe(2);
    expect(r.normalized).toContain("wrongful dismissal");
    expect(r.normalized).toContain("will and estate planning");
  });
});

describe("normalizeVoiceTranscript — end-to-end via initialiseState", () => {
  // The whole point of the adapter: when we run the normalized transcript
  // through the engine's classifier, the matter type comes out correctly.
  // These tests use Damaris's actual May 27 test-call transcript (lead
  // L-2026-05-27-UT5, lifted verbatim from the production row).

  const DAMARIS_TRANSCRIPT_RAW =
    "bot:Thanks for calling DRG Law. We help with corporate, real estate, wills and estates, and employment matters. Tell me your name and what we can help with.\n" +
    "human:Hello. My name is Damaris. I am looking for help with state planning.\n" +
    "bot:Thanks, Damaris. Can I get your last name as well? I'll confirm the spelling to make sure I have it right.\n" +
    "human:Diaz.\n" +
    "bot:Got it. Now, I see your number as two two six, eight nine eight, five six eight one. Is that the best number to reach you back at?\n" +
    "human:Yes.\n" +
    "bot:Could you tell me a bit more about what you're looking for help with regarding estate planning? For example, are you putting together a will, planning for someone to handle things if something happens to you, or dealing with someone who has passed away?\n" +
    "human:I'm planning a bill.\n" +
    "bot:Got it, you're planning a will. Do you own property, a business, or any other significant assets you'd like included in the will?\n" +
    "human:Yes.\n";

  it("BEFORE normalisation: raw transcript misclassifies into non-estates territory (the bug)", () => {
    // The engine's stripBotLinesForClassification handles bot-line
    // removal internally. The raw transcript without normalisation
    // produces NOT-estates: ASR-corrupted "state planning" + "planning
    // a bill" + "Yes" to "do you own property?" looks like a
    // payment-collection or corporate matter to the classifier.
    const state = initialiseState(DAMARIS_TRANSCRIPT_RAW);
    expect(state.practice_area).not.toBe("estates");
  });

  it("AFTER normalisation (legacy prompt, no canonical readback): classifies to estates area", () => {
    // Adapter does the ASR fix ("state planning" → "estate planning",
    // "planning a bill" → "planning a will"). The transcript now
    // contains "estate planning" which is in ESTATES_SIGNALS, so
    // detectInScopeArea picks 'estates'. classifyEstatesSubType
    // returns 'estates_general' because the legacy bot doesn't do
    // an explicit canonical readback — the engine's WILL_DRAFTING
    // signal set requires "make/need/want a will" or "will and
    // estate planning", neither of which appears in the caller's
    // raw words alone. Moving from `unpaid_invoice` (totally wrong)
    // to `estates_general` (right area) is the legacy-prompt win.
    const { normalized } = normalizeVoiceTranscript(DAMARIS_TRANSCRIPT_RAW);
    const state = initialiseState(normalized);
    expect(state.practice_area).toBe("estates");
    expect(state.matter_type).toBe("estates_general");
  });

  it("AFTER normalisation WITH new-prompt canonical readback: classifies to will_drafting sub-type", () => {
    // Once the operator updates the GHL Voice AI agent prompt to do
    // the canonical readback (Layer 1 / step 4 of the voice-agent-
    // prompt-template), the bot's line contains "will and estate
    // planning, is that correct?" — and the adapter's confirmation
    // injection fires on the next human "Yes". The synthetic line
    // then carries "will and estate planning" which IS in
    // ESTATES_WILL_DRAFTING_SIGNALS, so classifyEstatesSubType
    // promotes to 'will_drafting'.
    const transcriptWithReadback =
      DAMARIS_TRANSCRIPT_RAW +
      "bot:Just to make sure I have this right, you're looking for help with will and estate planning, is that correct?\n" +
      "human:Yes.\n";
    const { normalized, changes } = normalizeVoiceTranscript(transcriptWithReadback);
    expect(changes.some((c) => c.kind === "confirmation_injection")).toBe(true);
    const state = initialiseState(normalized);
    expect(state.practice_area).toBe("estates");
    expect(state.matter_type).toBe("will_drafting");
  });
});
