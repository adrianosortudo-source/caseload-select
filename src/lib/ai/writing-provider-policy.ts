import type { AiProvider } from "./openai";

export const WRITING_PROVIDER_HEADER = "X-CaseLoad-AI-Provider";

/** An older client saw the original Gemini disclosure. A header can only confirm the server's choice. */
export function matchesWritingProvider(headers: Headers, configured: AiProvider): boolean {
  return (headers.get(WRITING_PROVIDER_HEADER) ?? "gemini") === configured;
}
