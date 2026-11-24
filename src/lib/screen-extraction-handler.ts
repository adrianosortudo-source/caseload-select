import { NextResponse } from "next/server";
import { intakeModel, type IntakeProvider } from "@/lib/ai/intake-generation";
import { publicToolPilotModel, requestPublicToolOpenAI } from "@/lib/ai/public-tool-pilot-budget";
import { startPilotMetrics } from "@/lib/ai/public-pilot-metrics";
import { llmExtractServer } from "@/lib/screen-llm-server";
import { initialiseState, isValidMatterType } from "@/lib/screen-engine/extractor";
import { checkRateLimit, ipFromRequest, rateLimitHeaders } from "@/lib/rate-limit";
import { familyNegativeIsGrounded } from "@/lib/screen-engine/llm/extractor";
import { SLOT_REGISTRY } from "@/lib/screen-engine/slotRegistry";
import { llmMapOptionReply } from "@/lib/llm-option-map";
import { admitScreenQuestionPolicy } from "@/lib/screen-question-policy-admission";
import { fictionalIntakeCriteria, readFirmIntakeCriteria } from "@/lib/screen-firm-context";
import type { MatterType } from "@/lib/screen-engine/types";

interface ExtractRequest {
  description?: string;
  matter_type?: MatterType;
  family_enabled?: boolean;
  already_extracted?: Record<string, string | null>;
  pending_slot_id?: string;
  pending_question?: string;
  reply?: string;
  question_policy?: unknown;
  conversation?: unknown;
  review_context?: unknown;
  review_question?: unknown;
  review_skipped?: unknown;
  firm_criteria_token?: unknown;
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

  const hasFollowUp = body.pending_slot_id !== undefined || body.reply !== undefined;
  const questionPolicy = surface === undefined ? admitScreenQuestionPolicy(body.question_policy, hasFollowUp) : undefined;
  const firmCriteria = questionPolicy && body.firm_criteria_token === 'fictional-preview'
    ? fictionalIntakeCriteria
    : questionPolicy && typeof body.firm_criteria_token === 'string'
      ? await readFirmIntakeCriteria(body.firm_criteria_token) : undefined;
  // Conversation content is untrusted visitor data. Bound it before passing it
  // to the model and preserve question text and each visitor reply separately.
  let conversation: { turns: { text: string; question?: string; answersQuestion?: boolean; skipped?: boolean; correction: boolean }[]; asked: { id: string; answer: string | null }[]; priorRequests: { quote: string; matter: string }[]; priorWithdrawals: { request_quote: string; request_matter: string; withdrawal_quote: string }[] } | undefined;
  if (questionPolicy && body.conversation !== undefined) {
    const supplied = body.conversation as { turns?: unknown; asked?: unknown; priorRequests?: unknown; priorWithdrawals?: unknown } | null;
    if (!supplied || !Array.isArray(supplied.turns) || !Array.isArray(supplied.asked)
        || supplied.turns.length > 50 || supplied.asked.length > 50) {
      return NextResponse.json({ error: 'invalid conversation' }, { status: 400 });
    }
    const turns = supplied.turns as Array<{ text?: unknown; question?: unknown; answersQuestion?: unknown; skipped?: unknown; correction?: unknown }>;
    const asked = supplied.asked as Array<{ id?: unknown; answer?: unknown }>;
    const priorRequests = supplied.priorRequests === undefined ? [] : supplied.priorRequests;
    const priorWithdrawals = supplied.priorWithdrawals === undefined ? [] : supplied.priorWithdrawals;
    if (!Array.isArray(priorRequests) || priorRequests.length > 50 || priorRequests.some(item =>
      !item || typeof item !== 'object' || typeof item.quote !== 'string' || item.quote.length > 1200
      || typeof item.matter !== 'string' || item.matter.length > 100)) {
      return NextResponse.json({ error: 'invalid conversation' }, { status: 400 });
    }
    if (!Array.isArray(priorWithdrawals) || priorWithdrawals.length > 50 || priorWithdrawals.some(item =>
      !item || typeof item !== 'object' || typeof item.request_quote !== 'string' || item.request_quote.length > 1200
      || typeof item.request_matter !== 'string' || item.request_matter.length > 100
      || typeof item.withdrawal_quote !== 'string' || item.withdrawal_quote.length > 1200)) {
      return NextResponse.json({ error: 'invalid conversation' }, { status: 400 });
    }
    if (turns.some(turn => !turn || typeof turn.text !== 'string' || turn.text.length > 4000
        || (turn.question !== undefined && (typeof turn.question !== 'string' || turn.question.length > 260)))
        || asked.some(item => !item || typeof item.id !== 'string' || item.id.length > 100
          || !(item.answer === null || typeof item.answer === 'string' && item.answer.length <= 4000))
        || JSON.stringify(supplied).length > 512000) {
      return NextResponse.json({ error: 'invalid conversation' }, { status: 400 });
    }
    conversation = {
      turns: turns.map(turn => ({ text: turn.text as string, ...(turn.question ? { question: turn.question as string } : {}), ...(typeof turn.answersQuestion === 'boolean' ? { answersQuestion: turn.answersQuestion } : {}), ...(typeof turn.skipped === 'boolean' ? { skipped: turn.skipped } : {}), correction: turn.correction === true })),
      asked: asked.map(item => ({ id: item.id as string, answer: item.answer as string | null })),
      priorRequests: priorRequests.map(item => ({ quote: item.quote, matter: item.matter })),
      priorWithdrawals: priorWithdrawals.map(item => ({ request_quote: item.request_quote, request_matter: item.request_matter, withdrawal_quote: item.withdrawal_quote })),
    };
  }
  const reviewContext = questionPolicy && !hasFollowUp && body.review_context && typeof body.review_context === 'object'
    ? body.review_context as { matter_type?: unknown; already_extracted?: unknown } : undefined;
  if (reviewContext && (!(reviewContext.matter_type === 'family_general' || reviewContext.matter_type === 'unknown'
      || typeof reviewContext.matter_type === 'string' && isValidMatterType(reviewContext.matter_type))
      || !reviewContext.already_extracted || typeof reviewContext.already_extracted !== 'object'
      || Array.isArray(reviewContext.already_extracted))) {
    return NextResponse.json({ error: 'invalid review context' }, { status: 400 });
  }
  const state = {
    ...initialiseState(description),
    matter_type: (reviewContext?.matter_type as MatterType | undefined) ?? body.matter_type ?? "unknown",
    family_enabled: body.family_enabled === true,
    slots: (reviewContext?.already_extracted as Record<string, string | null> | undefined) ?? body.already_extracted ?? {},
    ...(questionPolicy ? { question_policy: questionPolicy } : {}),
    ...(conversation ? { intake_reading: { turns: conversation.turns }, questionHistory: conversation.asked.map(item => item.id) } : {}),
  };

