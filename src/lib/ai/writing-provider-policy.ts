import type { AiProvider } from "./openai";

export const WRITING_PROVIDER_HEADER = "X-CaseLoad-AI-Provider";

export function providerName(provider: AiProvider): string {
  return provider === "openai" ? "OpenAI" : "Google Gemini";
}

/** An older client saw the original Gemini disclosure. A header can only confirm the server's choice. */
export function matchesWritingProvider(headers: Headers, configured: AiProvider): boolean {
  return (headers.get(WRITING_PROVIDER_HEADER) ?? "gemini") === configured;
}
