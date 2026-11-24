import { NextResponse } from "next/server";
import { intakeModel, type IntakeProvider } from "@/lib/ai/intake-generation";
import { publicToolPilotModel, requestPublicToolOpenAI } from "@/lib/ai/public-tool-pilot-budget";
import { startPilotMetrics } from "@/lib/ai/public-pilot-metrics";
import { llmExtractServer } from "@/lib/screen-llm-server";
import { initialiseState } from "@/lib/screen-engine/extractor";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import { familyNegativeIsGrounded } from "@/lib/screen-engine/llm/extractor";
import { SLOT_REGISTRY } from "@/lib/screen-engine/slotRegistry";
import { llmMapOptionReply } from "@/lib/llm-option-map";
import type { MatterType } from "@/lib/screen-engine/types";

interface ExtractRequest {
  description?: string;
  matter_type?: MatterType;
  family_enabled?: boolean;
  already_extracted?: Record<string, string | null>;
  pending_slot_id?: string;
  pending_question?: string;
  reply?: string;
}

// Reject oversized descriptions explicitly before forwarding the complete accepted text.
const MAX_DESCRIPTION_CHARS = 16_000;

export async function handleScreenExtraction(req: Request, provider: IntakeProvider, surface?: "public-demo") {
  const started = Date.now();
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
    family_enabled: body.family_enabled === true,
    slots: body.already_extracted ?? {},
  };

  const slot = typeof body.pending_slot_id === "string" ? SLOT_REGISTRY.find((item) => item.id === body.pending_slot_id) : undefined;
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  const clarification = body.pending_slot_id === "__clarify__";
  const hasFollowUp = body.pending_slot_id !== undefined || body.reply !== undefined;
  const dynamicSlot = slot?.id === "intake_detail_1" || slot?.id === "intake_detail_2";
  const question = dynamicSlot && typeof body.pending_question === "string" ? body.pending_question.trim() : undefined;
  if (body.pending_question !== undefined && (!question || question.length > 260 || /[<>\n\r]|https?:\/\//i.test(question))) {
    return NextResponse.json({ error: "invalid pending question" }, { status: 400 });
  }
  if (hasFollowUp && (!reply || reply.length > 4000 ||
      (!clarification && (!slot || slot.tier === "contact" ||
       (slot.applies_to.length > 0 && !slot.applies_to.includes(state.matter_type)))))) {
    return NextResponse.json({ error: "invalid pending slot or reply" }, { status: 400 });
  }
  const metrics = surface === "public-demo" ? startPilotMetrics("screen-demo", provider, started) : undefined;
  const channel = surface === "public-demo" ? { model: publicToolPilotModel, request: requestPublicToolOpenAI } : undefined;
  metrics?.attempt(provider);
  const [result, mapped] = await Promise.all([
    llmExtractServer(description, state, MAX_DESCRIPTION_CHARS, provider, channel,
      surface === "public-demo" ? undefined : hasFollowUp ? { reply, slotId: body.pending_slot_id, question } : {}),
    slot?.input_type === "single_select" && slot.options?.length && reply ? llmMapOptionReply({ questionLabel: slot.question, options: slot.options!, reply, language: "en" }, provider, channel) : Promise.resolve(null),
  ]).catch(error => { metrics?.finish("failed"); throw error; });
  metrics?.finish(result.mode === "live" && (!mapped || mapped.mode === "live") ? "completed" : "degraded");
  const value = mapped?.value;
  const compositeNegativeGrounded = slot?.id !== "family_existing_order" || value !== "Neither" ||
    /^neither[.!\s]*$/i.test(reply) || familyNegativeIsGrounded(slot.id, value, `${description}\n${reply}`);
  const mapped_answer = slot && value && compositeNegativeGrounded && slot.options?.some((option) => option.value === value)
    ? { slotId: slot.id, value } : undefined;
  const model = provider === "openai" ? channel?.model ?? intakeModel() : "gemini-2.5-flash";
  return NextResponse.json({ ...result, provider, model, ...(mapped ? { mapping_mode: mapped.mode } : {}), ...(mapped_answer ? { mapped_answer } : {}) });
}
