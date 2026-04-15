/**
 * POST /api/screen
 *
 * The single endpoint for CaseLoad Screen. Handles every channel:
 * widget, whatsapp, chat, email, phone.
 *
 * Flow:
 * 1. Create or load session from Supabase
 * 2. Append new message to conversation history
 * 3. Build system prompt from firm config
 * 4. Call GPT with system prompt + full conversation history
 * 5. Validate scoring math
 * 6. Persist updated session state
 * 7. On finalize: send GHL webhook
 * 8. Return structured response to adapter
 */

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabase } from "@/lib/supabase";
import { buildSystemPrompt, type FirmConfig } from "@/lib/screen-prompt";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ScreenRequest {
  session_id?: string | null;
  firm_id: string;
  channel: "widget" | "whatsapp" | "chat" | "email" | "phone";
  message: string;
  message_type?: "text" | "answer" | "contact" | "context";
  structured_data?: Record<string, unknown>;
}

interface CpiBreakdown {
  fit_score: number;
  geo_score: number;
  practice_score: number;
  legitimacy_score: number;
  referral_score: number;
  value_score: number;
  urgency_score: number;
  complexity_score: number;
  multi_practice_score: number;
  fee_score: number;
  total: number;
  band: "A" | "B" | "C" | "D" | "E" | null;
  band_locked: boolean;
}

interface ComplexityIndicators {
  contestation_level?: number | null;
  children_involved?: boolean | null;
  special_considerations?: string[];
  prior_refusal_count?: number | null;
  liability_clarity?: number | null;
  treatment_status?: string | null;
  beneficiary_count?: number | null;
  employment_factors?: string[];
  salary_range?: string | null;
  tenure_years?: number | null;
  [key: string]: unknown;
}

interface GptResponse {
  practice_area: string | null;
  practice_area_confidence: "high" | "medium" | "low" | "unknown";
  extracted_entities: Record<string, unknown>;
  questions_answered: string[];
  next_question: {
    id: string;
    text: string;
    options: Array<{ label: string; value: string }>;
    allow_free_text: boolean;
  } | null;
  next_questions: Array<{
    id: string;
    text: string;
    options: Array<{ label: string; value: string }>;
    allow_free_text: boolean;
  }> | null;
  cpi: CpiBreakdown;
  complexity_indicators: ComplexityIndicators | null;
  value_tier: "tier_1" | "tier_2" | "tier_3" | "tier_4" | "tier_5" | null;
  prior_experience: "yes" | "no" | "prior_litigation" | null;
  flags: string[];
  response_text: string;
  finalize: boolean;
  collect_identity: boolean;
  situation_summary: string | null;
}

// ─────────────────────────────────────────────
// Scoring validator — trust components, verify sums
// ─────────────────────────────────────────────
function validateAndFixScoring(cpi: CpiBreakdown): CpiBreakdown {
  // Clamp all components to valid ranges
  cpi.geo_score = Math.min(10, Math.max(0, Math.round(cpi.geo_score ?? 0)));
  cpi.practice_score = Math.min(10, Math.max(0, Math.round(cpi.practice_score ?? 0)));
  cpi.legitimacy_score = Math.min(10, Math.max(0, Math.round(cpi.legitimacy_score ?? 0)));
  cpi.referral_score = Math.min(10, Math.max(0, Math.round(cpi.referral_score ?? 0)));
  cpi.urgency_score = Math.min(20, Math.max(0, Math.round(cpi.urgency_score ?? 0)));
  cpi.complexity_score = Math.min(25, Math.max(0, Math.round(cpi.complexity_score ?? 0)));
  cpi.multi_practice_score = Math.min(5, Math.max(0, Math.round(cpi.multi_practice_score ?? 0)));
  cpi.fee_score = Math.min(10, Math.max(0, Math.round(cpi.fee_score ?? 0)));

  // Warn if value score is all-zero despite a detected practice area (likely a scoring miss)
  if (cpi.practice_score > 0 && cpi.complexity_score === 0 && cpi.fee_score === 0) {
    console.warn("[screen] Value score suspiciously low — GPT may not have applied inference scoring. complexity:", cpi.complexity_score, "fee:", cpi.fee_score);
  }

  // Recompute sums from components
  cpi.fit_score = cpi.geo_score + cpi.practice_score + cpi.legitimacy_score + cpi.referral_score;
  cpi.value_score = cpi.urgency_score + cpi.complexity_score + cpi.multi_practice_score + cpi.fee_score;
  cpi.total = cpi.fit_score + cpi.value_score;

  // Assign band
  if (cpi.total >= 80) cpi.band = "A";
  else if (cpi.total >= 60) cpi.band = "B";
  else if (cpi.total >= 40) cpi.band = "C";
  else if (cpi.total >= 20) cpi.band = "D";
  else cpi.band = "E";

  return cpi;
}

