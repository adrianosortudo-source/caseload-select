import { hasOpenAIKey, requestOpenAI } from "@/lib/ai/openai";
import type { FirmVoiceTurnResult } from "./gemini";
import { SYSTEM_PROMPT } from "./system-prompt";
import type { TranscriptEntry } from "./turn";

// The UI reveals and revises the guide only when the complete document is inside both markers.
const OPENAI_DELIVERY_INSTRUCTIONS = `When your own preceding message asks whether anything remains before building the profile and the answer confirms the interview is complete, deliver Section 7 in this response. Use the evidence already collected; leave unsupported details unspecified. Once the conversation is in Section 7, a request to revise the guide requires the complete revised profile, including its quick reference card, between the two protocol markers, and the proof pieces outside them. Do not repeat earlier interview questions at either delivery point. In the public review reply, acknowledge the feedback without confirming a client relationship or claiming what the reviewer said, received, or experienced. Never invent a review, a reviewer name, or a client name in any proof piece.`;

export async function runOpenAIVoiceTurn(transcript: TranscriptEntry[]): Promise<FirmVoiceTurnResult> {
  if (!hasOpenAIKey()) return { mode: "disabled" };
  try {
    const { text } = await requestOpenAI({
      model: process.env.FIRM_VOICE_BUILDER_OPENAI_MODEL ?? "gpt-6-luna",
      instructions: SYSTEM_PROMPT + "\n\n" + OPENAI_DELIVERY_INSTRUCTIONS,
      input: transcript.map(({ role, text }) => ({
        role: role === "interviewer" ? "assistant" : "user",
        content: text,
      })),
      maxOutputTokens: 16_384,
      signal: AbortSignal.timeout(45_000),
    });
    return text.trim() ? { mode: "live", text } : { mode: "error" };
  } catch {
    // The complete interview may contain private wording. Never log the provider's exception.
    return { mode: "error" };
  }
}
