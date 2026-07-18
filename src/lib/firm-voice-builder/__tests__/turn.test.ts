import { describe, it, expect } from "vitest";
import {
  validateTranscript,
  transcriptToGeminiContents,
  openingMessageMatches,
  MAX_ANSWER_CHARS,
  MAX_TRANSCRIPT_CHARS,
  MAX_INTERVIEWER_TURNS,
  type TranscriptEntry,
} from "../turn";
import { OPENING_MESSAGE } from "../system-prompt";

function opener(text = OPENING_MESSAGE): TranscriptEntry {
  return { role: "interviewer", text };
}
function answer(text: string): TranscriptEntry {
  return { role: "lawyer", text };
}

describe("validateTranscript", () => {
  it("accepts a minimal well-formed transcript", () => {
    const result = validateTranscript({ transcript: [opener(), answer("I do family law in Hamilton.")] });
    expect(result.valid).toBe(true);
  });

  it("rejects a missing body", () => {
    expect(validateTranscript(null).valid).toBe(false);
    expect(validateTranscript(undefined).valid).toBe(false);
    expect(validateTranscript("nope").valid).toBe(false);
  });

  it("rejects a non-array transcript field", () => {
    expect(validateTranscript({ transcript: "nope" }).valid).toBe(false);
  });

  it("rejects an empty transcript array", () => {
    expect(validateTranscript({ transcript: [] }).valid).toBe(false);
  });

  it("rejects an entry with an invalid role", () => {
    const result = validateTranscript({ transcript: [{ role: "system", text: "hi" }] });
    expect(result.valid).toBe(false);
  });

  it("rejects an entry with empty text", () => {
    const result = validateTranscript({ transcript: [opener(), { role: "lawyer", text: "   " }] });
    expect(result.valid).toBe(false);
  });

  it("rejects a transcript that does not start with the interviewer", () => {
    const result = validateTranscript({ transcript: [answer("hi")] });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/must start with the interviewer/);
  });

  it("rejects a transcript that does not end with the lawyer", () => {
    const result = validateTranscript({ transcript: [opener(), answer("hi"), opener("next question")] });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/must end with the lawyer/);
  });

  it("rejects two consecutive lawyer turns", () => {
    const result = validateTranscript({
      transcript: [opener(), answer("first"), answer("second, sent again")],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/roles must alternate/);
  });

  it("rejects two consecutive interviewer turns", () => {
    const result = validateTranscript({
      transcript: [opener(), opener("a second opener"), answer("hi")],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/roles must alternate/);
  });

  it("rejects a single answer over the per-turn character cap", () => {
    const result = validateTranscript({ transcript: [opener(), answer("a".repeat(MAX_ANSWER_CHARS + 1))] });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/exceeds/);
  });

  it("accepts a single answer exactly at the per-turn character cap", () => {
    const result = validateTranscript({ transcript: [opener(), answer("a".repeat(MAX_ANSWER_CHARS))] });
    expect(result.valid).toBe(true);
  });

  it("rejects a transcript over the total character cap", () => {
    // Build a transcript of alternating short turns whose combined length
    // exceeds the cap, none of which individually exceeds the per-turn cap.
    const chunk = "a".repeat(MAX_ANSWER_CHARS);
    const turnsNeeded = Math.ceil(MAX_TRANSCRIPT_CHARS / MAX_ANSWER_CHARS) + 1;
    const transcript: TranscriptEntry[] = [];
    for (let i = 0; i < turnsNeeded; i++) {
      transcript.push(i % 2 === 0 ? opener(i === 0 ? OPENING_MESSAGE : chunk) : answer(chunk));
    }
    // Ensure it ends on a lawyer turn per the other invariant.
    if (transcript[transcript.length - 1].role !== "lawyer") transcript.push(answer("final"));
    const result = validateTranscript({ transcript });
    expect(result.valid).toBe(false);
  });

  it("rejects a transcript over the interviewer-turn cap", () => {
    const transcript: TranscriptEntry[] = [opener()];
    for (let i = 0; i < MAX_INTERVIEWER_TURNS; i++) {
      transcript.push(answer(`answer ${i}`));
      transcript.push(opener(`question ${i}`));
    }
    transcript.push(answer("final answer"));
    const result = validateTranscript({ transcript });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/exceeded/);
  });
});

describe("transcriptToGeminiContents", () => {
  it("prepends a synthetic user kickoff turn", () => {
    const contents = transcriptToGeminiContents([opener(), answer("hi")]);
    expect(contents[0].role).toBe("user");
    expect(contents[0].parts[0].text).toBe("Begin the interview.");
  });

  it("maps interviewer to model and lawyer to user, preserving order", () => {
    const contents = transcriptToGeminiContents([opener("Q1"), answer("A1"), opener("Q2"), answer("A2")]);
    const roles = contents.map((c) => c.role);
    expect(roles).toEqual(["user", "model", "user", "model", "user"]);
    expect(contents[1].parts[0].text).toBe("Q1");
    expect(contents[4].parts[0].text).toBe("A2");
  });

  it("always starts with role user regardless of transcript content", () => {
    const contents = transcriptToGeminiContents([opener(), answer("only one exchange")]);
    expect(contents[0].role).toBe("user");
  });
});

describe("openingMessageMatches", () => {
  it("returns true when the first entry matches the canonical opener", () => {
    expect(openingMessageMatches([opener(), answer("hi")])).toBe(true);
  });

  it("returns false when the first entry has drifted from the canonical opener", () => {
    expect(openingMessageMatches([opener("a different question"), answer("hi")])).toBe(false);
  });

  it("returns false for an empty transcript", () => {
    expect(openingMessageMatches([])).toBe(false);
  });
});
