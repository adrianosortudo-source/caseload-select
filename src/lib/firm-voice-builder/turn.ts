/**
 * Pure logic for the Firm Voice Builder turn endpoint: request validation
 * and transcript-to-Gemini-contents mapping. No I/O, unit-testable without
 * a network mock. BUILD_PLAN_firm_voice_builder_tool_v1.md Phase 1.
 *
 * Stateless by design (plan L3): the server never persists a transcript.
 * The browser resends the full running transcript on every turn; this
 * module's job is to validate that payload and translate it into the shape
 * the Gemini SDK expects.
 */

import { OPENING_MESSAGE } from "./system-prompt";

export type TranscriptRole = "interviewer" | "lawyer";

export interface TranscriptEntry {
  role: TranscriptRole;
  text: string;
}

export interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

// Caps per plan L4. Friendly 400s past these, never a silent truncation.
export const MAX_INTERVIEWER_TURNS = 60;
export const MAX_ANSWER_CHARS = 30_000;
export const MAX_TRANSCRIPT_CHARS = 200_000;

export type ValidationResult =
  | { valid: true; transcript: TranscriptEntry[] }
  | { valid: false; error: string };

/**
 * Validates the raw request body's `transcript` field. Requires:
 *  - an array of {role, text} objects, role in ("interviewer" | "lawyer")
 *  - non-empty, trimmed text on every entry
 *  - the FIRST entry is role "interviewer" (the hardcoded opening question,
 *    included by the client per plan L6)
 *  - the LAST entry is role "lawyer" (the answer this turn is responding to)
 *  - roles strictly alternate (no two interviewer or two lawyer turns back
 *    to back), since a stateless server cannot merge or reconcile a
 *    malformed history
 *  - every single entry's text is within MAX_ANSWER_CHARS
 *  - total transcript text is within MAX_TRANSCRIPT_CHARS
 *  - interviewer-turn count is within MAX_INTERVIEWER_TURNS
 */
export function validateTranscript(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "malformed request body" };
  }
  const raw = (body as Record<string, unknown>).transcript;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { valid: false, error: "transcript must be a non-empty array" };
  }

  const transcript: TranscriptEntry[] = [];
  let totalChars = 0;
  let interviewerTurns = 0;

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (typeof entry !== "object" || entry === null) {
      return { valid: false, error: `transcript[${i}] is not an object` };
    }
    const role = (entry as Record<string, unknown>).role;
    const text = (entry as Record<string, unknown>).text;
    if (role !== "interviewer" && role !== "lawyer") {
      return { valid: false, error: `transcript[${i}].role must be "interviewer" or "lawyer"` };
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      return { valid: false, error: `transcript[${i}].text must be a non-empty string` };
    }
    if (text.length > MAX_ANSWER_CHARS) {
      return { valid: false, error: `transcript[${i}].text exceeds ${MAX_ANSWER_CHARS} characters` };
    }
    if (role === "interviewer") interviewerTurns++;
    totalChars += text.length;
    transcript.push({ role, text });
  }

  if (transcript[0].role !== "interviewer") {
    return { valid: false, error: "transcript must start with the interviewer's opening question" };
  }
  if (transcript[transcript.length - 1].role !== "lawyer") {
    return { valid: false, error: "transcript must end with the lawyer's latest answer" };
  }
  for (let i = 1; i < transcript.length; i++) {
    if (transcript[i].role === transcript[i - 1].role) {
      return { valid: false, error: `transcript[${i}] repeats the previous role; roles must alternate` };
    }
  }
  if (totalChars > MAX_TRANSCRIPT_CHARS) {
    return { valid: false, error: `transcript exceeds ${MAX_TRANSCRIPT_CHARS} total characters` };
  }
  if (interviewerTurns > MAX_INTERVIEWER_TURNS) {
    return { valid: false, error: `interview has exceeded ${MAX_INTERVIEWER_TURNS} turns` };
  }

  return { valid: true, transcript };
}

/**
 * Maps a validated transcript to the Gemini contents array. Prepends a
 * synthetic "user" kickoff turn before the hardcoded opening interviewer
 * message, so the array both starts with "user" (satisfies the Gemini API's
 * alternation contract regardless of how strictly it is enforced) and gives
 * the model full context of what its own opening question was.
 */
export function transcriptToGeminiContents(transcript: TranscriptEntry[]): GeminiContent[] {
  const contents: GeminiContent[] = [{ role: "user", parts: [{ text: "Begin the interview." }] }];
  for (const entry of transcript) {
    contents.push({
      role: entry.role === "lawyer" ? "user" : "model",
      parts: [{ text: entry.text }],
    });
  }
  return contents;
}

/**
 * True when the client's transcript[0] text matches the server's own
 * hardcoded opening question, defending against a stale client build
 * sending a different opener than the one Gemini is being told it asked.
 * Not a hard validation failure (the interview can still proceed), just a
 * signal the caller may want to log.
 */
export function openingMessageMatches(transcript: TranscriptEntry[]): boolean {
  return transcript.length > 0 && transcript[0].text === OPENING_MESSAGE;
}
