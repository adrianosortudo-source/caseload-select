import { getProvider, hasOpenAIKey } from "@/lib/ai/openai";
import { handleScreenExtraction } from "@/lib/screen-extraction-handler";

function demoConfig() {
  const provider = getProvider("SCREEN_DEMO_AI_PROVIDER");
  const available = provider === "openai" ? hasOpenAIKey() : Boolean(process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY);
  return { provider, available };
}

// No intake data is sent when the demo loads its provider disclosure.
export async function GET() {
  return Response.json(demoConfig(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const { provider, available } = demoConfig();
  if (!available || req.headers.get("X-Screen-Demo-Provider") !== provider) {
    return Response.json({ mode: "disabled", extracted: {}, reason: "Refresh the demo to check the live AI provider." }, { status: 409 });
  }
  return handleScreenExtraction(req, provider);
}
