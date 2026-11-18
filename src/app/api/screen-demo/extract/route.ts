import { hasOpenAIKey } from "@/lib/ai/openai";
import { publicToolProvider } from "@/lib/ai/public-tool-rollout";
import { publicPilotSession } from "@/lib/ai/public-tool-session";
import { handleScreenExtraction } from "@/lib/screen-extraction-handler";

function demoConfig(req: Request) {
  const provider = publicToolProvider("SCREEN_DEMO_AI_PROVIDER", "SCREEN_DEMO_AI_OPENAI_PERCENT", publicPilotSession(req.headers));
  const available = provider === "openai" ? hasOpenAIKey() : Boolean(process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY);
  return { provider, available };
}

// No intake data is sent when the demo loads its provider disclosure.
export async function GET(req: Request) {
  return Response.json(demoConfig(req), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const { provider, available } = demoConfig(req);
  if (!available || req.headers.get("X-Screen-Demo-Provider") !== provider) {
    return Response.json({ mode: "disabled", extracted: {}, reason: "Refresh the demo to check the live AI provider." }, { status: 409 });
  }
  return handleScreenExtraction(req, provider, "public-demo");
}
