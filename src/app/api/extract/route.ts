import { NextResponse } from "next/server";
import { llmExtractServer } from "@/lib/screen-llm-server";
import { initialiseState } from "@/lib/screen-engine/extractor";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import type { MatterType } from "@/lib/screen-engine/types";

interface ExtractRequest {
  description?: string;
  matter_type?: MatterType;
  already_extracted?: Record<string, string | null>;
}

// llmExtractServer slices the description to 4,000 chars before the Gemini
// call; 4x that bound is abuse, not verbosity. The check runs after
// req.json() has already parsed the body, so it does not save the parse;
// it stops oversized text from being proxied to Gemini.
const MAX_DESCRIPTION_CHARS = 16_000;

export async function POST(req: Request) {
  // Public route (the browser widget calls it, no auth possible); the
  // per-IP bucket is the only gate in front of the Gemini spend (H6).
  const ip = ipFromRequest(req);
  const rl = await checkRateLimit("extract", ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate limited", retry_after_seconds: Math.ceil((rl.reset - Date.now()) / 1000) },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  let body: ExtractRequest;
  try {
    body = (await req.json()) as ExtractRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const description = typeof body.description === "string" ? body.description : "";
  if (!description.trim()) {
    return NextResponse.json({ extracted: {}, mode: "disabled", reason: "empty description" });
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    return NextResponse.json({ error: "description too long" }, { status: 413 });
  }

  const state = {
    ...initialiseState(description),
    matter_type: body.matter_type ?? "unknown",
    slots: body.already_extracted ?? {},
  };

  const result = await llmExtractServer(description, state);
  return NextResponse.json(result);
}