  const slot = typeof body.pending_slot_id === "string" ? SLOT_REGISTRY.find((item) => item.id === body.pending_slot_id) : undefined;
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  const clarification = body.pending_slot_id === "__clarify__";
  const questionValue = questionPolicy && body.review_question !== undefined ? body.review_question : body.pending_question;
  const question = typeof questionValue === "string" ? questionValue.trim() : undefined;
  if (questionValue !== undefined && (!question || question.length > 260 || /[<>\n\r]|https?:\/\//i.test(question))) {
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
      surface === "public-demo" ? undefined : hasFollowUp ? { reply, slotId: body.pending_slot_id, question, skipped: questionPolicy && body.review_skipped === true, asked: conversation?.asked, priorRequests: conversation?.priorRequests, priorWithdrawals: conversation?.priorWithdrawals, firmCriteria } : { asked: conversation?.asked, priorRequests: conversation?.priorRequests, priorWithdrawals: conversation?.priorWithdrawals, firmCriteria }),
    slot?.input_type === "single_select" && slot.options?.length && reply &&
      !(questionPolicy && (reply === 'Not sure' || slot.options.some(option => option.value === reply || option.label === reply)))
      ? llmMapOptionReply({ questionLabel: slot.question, options: slot.options!, reply, language: "en" }, provider, channel) : Promise.resolve(null),
  ]).catch(error => { metrics?.finish("failed"); throw error; });
  metrics?.finish(result.mode === "live" && (!mapped || mapped.mode === "live") ? "completed" : "degraded");
  const value = mapped?.value;
  const compositeNegativeGrounded = slot?.id !== "family_existing_order" || value !== "Neither" ||
    /^neither[.!\s]*$/i.test(reply) || familyNegativeIsGrounded(slot.id, value, `${description}\n${reply}`);
  const mapped_answer = slot && value && compositeNegativeGrounded && slot.options?.some((option) => option.value === value)
    ? { slotId: slot.id, value } : undefined;
  const model = provider === "openai" ? channel?.model ?? intakeModel() : "gemini-2.5-flash";
  return NextResponse.json({ ...result, provider, model, ...(questionPolicy ? { question_policy: questionPolicy } : {}),
    ...(mapped ? { mapping_mode: mapped.mode } : {}), ...(mapped_answer ? { mapped_answer } : {}) });
}
