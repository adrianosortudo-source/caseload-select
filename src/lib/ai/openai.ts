import "server-only";

export type AiProvider = "gemini" | "openai";

export function getProvider(setting: string): AiProvider {
  return process.env[setting] === "openai" ? "openai" : "gemini";
}

export function hasOpenAIKey(): boolean {
  return Boolean(process.env.CASELOAD_OPENAI_API_KEY?.trim());
}

type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: "auto" | "low" | "high" };

type Message = { role: "user" | "assistant" | "system"; content: string | InputPart[] };

interface GenerationRequest {
  serviceTier?: "default";
  model: string;
  instructions?: string;
  input: string | Message[];
  maxOutputTokens: number;
  format?: { name: string; schema: Record<string, unknown>; strict?: boolean };
  signal?: AbortSignal;
}

interface GenerationResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

interface ResponsesPayload {
  status?: string;
  output?: Array<{ type: string; phase?: string; status?: string; content?: Array<{ type: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

class OpenAIRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// Keep the endpoint fixed so these calls always bill the CaseLoad project.
// Caller-specific retry policies govern all retries, including validation repairs.
export async function requestOpenAI(request: GenerationRequest): Promise<GenerationResult> {
  const key = process.env.CASELOAD_OPENAI_API_KEY?.trim();
  if (!key) throw new OpenAIRequestError("OpenAI project key missing", 401);
  const timeout = AbortSignal.timeout(45_000);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    cache: "no-store",
    redirect: "error",
    signal,
    body: JSON.stringify({
      model: request.model,
      store: false,
      ...(request.serviceTier && { service_tier: request.serviceTier }),
      instructions: request.instructions,
      input: request.input,
      max_output_tokens: request.maxOutputTokens,
      reasoning: { effort: ["gpt-6-luna", "gpt-6.1-terra"].includes(request.model) ? "none" : "low" },
      ...(request.format && {
        text: { format: { type: "json_schema", strict: true, ...request.format } },
      }),
    }),
  });
  if (!res.ok) throw new OpenAIRequestError(`OpenAI request failed (${res.status})`, res.status);
  const data: ResponsesPayload = await res.json();
  if (data.status !== "completed") throw new OpenAIRequestError("Incomplete OpenAI response", 422);
  const messages = (data.output ?? []).filter(item => item.type === "message");
  if (messages.some(message => message.content?.some(part => part.type === "refusal"))) throw new OpenAIRequestError("OpenAI declined the request", 422);
  const completed = messages.filter(message => !message.status || message.status === "completed");
  const final = completed.filter(message => message.phase === "final_answer").at(-1) ?? completed.at(-1);
  const parts = final?.content ?? [];
  const text = parts.filter(part => part.type === "output_text").map(part => part.text ?? "").join("").trim();
  if (!text) throw new OpenAIRequestError("Empty OpenAI response", 422);
  return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
}