// ─────────────────────────────────────────────
// GHL webhook delivery
// ─────────────────────────────────────────────
async function sendToGHL(session: Record<string, unknown>, ghlWebhookUrl: string): Promise<void> {
  const contact = (session.contact as Record<string, unknown>) ?? {};
  const scoring = (session.scoring as CpiBreakdown) ?? {};
  const entities = (session.extracted_entities as Record<string, unknown>) ?? {};

  const bandToCta: Record<string, string> = {
    A: "A lawyer from our team will contact you shortly. Book a same-day consultation.",
    B: "We'll call you within the hour. Pick a consultation time.",
    C: "Book a consultation at your convenience.",
    D: "Here is information relevant to your situation. We'll follow up within the week.",
    E: "Based on what you've shared, this may fall outside our practice areas. Here are other resources that may help.",
  };

  const bandToLeadState: Record<string, string> = {
    A: "04_decision_ready",
    B: "04_decision_ready",
    C: "03_solution_aware",
    D: "02_problem_aware",
    E: "01_unaware",
  };

  const bandToStage: Record<string, string> = {
    A: "hot_lead",
    B: "warm_lead",
    C: "qualified",
    D: "nurture",
    E: "declined",
  };

  const bandToSLA: Record<string, number> = {
    A: 30,
    B: 60,
    C: 1440,
    D: 10080,
    E: 0,
  };

  const band = scoring.band ?? "E";

  const payload = {
    contact: {
      first_name: contact.first_name ?? null,
      last_name: contact.last_name ?? null,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      tags: [
        "intake-v3",
        `practice:${(session.practice_area as string ?? "unknown").toLowerCase().replace(/\s+/g, "_")}`,
        `band:${band}`,
        `channel:${session.channel}`,
        session.otp_verified ? "verified" : "unverified",
      ],
    },
    custom_fields: {
      cpi_score: scoring.total ?? 0,
      cpi_band: band,
      practice_area: session.practice_area ?? null,
      situation_summary: entities.situation_summary ?? null,
      urgency: entities.urgency ?? null,
      lead_state: bandToLeadState[band] ?? "01_unaware",
      value_tier: entities.value_tier ?? null,
      prior_experience: entities.prior_experience ?? null,
      emp_termination_type: entities.emp_termination_type ?? null,
      emp_tenure: entities.emp_tenure ?? null,
      emp_severance_received: entities.emp_severance_received ?? null,
    },
    pipeline: {
      stage: bandToStage[band] ?? "new_lead",
      sla_minutes: bandToSLA[band] ?? 0,
    },
    session_id: session.id,
  };

  await fetch(ghlWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ─────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ScreenRequest;
    const { session_id, firm_id, channel, message, message_type = "text", structured_data } = body;

    if (!firm_id) {
      return NextResponse.json({ error: "firm_id required" }, { status: 400 });
    }
    if (!message && !structured_data) {
      return NextResponse.json({ error: "message or structured_data required" }, { status: 400 });
    }

    // ── Load firm config + session in parallel ────────────────────────
    const sessionPromise = session_id
      ? supabase.from("intake_sessions").select("*").eq("id", session_id).single()
      : supabase.from("intake_sessions").insert({ firm_id, channel, status: "in_progress" }).select().single();

    const [firmResult, sessionResult] = await Promise.all([
      supabase.from("intake_firms").select("*").eq("id", firm_id).single(),
      sessionPromise,
    ]);

    if (firmResult.error || !firmResult.data) {
      return NextResponse.json({ error: "Firm not found" }, { status: 404 });
    }
    if (sessionResult.error || !sessionResult.data) {
      return NextResponse.json({ error: session_id ? "Session not found" : "Failed to create session" }, { status: session_id ? 404 : 500 });
    }

    const firm = firmResult.data;
    const session = sessionResult.data as Record<string, unknown>;

    const firmConfig: FirmConfig = {
      name: firm.name,
      description: firm.description ?? "",
      location: firm.location ?? "",
      practice_areas: firm.practice_areas,
      question_sets: firm.question_sets,
      geographic_config: firm.geographic_config,
      custom_instructions: firm.custom_instructions ?? undefined,
    };

    // ── Accumulate confirmed answers (widget structured_data, keyed by question ID) ──
    // These are authoritative — stored separately from GPT-extracted entities so
    // they always use the exact question IDs from the firm config, regardless of
    // whether GPT correctly extracts them.
    const existingConfirmed = ((session.scoring as Record<string, unknown>)?._confirmed as Record<string, unknown>) ?? {};
    const updatedConfirmed: Record<string, unknown> = { ...existingConfirmed };
    if (message_type === "answer" && structured_data) {
      Object.assign(updatedConfirmed, structured_data);
    }

    // ── Build message content for GPT ────────────────────────────────
    const userContent = structured_data
      ? `[${message_type?.toUpperCase()}] ${message}\nStructured data: ${JSON.stringify(structured_data)}`
      : message;

    // ── Append user message to conversation history ──────────────────
    const conversation = (session.conversation as Array<{ role: string; content: string }>) ?? [];
    conversation.push({ role: "user", content: userContent });

    // ── Fast path: skip GPT for contact submission when band is already set ──
    // After widget question answers are confirmed, the practice area and initial
    // band are already known. Sending contact to GPT risks mis-classification
    // (GPT re-reads the full conversation and can return a wrong practice area).
    // When a band is already assigned, finalize using the stored scoring.
    const existingBand = session.band as string | null;
    const existingCpiForContact = (session.scoring as CpiBreakdown & { _confirmed?: Record<string, unknown> }) ?? {} as CpiBreakdown;
    if (
      channel === "widget" &&
      message_type === "contact" &&
      structured_data &&
      session.practice_area &&
      existingBand &&
      ["A", "B", "C", "D", "E"].includes(existingBand)
    ) {
      // Persist contact + finalize
      const existingContact = (session.contact as Record<string, unknown>) ?? {};
      const contact: Record<string, unknown> = { ...existingContact };
      if (structured_data.first_name !== undefined) contact.first_name = structured_data.first_name;
      if (structured_data.last_name !== undefined) contact.last_name = structured_data.last_name;
      if (structured_data.email !== undefined) contact.email = structured_data.email;
      if (structured_data.phone !== undefined) contact.phone = structured_data.phone;

      await supabase
        .from("intake_sessions")
        .update({ contact, status: "complete" })
        .eq("id", session.id);

      const bandToCta: Record<string, string> = {
        A: "A lawyer from our team will contact you shortly. Book a same-day consultation.",
        B: "We'll call you within the hour. Pick a consultation time.",
        C: "Book a consultation at your convenience.",
        D: "Here is information relevant to your situation. We'll follow up within the week.",
        E: "Based on what you've shared, this may fall outside our practice areas. Here are other resources that may help.",
      };

      return NextResponse.json({
        session_id: session.id,
        practice_area: session.practice_area,
        practice_area_confidence: "high",
        next_question: null,
        next_questions: null,
        cpi: existingCpiForContact,
        response_text: bandToCta[existingBand] ?? "",
        finalize: true,
        collect_identity: false,
        situation_summary: (session.situation_summary as string) ?? null,
        extracted_entities: (session.extracted_entities as Record<string, unknown>) ?? {},
        questions_answered: Object.keys(updatedConfirmed),
        complexity_indicators: (session.complexity_indicators as Record<string, unknown>) ?? null,
        value_tier: (session.value_tier as string) ?? null,
        prior_experience: (session.prior_experience as string) ?? null,
        flags: (session.flags as string[]) ?? [],
        cta: bandToCta[existingBand] ?? null,
      });
    }

    // ── Fast path: skip GPT for structured widget answers ────────────
    // Once the practice area is classified, button-tap answers don't need GPT.
    // The server-side queue already knows which questions remain. GPT is only
    // needed for: (1) first message (classification), (2) free-text input,
    // (3) contact/finalization. This eliminates ~80% of GPT calls in the widget.
    if (
      channel === "widget" &&
      message_type === "answer" &&
      structured_data &&
      session.practice_area
    ) {
      const paId = session.practice_area as string;
      const questionSet =
        firmConfig.question_sets[paId] ??
        Object.values(firmConfig.question_sets).find(qs =>
          qs.practice_area_id === paId ||
          qs.practice_area_id.toLowerCase() === paId.toLowerCase() ||
          firmConfig.practice_areas.find(a => a.id === qs.practice_area_id)?.label.toLowerCase() === paId.toLowerCase()
        ) ??
        null;

      if (questionSet != null) {
        const remaining = questionSet.questions.filter(q => !(q.id in updatedConfirmed));
        const collectIdentity = remaining.length === 0;
        const existingCpi = (session.scoring as CpiBreakdown & { _confirmed?: Record<string, unknown> }) ?? {} as CpiBreakdown;

        // Save confirmed answers only — no conversation update, no GPT
        await supabase
          .from("intake_sessions")
          .update({ scoring: { ...existingCpi, _confirmed: updatedConfirmed } })
          .eq("id", session.id);

        return NextResponse.json({
          session_id: session.id,
          practice_area: session.practice_area,
          practice_area_confidence: "high",
          next_question: null,
          next_questions: collectIdentity ? null : remaining.map(q => ({
            id: q.id,
            text: q.text,
            options: q.options.map(o => ({ label: o.label, value: o.value })),
            allow_free_text: q.allow_free_text ?? false,
          })),
          cpi: existingCpi,
          response_text: "",
          finalize: false,
          collect_identity: collectIdentity,
          situation_summary: (session.situation_summary as string) ?? null,
          extracted_entities: (session.extracted_entities as Record<string, unknown>) ?? {},
          questions_answered: Object.keys(updatedConfirmed),
          complexity_indicators: (session.complexity_indicators as Record<string, unknown>) ?? null,
          value_tier: (session.value_tier as string) ?? null,
          prior_experience: (session.prior_experience as string) ?? null,
          flags: (session.flags as string[]) ?? [],
          cta: null,
        });
      }
    }

    // ── Build system prompt ───────────────────────────────────────────
    // Widget: server-side queue, never include question sets in prompt.
    // WhatsApp / SMS / chat (first call): no practice area known yet → slim prompt for
    //   classification only. ~5K tokens instead of ~50K → ~80% latency reduction.
    // WhatsApp / SMS / chat (subsequent calls): inject ONLY the single relevant practice
    //   area's question set (~1K tokens) so GPT knows what to ask next.
    const sessionPracticeArea = session.practice_area as string | null;
    let promptFirmConfig = firmConfig;
    let includeQuestionSets = false;

    if (channel !== "widget") {
      if (sessionPracticeArea && firmConfig.question_sets[sessionPracticeArea]) {
        // Known practice area: inject only that area's questions
        promptFirmConfig = {
          ...firmConfig,
          question_sets: { [sessionPracticeArea]: firmConfig.question_sets[sessionPracticeArea] },
        };
        includeQuestionSets = true;
      }
      // else: first call — no questions, classification-only prompt
    }

    let systemPrompt = buildSystemPrompt(promptFirmConfig, channel, { includeQuestionSets });

    // Inject confirmed answers into system prompt so GPT never re-asks.
    // Uses question IDs from structured_data (100% reliable) merged with GPT-extracted entities.
    const existingEntities = (session.extracted_entities as Record<string, unknown>) ?? {};
    const allCollected = { ...existingEntities, ...updatedConfirmed };
    if (Object.keys(allCollected).length > 0) {
      const lines = Object.entries(allCollected)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join("\n");
      systemPrompt +=
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
        `\nSESSION STATE — CONFIRMED ANSWERS (MUST NOT ask again)\n` +
        lines +
        `\n\nThese are the client's confirmed answers for this session. Do NOT include any question whose id or subject matches a key above in next_question or next_questions. Apply all scoring deltas for these values immediately.`;
    }

    // ── For conversational channels: tell GPT exactly which question to ask next ──
    // This prevents GPT from picking questions arbitrarily and eliminates repeats.
    if (channel !== "widget" && sessionPracticeArea) {
      const qs =
        promptFirmConfig.question_sets[sessionPracticeArea] ??
        Object.values(promptFirmConfig.question_sets).find(q => q.practice_area_id === sessionPracticeArea) ??
        null;

      if (qs) {
        const nextQ = qs.questions.find(q => !(q.id in allCollected));
        if (nextQ) {
          const opts = nextQ.options.map(o => o.label).join(" | ");
          systemPrompt +=
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            `\nNEXT QUESTION TO ASK (server-assigned)\n` +
            `Ask this question conversationally in response_text:\n` +
            `ID: ${nextQ.id}\nQuestion: ${nextQ.text}\nOptions: ${opts}\n\n` +
            `Set next_question.id = "${nextQ.id}", next_question.text = "${nextQ.text}", ` +
            `next_question.options from above. Do NOT ask any other questions.`;
        } else {
          // All questions answered
          systemPrompt +=
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            `\nAll intake questions for this matter have been answered. Set collect_identity = true in your response.`;
        }
      }
    }

    // ── Call GPT ──────────────────────────────────────────────────────
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0, // deterministic scoring
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        ...conversation.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      ],
    });

    const rawResponse = completion.choices[0]?.message?.content;
    if (!rawResponse) {
      return NextResponse.json({ error: "No response from GPT" }, { status: 500 });
    }

    let gptResponse: GptResponse;
    try {
      gptResponse = JSON.parse(rawResponse);
    } catch {
      return NextResponse.json({ error: "GPT returned invalid JSON", raw: rawResponse }, { status: 500 });
    }

    // ── Validate + fix scoring ────────────────────────────────────────
    gptResponse.cpi = validateAndFixScoring(gptResponse.cpi);

    // ── Out-of-scope gate ─────────────────────────────────────────────
    // If the identified practice area is marked out_of_scope in the firm config,
    // finalize immediately with Band E — do not collect identity or ask questions.
    if (gptResponse.practice_area && !gptResponse.finalize) {
      const paConfig = firmConfig.practice_areas.find(
        (a) =>
          a.id === gptResponse.practice_area ||
          a.label.toLowerCase() === (gptResponse.practice_area ?? "").toLowerCase()
      );
      if (paConfig?.classification === "out_of_scope") {
        gptResponse.finalize = true;
        gptResponse.collect_identity = false;
        gptResponse.next_question = null;
        gptResponse.next_questions = null;
        gptResponse.cpi.band = "E";
        gptResponse.cpi.total = Math.min(gptResponse.cpi.total, 15);
        gptResponse.response_text =
          "Based on what you've shared, this may fall outside our current practice areas. Here are some other resources that may help.";
      }
    }

    // ── Widget mode: server-side question queue management ────────────
    // GPT-4o-mini is unreliable at returning all questions at once and at skipping
    // already-answered questions. We override next_questions directly from the firm
    // config, filtered by confirmed_answers. This eliminates cycling entirely.
    if (channel === "widget" && !gptResponse.finalize && !gptResponse.collect_identity) {
      const paId = gptResponse.practice_area;
      // Find matching question set (by direct key, practice_area_id, or label)
      let questionSet = paId ? firmConfig.question_sets[paId] : null;
      if (!questionSet && paId) {
        questionSet = Object.values(firmConfig.question_sets).find(qs =>
          qs.practice_area_id === paId ||
          qs.practice_area_id.toLowerCase() === paId.toLowerCase() ||
          firmConfig.practice_areas.find(a => a.id === qs.practice_area_id)?.label.toLowerCase() === paId.toLowerCase()
        ) ?? null;
      }
      if (questionSet) {
        // Filter out questions that are already in confirmed_answers
        const remaining = questionSet.questions.filter(q => !(q.id in updatedConfirmed));
        if (remaining.length > 0) {
          gptResponse.next_questions = remaining.map(q => ({
            id: q.id,
            text: q.text,
            options: q.options.map(o => ({ label: o.label, value: o.value })),
            allow_free_text: q.allow_free_text ?? false,
          }));
          gptResponse.next_question = null;
        } else {
          // All questions answered — move to identity collection
          gptResponse.next_questions = null;
          gptResponse.next_question = null;
          if (!gptResponse.collect_identity) {
            gptResponse.collect_identity = true;
          }
        }
      } else if (gptResponse.next_question) {
        // Fallback: promote single next_question to next_questions array
        gptResponse.next_questions = [gptResponse.next_question];
        gptResponse.next_question = null;
      }
    }

    // ── Append GPT response to conversation ──────────────────────────
    conversation.push({ role: "assistant", content: rawResponse });

    // ── Build updated session state ──────────────────────────────────
    // extracted_entities: structured key-value pairs only (question IDs + values)
    // situation_summary is stored separately at the session level, not merged here
    const updatedEntities = {
      ...(session.extracted_entities as Record<string, unknown> ?? {}),
      ...gptResponse.extracted_entities,
    };
    // Remove situation_summary if GPT accidentally placed it inside extracted_entities
    delete updatedEntities.situation_summary;

    // ── Persist contact details when provided ────────────────────────
    // structured_data for message_type "contact" carries first_name, last_name,
    // email, phone. These must be written to intake_sessions.contact explicitly —
    // GPT only sees them as conversation text and does not write them back.
    const contactUpdate: Record<string, unknown> = {};
    if (message_type === "contact" && structured_data) {
      const existingContact = (session.contact as Record<string, unknown>) ?? {};
      const merged: Record<string, unknown> = { ...existingContact };
      if (structured_data.first_name !== undefined) merged.first_name = structured_data.first_name;
      if (structured_data.last_name !== undefined) merged.last_name = structured_data.last_name;
      if (structured_data.email !== undefined) merged.email = structured_data.email;
      if (structured_data.phone !== undefined) merged.phone = structured_data.phone;
      contactUpdate.contact = merged;
    }

    const sessionUpdate: Record<string, unknown> = {
      conversation,
      scoring: { ...gptResponse.cpi, _confirmed: updatedConfirmed },
      extracted_entities: updatedEntities,
      practice_area: gptResponse.practice_area,
      band: gptResponse.cpi.band,
      ...contactUpdate,
      ...(gptResponse.situation_summary ? { situation_summary: gptResponse.situation_summary } : {}),
      ...(gptResponse.complexity_indicators ? { complexity_indicators: gptResponse.complexity_indicators } : {}),
      ...(gptResponse.value_tier ? { value_tier: gptResponse.value_tier } : {}),
      ...(gptResponse.prior_experience ? { prior_experience: gptResponse.prior_experience } : {}),
      ...(gptResponse.flags?.length ? { flags: gptResponse.flags } : {}),
    };

    if (gptResponse.finalize) {
      sessionUpdate.status = "complete";
    }

    // ── Persist to Supabase ───────────────────────────────────────────
    await supabase
      .from("intake_sessions")
      .update(sessionUpdate)
      .eq("id", session.id);

    // ── GHL delivery on finalize ──────────────────────────────────────
    if (gptResponse.finalize && firm.ghl_webhook_url) {
      const finalSession = { ...session, ...sessionUpdate };
      try {
        await sendToGHL(finalSession, firm.ghl_webhook_url);
        await supabase
          .from("intake_sessions")
          .update({ crm_synced: true })
          .eq("id", session.id);
      } catch (err) {
        console.error("GHL delivery failed:", err);
        // Non-fatal — session is saved, lead is not lost
      }
    }

    // ── Compute CTA from band (returned on finalize) ─────────────────
    const bandToCta: Record<string, string> = {
      A: "A lawyer from our team will contact you shortly. Book a same-day consultation.",
      B: "We'll call you within the hour. Pick a consultation time.",
      C: "Book a consultation at your convenience.",
      D: "Here is information relevant to your situation. We'll follow up within the week.",
      E: "Based on what you've shared, this may fall outside our practice areas. Here are other resources that may help.",
    };
    const cta = gptResponse.finalize ? (bandToCta[gptResponse.cpi.band ?? "E"] ?? null) : null;

    // ── Return response ───────────────────────────────────────────────
    return NextResponse.json({
      session_id: session.id,
      practice_area: gptResponse.practice_area,
      practice_area_confidence: gptResponse.practice_area_confidence,
      next_question: gptResponse.next_question,
      next_questions: gptResponse.next_questions,
      cpi: gptResponse.cpi,
      response_text: gptResponse.response_text,
      finalize: gptResponse.finalize,
      collect_identity: gptResponse.collect_identity,
      situation_summary: gptResponse.situation_summary,
      extracted_entities: updatedEntities,
      questions_answered: gptResponse.questions_answered,
      complexity_indicators: gptResponse.complexity_indicators,
      value_tier: gptResponse.value_tier,
      prior_experience: gptResponse.prior_experience,
      flags: gptResponse.flags,
      cta,
    });
  } catch (err) {
    console.error("/api/screen error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
