import { describe, it, expect } from "vitest";
import {
  parseSectionTag,
  extractProfile,
  SYSTEM_PROMPT,
  OPENING_MESSAGE,
  PROFILE_START_MARKER,
  PROFILE_END_MARKER,
} from "../system-prompt";

describe("parseSectionTag", () => {
  it("extracts the section number and strips the tag", () => {
    const result = parseSectionTag("[SECTION:3]\nWhat phrases do you catch yourself using?");
    expect(result.section).toBe(3);
    expect(result.text).toBe("What phrases do you catch yourself using?");
  });

  it("handles every valid section number 1 through 7", () => {
    for (let n = 1; n <= 7; n++) {
      const result = parseSectionTag(`[SECTION:${n}]\nsome question`);
      expect(result.section).toBe(n);
    }
  });

  it("returns null section and the original text when the tag is missing", () => {
    const result = parseSectionTag("A question with no tag at all.");
    expect(result.section).toBeNull();
    expect(result.text).toBe("A question with no tag at all.");
  });

  it("does not match an out-of-range section number", () => {
    const result = parseSectionTag("[SECTION:8]\nsomething");
    expect(result.section).toBeNull();
  });

  it("tolerates a missing trailing newline after the tag", () => {
    const result = parseSectionTag("[SECTION:2] inline question");
    expect(result.section).toBe(2);
    expect(result.text).toBe("inline question");
  });

  // Regression guard: a live Gemini run (BUILD_PLAN Phase 3 G2) produced a
  // real message with the tag emitted twice in a row
  // ("[SECTION:3]\n[SECTION:3]\nI'm seeing a slight contradiction..."), and a
  // non-looped strip left a literal "[SECTION:3]" visible in the chat
  // bubble. Both leading occurrences must be stripped, keeping the section
  // number from the first.
  it("strips a doubled leading tag entirely, keeping the first section number", () => {
    const result = parseSectionTag("[SECTION:3]\n[SECTION:3]\nI'm seeing a slight contradiction here.");
    expect(result.section).toBe(3);
    expect(result.text).toBe("I'm seeing a slight contradiction here.");
    expect(result.text).not.toContain("[SECTION:");
  });

  it("strips three or more doubled leading tags", () => {
    const result = parseSectionTag("[SECTION:5]\n[SECTION:5]\n[SECTION:5]\nquestion text");
    expect(result.section).toBe(5);
    expect(result.text).toBe("question text");
  });

  it("keeps the first section number if a doubled tag somehow disagrees", () => {
    // Should not happen in practice (the model would not contradict its own
    // section within one message), but the parser must not silently prefer
    // the later one over the first.
    const result = parseSectionTag("[SECTION:2]\n[SECTION:3]\nquestion text");
    expect(result.section).toBe(2);
  });
});

describe("extractProfile", () => {
  it("returns null when no markers are present", () => {
    expect(extractProfile("just a normal interview question")).toBeNull();
  });

  it("returns null when only the start marker is present", () => {
    expect(extractProfile(`some lead-in\n${PROFILE_START_MARKER}\nprofile content with no end`)).toBeNull();
  });

  it("extracts and trims the content between both markers", () => {
    const message = `Here it is.\n${PROFILE_START_MARKER}\n  # Firm Voice Profile\n\nBody text.\n  ${PROFILE_END_MARKER}\nAnything after.`;
    const result = extractProfile(message);
    expect(result).toBe("# Firm Voice Profile\n\nBody text.");
  });

  it("handles a profile immediately at the start of the message with no lead-in", () => {
    const message = `${PROFILE_START_MARKER}\ncontent\n${PROFILE_END_MARKER}`;
    expect(extractProfile(message)).toBe("content");
  });
});

describe("SYSTEM_PROMPT", () => {
  it("is non-empty and references the protocol markers", () => {
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(1000);
    expect(SYSTEM_PROMPT).toContain("ONE question at a time");
  });

  it("contains the Ontario advertising rails as hard rules", () => {
    expect(SYSTEM_PROMPT).toMatch(/ONTARIO ADVERTISING RAILS/);
    expect(SYSTEM_PROMPT).toMatch(/never promise or imply an outcome/);
  });

  it("contains the tiered AI-tell blocklist", () => {
    expect(SYSTEM_PROMPT).toMatch(/AI-TELL BLOCKLIST/);
    expect(SYSTEM_PROMPT).toMatch(/VOCABULARY:/);
    expect(SYSTEM_PROMPT).toMatch(/CONSTRUCTIONS:/);
    expect(SYSTEM_PROMPT).toMatch(/FORMATTING:/);
  });

  it("asks the fee-structure question in Section 1 (the fixture-test bug fix)", () => {
    expect(SYSTEM_PROMPT).toMatch(/how do your fees work/);
  });

  it("contains the new interview-conduct rules", () => {
    expect(SYSTEM_PROMPT).toMatch(/Push back on vague answers/);
    expect(SYSTEM_PROMPT).toMatch(/Call out contradictions/);
    expect(SYSTEM_PROMPT).toMatch(/follow an interesting thread/);
  });

  it("contains the confidentiality rule about client names", () => {
    expect(SYSTEM_PROMPT).toMatch(/strip client names/);
    expect(SYSTEM_PROMPT).toMatch(/Never reproduce a client's name/);
  });

  // Regression guard: a live Gemini run (BUILD_PLAN Phase 3 G2) found that
  // the [SECTION:n] tag and the profile-marker instructions were described
  // only in the spec file's surrounding prose, never actually inside the
  // fenced ```text block that gets extracted into this prompt, so the model
  // never saw them and never emitted the tag. Both instructions must live
  // inside the prompt text itself, not just documentation around it.
  it("instructs the model to emit the [SECTION:n] tag on every message", () => {
    expect(SYSTEM_PROMPT).toMatch(/\[SECTION:n\]/);
    expect(SYSTEM_PROMPT).toMatch(/Every single message you send, without exception, starts with the tag/);
    expect(SYSTEM_PROMPT).toMatch(/EXACTLY ONCE/);
  });

  it("instructs the model to wrap the profile in the exact marker strings", () => {
    expect(SYSTEM_PROMPT).toContain(PROFILE_START_MARKER);
    expect(SYSTEM_PROMPT).toContain(PROFILE_END_MARKER);
  });
});

describe("OPENING_MESSAGE", () => {
  it("carries a valid section tag parseable by parseSectionTag", () => {
    const result = parseSectionTag(OPENING_MESSAGE);
    expect(result.section).toBe(1);
    expect(result.text.length).toBeGreaterThan(0);
  });
});
