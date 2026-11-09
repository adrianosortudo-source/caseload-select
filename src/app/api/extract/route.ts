import { NextResponse } from "next/server";
import { llmExtractServer } from "@/lib/screen-llm-server";
import { initialiseState } from "@/lib/screen-engine/extractor";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import { SLOT_REGISTRY } from "@/lib/screen-engine/slotRegistry";
import { llmMapOptionReply } from "@/lib/llm-option-map";
import type { MatterType } from "@/lib/screen-engine/types";

interface ExtractRequest {
  description?: string;
  matter_type?: MatterType;
  already_extracted?: Record<string, string | null>;
  pending_slot_id?: string;
  reply?: string;
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

  const slot = typeof body.pending_slot_id === "string" ? SLOT_REGISTRY.find((item) => item.id === body.pending_slot_id) : undefined;
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  if ((body.pending_slot_id !== undefined || body.reply !== undefined) &&
      (!slot || slot.tier === "contact" || slot.input_type !== "single_select" || !slot.options?.length ||
       !slot.applies_to.includes(state.matter_type) || !reply || reply.length > 4000)) {
    return NextResponse.json({ error: "invalid pending slot or reply" }, { status: 400 });
  }
  const [result, mapped] = await Promise.all([
    llmExtractServer(description, state),
    slot && reply ? llmMapOptionReply({ questionLabel: slot.question, options: slot.options!, reply, language: "en" }) : Promise.resolve(null),
  ]);
  const value = mapped?.value;
  const mapped_answer = slot && value && slot.options?.some((option) => option.value === value)
    ? { slotId: slot.id, value } : undefined;
  return NextResponse.json({ ...result, ...(mapped ? { mapping_mode: mapped.mode } : {}), ...(mapped_answer ? { mapped_answer } : {}) });
}
