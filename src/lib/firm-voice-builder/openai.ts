import { hasOpenAIKey } from "@/lib/ai/openai";
import { PublicPilotCapacityError, requestVoiceOpenAI } from "@/lib/ai/public-tool-pilot-budget";
import type { FirmVoiceTurnResult } from "./gemini";
import { PROFILE_END_MARKER, PROFILE_START_MARKER, SYSTEM_PROMPT } from "./system-prompt";
import type { TranscriptEntry } from "./turn";

// The UI reveals and revises the guide only when the complete document is inside both markers.
const OPENAI_DELIVERY_INSTRUCTIONS = `When your own preceding message asks whether anything remains before building the profile and the answer confirms the interview is complete, deliver Section 7 in this response. Use the evidence already collected; leave unsupported details unspecified. Once the conversation is in Section 7, a request to revise the guide requires the complete revised profile, including its quick reference card, between the two protocol markers, and the proof pieces outside them. Do not repeat earlier interview questions at either delivery point. In the public review reply, acknowledge the feedback without confirming a client relationship or claiming what the reviewer said, received, or experienced. Never invent a review, a reviewer name, or a client name in any proof piece. Omit anecdotes explicitly described as fictional or hypothetical from the guide and proof pieces. Do not treat an invented scenario as the firm’s actual experience, usual process, or evidence.`;

// The model can repeat the opening marker before the quick-reference card. Keep the complete
// first profile and revision context while preventing the duplicate from appearing in the guide.
export function normalizeOpenAIVoiceProfile(text: string): string {
  const start = text.indexOf(PROFILE_START_MARKER);
  const end = text.indexOf(PROFILE_END_MARKER);
  if (start < 0 || end <= start) return text;
  const bodyStart = start + PROFILE_START_MARKER.length;
  const body = text.slice(bodyStart, end);
  if (!body.includes(PROFILE_START_MARKER)) return text;
  const lines = body.split("\n").filter(line => line.trim() !== PROFILE_START_MARKER);
  return text.slice(0, bodyStart) + lines.join("\n") + text.slice(end);
}

export async function runOpenAIVoiceTurn(transcript: TranscriptEntry[]): Promise<FirmVoiceTurnResult> {
  if (!hasOpenAIKey()) return { mode: "disabled" };
  try {
    const { text } = await requestVoiceOpenAI({
      model: process.env.FIRM_VOICE_BUILDER_OPENAI_MODEL ?? "gpt-6-luna",
      instructions: SYSTEM_PROMPT + "\n\n" + OPENAI_DELIVERY_INSTRUCTIONS,
      input: transcript.map(({ role, text }) => ({
        role: role === "interviewer" ? "assistant" : "user",
        content: text,
      })),
      maxOutputTokens: 16_384,
      signal: AbortSignal.timeout(45_000),
    });
    return text.trim() ? { mode: "live", text: normalizeOpenAIVoiceProfile(text) } : { mode: "error" };
  } catch (error) {
    if (error instanceof PublicPilotCapacityError) return { mode: "error", reason: "pilot_capacity" };
    // The complete interview may contain private wording. Never log the provider's exception.
    return { mode: "error" };
  }
}
