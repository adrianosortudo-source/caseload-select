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
import { getSlotSchema } from "@/lib/slot-schema";
import { selectNextQuestions } from "@/lib/question-selector";
import { resolveSubType, detectSubType } from "@/lib/sub-type-detect";
import { resolveQuestionSetKey } from "@/lib/sub-types";
import {
  type CpiBreakdown,
  FEE_FLOOR,
  COMPLEXITY_FLOOR,
  validateAndFixScoring,
  computeCpiPartial,
} from "@/lib/cpi-calculator";
import { autoConfirmFromContext } from "@/lib/auto-confirm";

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
  /** UTM params and page path from the widget's origin page, e.g. "utm_source:google, utm_medium:cpc, page:/services" */
  source_hint?: string;
  /** When true, skip GHL webhook delivery. Used by the /demo route to prevent test sessions polluting the CRM. */
  demo?: boolean;
}

// Keywords that trigger an escape to human contact before GPT is called
const ESCAPE_HATCH_RE = /^\s*(call|human|0|stop|speak|agent|operator|talk to someone|i want to speak|connect me|real person)\s*$/i;

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
  practice_sub_type: string | null;
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
  /** Slot IDs GPT extracted from free text, mapped to the matching option value. */
  filled_slots?: Record<string, string>;
  /** Confidence level for each filled slot. Only "high" and "medium" are auto-confirmed. */
  slot_confidence?: Record<string, "high" | "medium" | "low">;
}

// autoConfirmFromContext and AUTO_RULES_BY_PA are imported from @/lib/auto-confirm

// ─────────────────────────────────────────────
// GHL webhook delivery
// ─────────────────────────────────────────────
async function sendToGHL(session: Record<string, unknown>, ghlWebhookUrl: string): Promise<void> {
  const contact = (session.contact as Record<string, unknown>) ?? {};
  const scoring = (session.scoring as CpiBreakdown) ?? {};
  const entities = (session.extracted_entities as Record<string, unknown>) ?? {};

  const bandToCta: Record<string, string> = {
    A: "A lawyer will contact you within 30 minutes. Book a same-day consultation to secure your spot.",
    B: "We'll review your case and reach out within the hour. Pick a time to speak with a lawyer.",
    C: "Your intake is complete. A member of our team will personally review your situation and be in touch as soon as possible.",
    D: "We've received everything. A member of our team will take a careful look and follow up with you.",
    E: "Based on what you've shared, this matter may fall outside our practice areas. We encourage you to seek appropriate legal help.",
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
    const { session_id, firm_id, channel, message, message_type = "text", structured_data, source_hint, demo } = body;

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

    const firmBranding = (firm.branding as Record<string, string | undefined>) ?? {};

    const firmConfig: FirmConfig = {
      name: firm.name,
      description: firm.description ?? "",
      location: firm.location ?? "",
      practice_areas: firm.practice_areas,
      question_sets: firm.question_sets,
      geographic_config: firm.geographic_config,
      custom_instructions: firm.custom_instructions ?? undefined,
      assistant_name: firmBranding.assistant_name ?? undefined,
      phone_number: firmBranding.phone_number ?? undefined,
      booking_url: firmBranding.booking_url ?? undefined,
    };

    // ── Escape hatch — intercept human-contact keywords before GPT ───
    // Matches: CALL, HUMAN, 0, STOP, and natural-language equivalents.
    // Returns a phone/booking CTA without spending a GPT token.
    if (channel === "widget" && message_type === "text" && ESCAPE_HATCH_RE.test(message)) {
      const phonePart = firmBranding.phone_number ? `Call ${firmBranding.phone_number}.` : "";
      const bookPart = firmBranding.booking_url ? ` Or book a time online.` : "";
      const escapeText = [phonePart, bookPart].filter(Boolean).join("") ||
        "Please contact the firm directly to speak with someone.";

      const escapeCpi = (session.scoring as CpiBreakdown) ?? { total: 0, band: null, band_locked: false, fit_score: 0, geo_score: 0, practice_score: 0, legitimacy_score: 0, referral_score: 0, value_score: 0, urgency_score: 0, complexity_score: 0, multi_practice_score: 0, fee_score: 0 } as unknown as CpiBreakdown;
      return NextResponse.json({
        session_id: session.id,
        practice_area: (session.practice_area as string) ?? null,
        practice_area_confidence: "unknown",
        next_question: null,
        next_questions: null,
        cpi: escapeCpi,
        cpi_partial: computeCpiPartial(escapeCpi, false),
        response_text: escapeText,
        finalize: false,
        collect_identity: false,
        situation_summary: null,
        extracted_entities: {},
        questions_answered: [],
        complexity_indicators: null,
        value_tier: null,
        prior_experience: null,
        flags: ["escape_hatch"],
        cta: null,
      });
    }

    // ── Accumulate confirmed answers (widget structured_data, keyed by question ID) ──
    // These are authoritative — stored separately from GPT-extracted entities so
    // they always use the exact question IDs from the firm config, regardless of
    // whether GPT correctly extracts them.
    const existingConfirmed = ((session.scoring as Record<string, unknown>)?._confirmed as Record<string, unknown>) ?? {};
    const updatedConfirmed: Record<string, unknown> = { ...existingConfirmed };
    if (message_type === "answer" && structured_data) {
      Object.assign(updatedConfirmed, structured_data);
    }

    // ── Context-aware auto-skip: pre-answer questions from free-text situation ──
    // Extract the first user message (the situation description) from conversation
    // history and match regex patterns to auto-confirm question answers. This
    // eliminates redundant questions like "were you a pedestrian?" when the user
    // already said "car accident on the 401."
    const existingConversation = (session.conversation as Array<{ role: string; content: string }>) ?? [];
    const situationText = existingConversation.length > 0
      ? existingConversation.find(m => m.role === "user")?.content ?? message
      : message;
    if (session.practice_area) {
      const sessionSubTypeEarly = (session.practice_sub_type as string | null) ?? null;
      const sessionQSetKeyEarly = sessionSubTypeEarly
        ? resolveQuestionSetKey(session.practice_area as string, sessionSubTypeEarly)
        : null;
      const autoConfirmed = autoConfirmFromContext(
        session.practice_area as string,
        situationText,
        updatedConfirmed,
        sessionQSetKeyEarly,
      );
      Object.assign(updatedConfirmed, autoConfirmed);
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

      const existingScoringForContact = (session.scoring as Record<string, unknown>) ?? {};
      const existingEntitiesForContact = (session.extracted_entities as Record<string, unknown>) ?? {};
      return NextResponse.json({
        session_id: session.id,
        practice_area: session.practice_area,
        practice_area_confidence: "high",
        next_question: null,
        next_questions: null,
        cpi: existingCpiForContact,
        cpi_partial: computeCpiPartial(existingCpiForContact, true),
        response_text: bandToCta[existingBand] ?? "",
        finalize: true,
        collect_identity: false,
        situation_summary: (session.situation_summary as string) ?? null,
        extracted_entities: existingEntitiesForContact,
        questions_answered: Object.keys(updatedConfirmed),
        complexity_indicators: (existingScoringForContact._complexity_indicators as Record<string, unknown>) ?? null,
        value_tier: (existingEntitiesForContact.value_tier as string) ?? null,
        prior_experience: (existingEntitiesForContact.prior_experience as string) ?? null,
        flags: (existingScoringForContact._flags as string[]) ?? [],
        cta: bandToCta[existingBand] ?? null,
      });
    }

    // ── Fast path: skip GPT for structured widget answers ────────────
    // Three-phase question strategy:
    //
    // Phase 2 — Core Qualification (first 6 questions, indices 0–5)
    //   Ordered by CPI impact: urgency → merit → value → complexity.
    //   Served to every lead regardless of initial band.
    //
    // Phase 3 — Signal Refinement (questions 7–8, indices 6–7)
    //   Served only when Phase 2 is complete AND band is B or C (40–79).
    //   Band A leads go straight to identity — no refinement needed.
    //   Band D/E leads go straight to identity — more questions won't help.
    //
    // Phase 4 — Identity
    //   Name, email, phone. Always last.
    if (
      channel === "widget" &&
      message_type === "answer" &&
      structured_data &&
      session.practice_area
    ) {
      const paId = session.practice_area as string;
      const sessionSubType = (session.practice_sub_type as string | null) ?? null;
      const sessionQSetKey = resolveQuestionSetKey(paId, sessionSubType);
      // Prefer sub-type-specific set, fall back to umbrella, then label-match
      const questionSet =
        firmConfig.question_sets[sessionQSetKey] ??
        firmConfig.question_sets[paId] ??
        Object.values(firmConfig.question_sets).find(qs =>
          qs.practice_area_id === paId ||
          qs.practice_area_id.toLowerCase() === paId.toLowerCase() ||
          firmConfig.practice_areas.find(a => a.id === qs.practice_area_id)?.label.toLowerCase() === paId.toLowerCase()
        ) ??
        null;

      if (questionSet != null) {
        const existingCpi = (session.scoring as CpiBreakdown & { _confirmed?: Record<string, unknown> }) ?? {} as CpiBreakdown;
        const widgetScoringRaw = (session.scoring as Record<string, unknown>) ?? {};
        const widgetRound2Started = !!widgetScoringRaw._round_2_started;

        // Save confirmed answers
        await supabase
          .from("intake_sessions")
          .update({ scoring: { ...existingCpi, _confirmed: updatedConfirmed } })
          .eq("id", session.id);

        // Dynamic question selection — S10.3
        // Priority-based: replaces hard-coded slice(0,6)/slice(6) Phase 2/3 split.
        // band_locked (S10.4): if band is already locked, skip straight to identity.
        // Use sub-type key for slot schema lookup so priority weights match question IDs.
        const currentBand = (session.band as string) ?? existingCpi.band ?? "C";
        const bandLocked = !!(existingCpi as unknown as Record<string, unknown>).band_locked;
        const batch = bandLocked
          ? { questions: [], phase: "identity" as const }
          : selectNextQuestions(questionSet.questions, sessionQSetKey, updatedConfirmed, currentBand);

        // ── Round 1 completion: re-score then route ─────────────────────────
        // When all Round 1 questions are done and Round 2 hasn't started yet:
        // 1. Re-score CPI using every confirmed entity (GPT has the full scoring engine).
        //    Fit components (geo, practice, legitimacy, referral) are locked from Turn 1.
        // 2. Use the re-scored band — not the initial classification — to decide routing:
        //    Band A/B → generate Round 2 deep-dive questions (lean GPT call).
        //    Band C/D/E → collect_identity immediately with the updated CPI.
        // Both GPT calls fall through gracefully: if either fails, the session continues
        // with the existing CPI / initial band so the user never sees an error.
        if (batch.phase === "identity" && !widgetRound2Started) {
          const r1EntityLines = Object.entries(updatedConfirmed)
            .filter(([k]) => !k.startsWith("_"))
            .map(([k, v]) => `  ${k}: ${v}`)
            .join("\n") || "  (none recorded)";

          // Defaults — used if re-score GPT call fails
          let r1Cpi = existingCpi;
          let r1Band = currentBand;
          let r1Entities = (session.extracted_entities as Record<string, unknown>) ?? {};
          let r1ComplexityIndicators: Record<string, unknown> | null =
            ((existingCpi as unknown as Record<string, unknown>)._complexity_indicators as Record<string, unknown>) ?? null;
          let r1Flags: string[] = ((existingCpi as unknown as Record<string, unknown>)._flags as string[]) ?? [];

          try {
            let r1Prompt = buildSystemPrompt(firmConfig, "widget", { includeQuestionSets: false });
            r1Prompt +=
              `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
              `\nROUND 1 RE-SCORING PASS — override all channel instructions\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `All Round 1 intake questions have been answered. Re-score the CPI now.\n` +
              `Return next_question: null, next_questions: null, collect_identity: true, finalize: false.\n` +
              `response_text: "" (empty string). situation_summary: null.\n\n` +
              `LOCKED FIT COMPONENTS (carry forward unchanged):\n` +
              `  geo_score: ${existingCpi.geo_score}, practice_score: ${existingCpi.practice_score}\n` +
              `  legitimacy_score: ${existingCpi.legitimacy_score}, referral_score: ${existingCpi.referral_score}\n` +
              `  fit_score: ${existingCpi.fit_score}\n\n` +
              `ALL CONFIRMED ENTITIES (Round 1):\n${r1EntityLines}\n\n` +
              `TASK: Recalculate urgency_score, complexity_score, multi_practice_score, fee_score, and value_tier ` +
              `using every entity above and the full scoring rules in this prompt. ` +
              `value_score = urgency + complexity + multi_practice + fee. ` +
              `total = ${existingCpi.fit_score} (locked fit) + value_score. ` +
              `Band: A=80-100, B=60-79, C=40-59, D=20-39, E=0-19. ` +
              `Return the complete JSON schema with all components.`;

            const r1Completion = await openai.chat.completions.create({
              model: MODEL,
              temperature: 0,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: r1Prompt },
                { role: "user", content: `Re-score this ${paId} case from Round 1 answers: ${r1EntityLines.replace(/\n/g, ", ")}` },
              ],
            });

            const r1Raw = r1Completion.choices[0]?.message?.content;
            if (r1Raw) {
              const r1Gpt = JSON.parse(r1Raw) as GptResponse;

              // Lock fit components
              if (r1Gpt.cpi) {
                r1Gpt.cpi.geo_score = existingCpi.geo_score;
                r1Gpt.cpi.practice_score = existingCpi.practice_score;
                r1Gpt.cpi.legitimacy_score = existingCpi.legitimacy_score;
                r1Gpt.cpi.referral_score = existingCpi.referral_score;
                r1Gpt.cpi.fit_score = existingCpi.fit_score;
              }

              // Apply floors
              if (r1Gpt.cpi && r1Gpt.practice_area) {
                const rePa = r1Gpt.practice_area;
                if (r1Gpt.cpi.fee_score < (FEE_FLOOR[rePa] ?? 5)) r1Gpt.cpi.fee_score = FEE_FLOOR[rePa] ?? 5;
                if (r1Gpt.cpi.complexity_score < (COMPLEXITY_FLOOR[rePa] ?? 5)) r1Gpt.cpi.complexity_score = COMPLEXITY_FLOOR[rePa] ?? 5;
                if (r1Gpt.cpi.urgency_score < 2) r1Gpt.cpi.urgency_score = 2;
              }

              r1Cpi = validateAndFixScoring(r1Gpt.cpi ?? existingCpi);
              r1Band = r1Cpi.band ?? currentBand;
              r1ComplexityIndicators = r1Gpt.complexity_indicators ?? null;
              r1Flags = r1Gpt.flags ?? [];
              r1Entities = {
                ...(session.extracted_entities as Record<string, unknown> ?? {}),
                ...(r1Gpt.value_tier ? { value_tier: r1Gpt.value_tier } : {}),
              };

              // Persist re-scored CPI and updated band before routing decision
              await supabase
                .from("intake_sessions")
                .update({
                  scoring: {
                    ...r1Cpi,
                    _confirmed: updatedConfirmed,
                    ...(r1ComplexityIndicators ? { _complexity_indicators: r1ComplexityIndicators } : {}),
                    ...(r1Flags.length ? { _flags: r1Flags } : {}),
                  },
                  band: r1Band,
                  extracted_entities: r1Entities,
                })
                .eq("id", session.id);
            }
          } catch (err) {
            console.error("[screen] Round 1 re-score failed, using initial band for routing:", err);
            // r1Cpi / r1Band stay at initial values — graceful degradation
          }

          // ── Route based on re-scored band ──────────────────────────────────
          if (["A", "B"].includes(r1Band)) {
            // Band A/B: generate Round 2 deep-dive questions
            const r2EntitySummary = Object.entries(updatedConfirmed)
              .filter(([k]) => !k.startsWith("_"))
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ") || "none collected yet";

            const r2SystemPrompt =
              `You are a legal intake specialist generating a second round of targeted screening questions.\n\n` +
              `Practice area: ${paId}. Re-scored band after Round 1: ${r1Band}.\n` +
              `Entities already collected: ${r2EntitySummary}\n\n` +
              `Generate exactly 2 adaptive follow-up questions targeting the highest-uncertainty value drivers NOT already collected above.\n\n` +
              `Practice area guidance:\n` +
              `- emp: discrimination/harassment overlap, executive equity or bonus, human rights filing intent, whether release was signed\n` +
              `- pi: income replacement amount, catastrophic injury threshold, medical-legal report ordered, pre-existing conditions\n` +
              `- fam: matrimonial home equity estimate, pension or RRSP division, cross-jurisdiction element, child support arrears\n` +
              `- crim: exact breath reading if DUI, prior criminal record, victim statement filed\n` +
              `- real: title search result, financing condition waived, home inspection findings\n` +
              `- imm: current status in Canada, refusal history, provincial nomination received\n` +
              `- All others: the 2 most value-determinative unknowns for this practice area.\n\n` +
              `Return a JSON object with this exact shape (no other keys):\n` +
              `{ "questions": [ { "id": "r2_[descriptive_id]", "text": "...", "options": [ { "label": "...", "value": "..." } ], "allow_free_text": false } ] }\n\n` +
              `Rules: 2-4 options per question. Values in snake_case. Fully distinct from Round 1 and from each other. Do NOT repeat any subject already in the collected entities list.`;

            try {
              const r2Completion = await openai.chat.completions.create({
                model: MODEL,
                temperature: 0,
                response_format: { type: "json_object" },
                messages: [
                  { role: "system", content: r2SystemPrompt },
                  { role: "user", content: "Generate the 2 Round 2 questions now." },
                ],
              });

              const r2Raw = r2Completion.choices[0]?.message?.content;
              if (r2Raw) {
                const r2Parsed = JSON.parse(r2Raw) as { questions?: unknown[] };
                const r2Questions = Array.isArray(r2Parsed.questions) ? r2Parsed.questions : [];

                if (r2Questions.length > 0) {
                  await supabase
                    .from("intake_sessions")
                    .update({
                      scoring: {
                        ...r1Cpi,
                        _confirmed: updatedConfirmed,
                        _round_2_started: true,
                        ...(r1ComplexityIndicators ? { _complexity_indicators: r1ComplexityIndicators } : {}),
                        ...(r1Flags.length ? { _flags: r1Flags } : {}),
                      },
                    })
                    .eq("id", session.id);

                  return NextResponse.json({
                    session_id: session.id,
                    practice_area: session.practice_area,
                    practice_area_confidence: "high",
                    next_question: null,
                    next_questions: r2Questions,
                    cpi: r1Cpi,
                    cpi_partial: computeCpiPartial(r1Cpi, false),
                    response_text: "",
                    finalize: false,
                    collect_identity: false,
                    situation_summary: (session.situation_summary as string) ?? null,
                    extracted_entities: r1Entities,
                    questions_answered: Object.keys(updatedConfirmed),
                    complexity_indicators: r1ComplexityIndicators,
                    value_tier: (r1Entities.value_tier as string) ?? null,
                    prior_experience: (r1Entities.prior_experience as string) ?? null,
                    flags: r1Flags,
                    cta: null,
                  });
                }
              }
            } catch (err) {
              console.error("[screen] Round 2 widget generation failed, falling through to identity:", err);
              // Fall through — return collect_identity with r1Cpi below
            }
          }

          // Band C/D/E (or Round 2 generation failed) → identity with re-scored CPI
          return NextResponse.json({
            session_id: session.id,
            practice_area: session.practice_area,
            practice_area_confidence: "high",
            next_question: null,
            next_questions: null,
            cpi: r1Cpi,
            cpi_partial: computeCpiPartial(r1Cpi, false),
            response_text: "",
            finalize: false,
            collect_identity: true,
            situation_summary: (session.situation_summary as string) ?? null,
            extracted_entities: r1Entities,
            questions_answered: Object.keys(updatedConfirmed),
            complexity_indicators: r1ComplexityIndicators,
            value_tier: (r1Entities.value_tier as string) ?? null,
            prior_experience: (r1Entities.prior_experience as string) ?? null,
            flags: r1Flags,
            cta: null,
          });
        }

        // ── Round 2 CPI re-score ────────────────────────────────────────────
        // Fires when Round 2 answers have just been submitted (widgetRound2Started=true)
        // and all questions are done (batch.phase==="identity").
        // Calls GPT with a lean prompt to recompute value_score components using the full
        // entity set (R1 + R2). Fit components (geo, practice, legitimacy, referral) are
        // locked from the initial classification and never change.
        // On failure, falls through and uses the existing CPI.
        if (widgetRound2Started && batch.phase === "identity") {
          const entityLines = Object.entries(updatedConfirmed)
            .filter(([k]) => !k.startsWith("_"))
            .map(([k, v]) => `  ${k}: ${v}`)
            .join("\n") || "  (none recorded)";

          // Use the full scoring engine (no question sets) — ~8K tokens, covers all PA rules
          let reScoringPrompt = buildSystemPrompt(firmConfig, "widget", { includeQuestionSets: false });
          reScoringPrompt +=
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            `\nFINAL RE-SCORING PASS — override all channel instructions\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `All intake questions (Round 1 and Round 2) have been answered.\n` +
            `Return next_question: null, next_questions: null, collect_identity: true, finalize: false.\n` +
            `response_text: "" (empty string). situation_summary: null.\n\n` +
            `LOCKED FIT COMPONENTS (do not change these):\n` +
            `  geo_score: ${existingCpi.geo_score}\n` +
            `  practice_score: ${existingCpi.practice_score}\n` +
            `  legitimacy_score: ${existingCpi.legitimacy_score}\n` +
            `  referral_score: ${existingCpi.referral_score}\n` +
            `  fit_score: ${existingCpi.fit_score}\n\n` +
            `ALL COLLECTED ENTITIES (Round 1 + Round 2):\n${entityLines}\n\n` +
            `TASK: Recalculate ONLY the value_score components:\n` +
            `  urgency_score (0-20): apply timeline signals from entities\n` +
            `  complexity_score (0-25): apply base_complexity + all complexity_delta from entities\n` +
            `  multi_practice_score (0-5): apply if cross-practice signals present\n` +
            `  fee_score (0-10): apply value_tier inference from entities\n\n` +
            `value_score = urgency + complexity + multi_practice + fee\n` +
            `total = fit_score (${existingCpi.fit_score}) + value_score\n` +
            `band from total: A=80-100, B=60-79, C=40-59, D=20-39, E=0-19\n\n` +
            `Return the complete JSON schema. Copy fit components from LOCKED values above.`;

          try {
            const reScoringCompletion = await openai.chat.completions.create({
              model: MODEL,
              temperature: 0,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: reScoringPrompt },
                {
                  role: "user",
                  content: `Re-score this ${paId} case after all rounds. Entities: ${entityLines.replace(/\n/g, ", ")}`,
                },
              ],
            });

            const reScoringRaw = reScoringCompletion.choices[0]?.message?.content;
            if (reScoringRaw) {
              const reScoredGpt = JSON.parse(reScoringRaw) as GptResponse;

              // Lock fit components — they never change from R2 answers
              if (reScoredGpt.cpi) {
                reScoredGpt.cpi.geo_score = existingCpi.geo_score;
                reScoredGpt.cpi.practice_score = existingCpi.practice_score;
                reScoredGpt.cpi.legitimacy_score = existingCpi.legitimacy_score;
                reScoredGpt.cpi.referral_score = existingCpi.referral_score;
                reScoredGpt.cpi.fit_score = existingCpi.fit_score;
              }

              // Apply floors + validate
              if (reScoredGpt.cpi && reScoredGpt.practice_area) {
                const rePa = reScoredGpt.practice_area;
                const reFeeFloor = FEE_FLOOR[rePa] ?? 5;
                const reComplexityFloor = COMPLEXITY_FLOOR[rePa] ?? 5;
                if (reScoredGpt.cpi.fee_score < reFeeFloor) reScoredGpt.cpi.fee_score = reFeeFloor;
                if (reScoredGpt.cpi.complexity_score < reComplexityFloor) reScoredGpt.cpi.complexity_score = reComplexityFloor;
                if (reScoredGpt.cpi.urgency_score < 2) reScoredGpt.cpi.urgency_score = 2;
              }

              const updatedCpi = validateAndFixScoring(reScoredGpt.cpi ?? existingCpi);
              const updatedEntities = {
                ...(session.extracted_entities as Record<string, unknown> ?? {}),
                ...(reScoredGpt.value_tier ? { value_tier: reScoredGpt.value_tier } : {}),
              };

              // Persist re-scored CPI + updated band to session
              await supabase
                .from("intake_sessions")
                .update({
                  scoring: {
                    ...updatedCpi,
                    _confirmed: updatedConfirmed,
                    _round_2_started: true,
                    _round_2_complete: true,
                    ...(reScoredGpt.complexity_indicators ? { _complexity_indicators: reScoredGpt.complexity_indicators } : {}),
                    ...(reScoredGpt.flags?.length ? { _flags: reScoredGpt.flags } : {}),
                  },
                  band: updatedCpi.band,
                  extracted_entities: updatedEntities,
                })
                .eq("id", session.id);

              return NextResponse.json({
                session_id: session.id,
                practice_area: session.practice_area,
                practice_area_confidence: "high",
                next_question: null,
                next_questions: null,
                cpi: updatedCpi,
                cpi_partial: computeCpiPartial(updatedCpi, false),
                response_text: "",
                finalize: false,
                collect_identity: true,
                situation_summary: (session.situation_summary as string) ?? null,
                extracted_entities: updatedEntities,
                questions_answered: Object.keys(updatedConfirmed),
                complexity_indicators: reScoredGpt.complexity_indicators ?? null,
                value_tier: reScoredGpt.value_tier ?? null,
                prior_experience: ((updatedEntities as Record<string, unknown>).prior_experience as string) ?? null,
                flags: reScoredGpt.flags ?? [],
                cta: null,
              });
            }
          } catch (err) {
            console.error("[screen] Round 2 CPI re-score failed, using existing CPI:", err);
            // Fall through — user still gets identity step with baseline CPI
          }
        }

        const nextQuestions = batch.phase !== "identity" ? batch.questions : null;
        const collectIdentity = batch.phase === "identity";

        const shapeQ = (q: typeof batch.questions[number]) => q; // already shaped by selectNextQuestions

        return NextResponse.json({
          session_id: session.id,
          practice_area: session.practice_area,
          practice_area_confidence: "high",
          next_question: null,
          next_questions: nextQuestions ? nextQuestions.map(shapeQ) : null,
          cpi: existingCpi,
          cpi_partial: computeCpiPartial(existingCpi, collectIdentity && bandLocked),
          response_text: "",
          finalize: false,
          collect_identity: collectIdentity,
          situation_summary: (session.situation_summary as string) ?? null,
          extracted_entities: (session.extracted_entities as Record<string, unknown>) ?? {},
          questions_answered: Object.keys(updatedConfirmed),
          complexity_indicators: ((existingCpi as unknown as Record<string, unknown>)._complexity_indicators as Record<string, unknown>) ?? null,
          value_tier: ((session.extracted_entities as Record<string, unknown>)?.value_tier as string) ?? null,
          prior_experience: ((session.extracted_entities as Record<string, unknown>)?.prior_experience as string) ?? null,
          flags: ((existingCpi as unknown as Record<string, unknown>)._flags as string[]) ?? [],
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
      if (sessionPracticeArea) {
        // Known practice area: inject the sub-type question set when available,
        // otherwise fall back to the umbrella PA set.
        const sessionSubTypePrompt = (session.practice_sub_type as string | null) ?? null;
        const sessionQSetKeyPrompt = resolveQuestionSetKey(sessionPracticeArea, sessionSubTypePrompt);
        const qSet =
          firmConfig.question_sets[sessionQSetKeyPrompt] ??
          firmConfig.question_sets[sessionPracticeArea] ??
          null;
        if (qSet) {
          promptFirmConfig = {
            ...firmConfig,
            question_sets: { [sessionQSetKeyPrompt]: qSet },
          };
          includeQuestionSets = true;
        }
      }
      // else: first call — no questions, classification-only prompt
    }

    let systemPrompt = buildSystemPrompt(promptFirmConfig, channel, { includeQuestionSets });

    // Inject source context so GPT can factor in the lead's entry point
    if (source_hint) {
      systemPrompt +=
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
        `\nSOURCE CONTEXT\n` +
        `The client arrived via: ${source_hint}\n` +
        `Use this to inform referral_score inference if no explicit referral is stated.` +
        ` utm_source:google with utm_medium:cpc = paid ads (referral_score 3).` +
        ` utm_medium:organic or direct = organic search (referral_score 4).` +
        ` utm_source:facebook = social media (referral_score 2).`;
    }

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
        `\nSESSION STATE: CONFIRMED ANSWERS (MUST NOT ask again)\n` +
        lines +
        `\n\nThese are the client's confirmed answers for this session. Do NOT include any question whose id or subject matches a key above in next_question or next_questions. Apply all scoring deltas for these values immediately.`;
    }

    // ── Slot Extraction Block — S10.2 ────────────────────────────────────────────
    // When a practice area is known, inject high-priority unfilled slots with their
    // option values and extraction_hints. GPT scans the full message history and
    // returns filled_slots + slot_confidence. Only high/medium confidence slots are
    // auto-confirmed (merged into updatedConfirmed after the GPT response is parsed).
    if (sessionPracticeArea) {
      const sessionSubTypeSlot = (session.practice_sub_type as string | null) ?? null;
      const sessionQSetKeySlot = resolveQuestionSetKey(sessionPracticeArea, sessionSubTypeSlot);
      // Use sub-type schema when available; fall back to umbrella PA schema
      const slotSchema = getSlotSchema(sessionQSetKeySlot) || getSlotSchema(sessionPracticeArea);
      const questionSet =
        firmConfig.question_sets[sessionQSetKeySlot] ??
        firmConfig.question_sets[sessionPracticeArea] ??
        Object.values(firmConfig.question_sets).find(qs => qs.practice_area_id === sessionPracticeArea) ??
        null;

      if (questionSet && Object.keys(slotSchema).length > 0) {
        // Build a lookup: question ID → question definition
        const questionById = new Map(questionSet.questions.map(q => [q.id, q]));

        // Filter: priority >= 4, not already confirmed, question exists in set
        const slotsToExtract = Object.entries(slotSchema)
          .filter(([qId, meta]) => meta.priority >= 4 && !(qId in allCollected) && questionById.has(qId))
          .sort(([, a], [, b]) => b.priority - a.priority); // highest priority first

        if (slotsToExtract.length > 0) {
          const slotLines = slotsToExtract.map(([qId, meta]) => {
            const q = questionById.get(qId)!;
            const optValues = q.options.map(o => o.value).join(" | ");
            const hints = meta.extraction_hints.slice(0, 6).join(", ");
            return `  ${qId}: "${q.text}"\n    options: ${optValues}\n    scan for: ${hints}`;
          }).join("\n\n");

          systemPrompt +=
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            `\nSLOT EXTRACTION: Scan ALL client messages for pre-filled answers\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `For each slot below, check if the client's free text already contains the answer.\n` +
            `Return the exact option value (not a paraphrase) in filled_slots.\n` +
            `Include slot_confidence: "high" (clear match), "medium" (strongly implied), "low" (guessed).\n` +
            `CRITICAL: Only include HIGH and MEDIUM confidence slots: never guess.\n\n` +
            slotLines +
            `\n\nReturn at top level:\n` +
            `  "filled_slots": { "question_id": "option_value" }\n` +
            `  "slot_confidence": { "question_id": "high" | "medium" | "low" }\n` +
            `If nothing can be extracted with confidence, return filled_slots: {} and slot_confidence: {}.`;
        }
      }
    }

    // ── Round 2 state — read from session scoring JSONB ─────────────────────────
    const sessionScoringRaw = (session.scoring as Record<string, unknown>) ?? {};
    const round2Started = !!sessionScoringRaw._round_2_started;
    const round2QCount = (sessionScoringRaw._round_2_q_count as number) ?? 0;
    let startingRound2 = false; // set to true when this turn triggers Round 2

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
          // Round 1: inject the next question with a transcript-scan instruction
          const opts = nextQ.options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
          systemPrompt +=
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            `\nNEXT QUESTION TO ASK (server-assigned)\n` +
            `BEFORE ASKING: Scan all prior user messages. If any earlier message already answers this question, extract the value into extracted_entities + questions_answered and set next_question to the NEXT unanswered question instead.\n\n` +
            `If not already answered, ask this conversationally in response_text:\n` +
            `ID: ${nextQ.id}\nQuestion: ${nextQ.text}\nOptions:\n${opts}\n\n` +
            `Set next_question.id = "${nextQ.id}", next_question.text = "${nextQ.text}", ` +
            `next_question.options from the numbered list above. Do NOT ask any other questions.`;
        } else if (!round2Started && ["A", "B"].includes((session.band as string) ?? "")) {
          // Round 1 complete, Band A or B — start adaptive Round 2 deep-dive
          startingRound2 = true;
          const entitySummary = Object.entries(allCollected)
            .filter(([k]) => !k.startsWith("_"))
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          systemPrompt +=
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            `\nROUND 2: ADAPTIVE DEEP-DIVE (3 questions total)\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Round 1 screening is complete. Initial band candidate: ${(session.band as string) ?? "B"}.\n` +
            `Collected so far: ${entitySummary}\n\n` +
            `Ask ONE targeted follow-up question to sharpen the CPI before finalizing. Focus on the highest-uncertainty value driver for this practice area:\n` +
            `- Employment: discrimination/harassment overlap, executive equity/bonus, human rights filing intent, release signed or not\n` +
            `- Personal Injury: income replacement, catastrophic threshold, medical-legal report ordered, prior pre-existing conditions\n` +
            `- Family Law: matrimonial home equity estimate, pension or RRSP division, cross-jurisdiction issue\n` +
            `- Criminal: breath reading value (if DUI), prior criminal record, charges pending for co-accused\n` +
            `- All others: the single most value-determinative unknown for this area\n\n` +
            `Generate ONE question with 2–4 numbered options relevant to the client's stated facts.\n` +
            `Use a new question ID prefixed with "r2_" (e.g. "r2_income_replacement").\n` +
            `Set finalize=false, collect_identity=false.`;
        } else if (round2Started && round2QCount < 2) {
          // Round 2 in progress — ask one more adaptive question (cap at 3 total = indices 0,1,2)
          const entitySummary = Object.entries(allCollected)
            .filter(([k]) => !k.startsWith("_"))
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          systemPrompt +=
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            `\nROUND 2 CONTINUING (question ${round2QCount + 1} of 3)\n` +
            `Collected so far: ${entitySummary}\n\n` +
            `Ask ONE more targeted follow-up question on a dimension not yet covered. Use a "r2_" prefixed ID.\n` +
            `Set finalize=false, collect_identity=false.`;
        } else {
          // All done — Round 1 only (Band C/D/E) or Round 2 complete
          systemPrompt +=
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            `\nAll intake questions have been answered. Set collect_identity=true in your response.`;
        }
      }
    }

    // ── First-turn compact slot extraction — S10.5 ───────────────────────────────
    // On turn 1, sessionPracticeArea is null so the full SLOT EXTRACTION block above
    // never fires. Inject a compact schema for the 6 most common practice areas so GPT
    // does classification AND extraction in a single call.
    // Only injected when: (a) no practice area is known yet, AND (b) channel is widget.
    // (~300 tokens, covers ~85% of intake volume, enables turn-1 extraction.)
    if (channel === "widget" && !sessionPracticeArea) {
      systemPrompt +=
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
        `\nFIRST-TURN SLOT EXTRACTION\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `After classifying practice_area, scan the client's FIRST message and extract any clearly answerable slots.\n` +
        `Return filled_slots using ONLY the exact option values listed below for the classified area.\n` +
        `Only include HIGH or MEDIUM confidence matches. When in doubt, omit the slot.\n\n` +
        `PI: pi_q1=driver|passenger|pedestrian|cyclist  pi_q16=today_week|within_month|1_6mo|6mo_2yr|over_2yr  pi_q17=immediate|within_week|delayed|not_yet|no_injuries  pi_q31=rear_end|side_impact|head_on|pedestrian|other  pi_q32=yes|no|unsure  pi_q2=yes|no|unsure\n` +
        `EMP: emp_q1=yes|no  emp_q2=without_cause|constructive|cause|mutual|layoff|unsure  emp_q16=under_3mo|3_6mo|6_12mo|1_2yr|over_2yr  emp_q17=no_notice|working_notice|paid_lieu|unsure  emp_q31=no_reason|performance|misconduct|restructuring|discrimination|unsure  emp_q47=under_1yr|1_3yr|3_5yr|5_10yr|10_15yr|over_15yr\n` +
        `FAM: fam_q1=yes|no  fam_q2=yes|no  fam_q29=under_1yr|1_5yr|5_15yr|over_15yr|unknown  fam_q55=separation|adultery|cruelty|unsure  fam_q82=none|one|two_three|four_plus\n` +
        `CRIM: crim_q1=yes|no  crim_q19=under_3mo|3_6mo|6_12mo|1_2yr|over_2yr  crim_q34=over_80|refuse|drugs|impaired|other  crim_q35=provided|refused|unsure\n` +
        `REAL: real_q1=buying|selling|both  real_q2=house|condo|commercial|other  real_q14=under_2wk|2_4wk|1_3mo|over_3mo|unknown\n` +
        `LLT: llt_q1=landlord|tenant  llt_q18=0|1_2mo|3_6mo|over_6mo  llt_q19=yes|no\n\n` +
        `Return at top level: "filled_slots": { "question_id": "option_value" } and "slot_confidence": { "question_id": "high"|"medium" }`;
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

    // ── Merge GPT-extracted slots into confirmed answers — S10.2 ─────────────────
    // GPT returns filled_slots (question_id → option_value) from scanning free text.
    // Only high and medium confidence extractions are auto-confirmed.
    // Low confidence slots are discarded — better to ask than to guess.
    if (gptResponse.filled_slots && Object.keys(gptResponse.filled_slots).length > 0) {
      const confidence = gptResponse.slot_confidence ?? {};
      for (const [slotId, slotValue] of Object.entries(gptResponse.filled_slots)) {
        const conf = confidence[slotId] ?? "medium"; // default to medium if not specified
        if (conf === "high" || conf === "medium") {
          updatedConfirmed[slotId] = slotValue;
        }
      }
    }

    // ── Normalize practice_area to canonical short ID ─────────────────
    // GPT may return: the label ("Family Law"), a slug ("family_law"),
    // or already the short ID ("fam"). Normalize all to the short ID.
    // Must run BEFORE floor application so FEE_FLOOR/COMPLEXITY_FLOOR keys match.
    if (gptResponse.practice_area) {
      const raw = gptResponse.practice_area;
      const rawNorm = raw.toLowerCase().replace(/[\s_-]+/g, "");
      const pa = firmConfig.practice_areas.find(
        a =>
          a.id === raw ||
          a.id.toLowerCase() === raw.toLowerCase() ||
          a.label.toLowerCase() === raw.toLowerCase() ||
          a.label.toLowerCase().replace(/[\s_-]+/g, "") === rawNorm
      );
      if (pa) gptResponse.practice_area = pa.id;
    }

    // ── Resolve practice_sub_type ─────────────────────────────────────
    // Three-pass: (1) regex detection on situation text, (2) GPT output field,
    // (3) resolve + conflict log. Only runs on first classification or if
    // sub-type was not previously set (to allow at most one mid-session swap).
    const existingSubType = session.practice_sub_type as string | null | undefined;
    if (gptResponse.practice_area && !existingSubType) {
      const { subType: resolvedSubType, conflict: subTypeConflict } =
        resolveSubType(gptResponse.practice_area, situationText, gptResponse.practice_sub_type);

      // Fallback: if neither regex nor GPT returned a sub-type, use `{pa}_other`
      gptResponse.practice_sub_type = resolvedSubType ?? `${gptResponse.practice_area}_other`;

      if (subTypeConflict) {
        console.warn(
          `[sub-type] conflict: regex=${detectSubType(gptResponse.practice_area, situationText)?.subType} gpt=${resolvedSubType} → using GPT`,
        );
        // Log conflict to Supabase for monitoring (fire-and-forget, don't block response)
        void supabase
          .from("sub_type_conflicts")
          .insert({
            session_id: session.id,
            practice_area: gptResponse.practice_area,
            regex_sub_type: detectSubType(gptResponse.practice_area, situationText)?.subType ?? null,
            gpt_sub_type: gptResponse.practice_sub_type,
            situation_text: situationText.substring(0, 500),
            created_at: new Date().toISOString(),
          });
      }
    } else if (existingSubType) {
      // Keep the existing sub-type (locked after first classification)
      gptResponse.practice_sub_type = existingSubType;
    }

    // Resolve the question-set key from PA + sub-type
    const questionSetKey = gptResponse.practice_area
      ? resolveQuestionSetKey(gptResponse.practice_area, gptResponse.practice_sub_type)
      : null;

    // ── Apply per-area CPI floors ─────────────────────────────────────
    // GPT under-scores fee and complexity on the first message when data is
    // sparse. Floors ensure Band assignments are meaningful from turn 1.
    // Urgency floor (2) prevents any identified matter from scoring Band E
    // purely due to a zero urgency default. Geo default (5) when no location known.
    if (gptResponse.practice_area) {
      const pa = gptResponse.practice_area;
      const feeFloor = FEE_FLOOR[pa] ?? 5;
      const complexityFloor = COMPLEXITY_FLOOR[pa] ?? 5;
      if (gptResponse.cpi.fee_score < feeFloor) gptResponse.cpi.fee_score = feeFloor;
      if (gptResponse.cpi.complexity_score < complexityFloor) gptResponse.cpi.complexity_score = complexityFloor;
      if (gptResponse.cpi.urgency_score < 2) gptResponse.cpi.urgency_score = 2;
      if (gptResponse.cpi.geo_score === 0) gptResponse.cpi.geo_score = 5;
    }

    // ── Validate + fix scoring (single pass, after all adjustments) ───
    gptResponse.cpi = validateAndFixScoring(gptResponse.cpi);

    // Warn only after floors are applied — a zero here is a genuine miss.
    if (gptResponse.cpi.practice_score > 0 && gptResponse.cpi.complexity_score === 0 && gptResponse.cpi.fee_score === 0) {
      console.warn("[cpi] Floors applied but value score still zero — check GPT scoring for PA:", gptResponse.practice_area);
    }

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
      // Find matching question set: prefer sub-type key, fall back to umbrella PA key,
      // then fall back to practice_area_id match.
      let questionSet = questionSetKey ? (firmConfig.question_sets[questionSetKey] ?? null) : null;
      if (!questionSet && paId) {
        questionSet = firmConfig.question_sets[paId] ?? null;
      }
      if (!questionSet && paId) {
        questionSet = Object.values(firmConfig.question_sets).find(qs =>
          qs.practice_area_id === paId ||
          qs.practice_area_id.toLowerCase() === paId.toLowerCase() ||
          firmConfig.practice_areas.find(a => a.id === qs.practice_area_id)?.label.toLowerCase() === paId.toLowerCase()
        ) ?? null;
      }
      if (questionSet) {
        // Auto-skip from context: on first classification, run auto-confirm with
        // the resolved question-set key (sub-type-aware) to catch any free-text matches.
        if (paId && !session.practice_area) {
          const postClassAutoConfirmed = autoConfirmFromContext(paId, situationText, updatedConfirmed, questionSetKey);
          Object.assign(updatedConfirmed, postClassAutoConfirmed);
        }

        // Dynamic question selection — S10.3 + band_locked short-circuit — S10.4
        // Use questionSetKey (sub-type) as the schema lookup key so priority weights
        // are drawn from the correct sub-type slot schema.
        const gpBand = gptResponse.cpi.band ?? "C";
        const gpBandLocked = gptResponse.cpi.band_locked ?? false;
        const slotLookupKey = questionSetKey ?? paId ?? "";
        const postGptBatch = gpBandLocked
          ? { questions: [], phase: "identity" as const }
          : selectNextQuestions(questionSet.questions, slotLookupKey, updatedConfirmed, gpBand);

        if (postGptBatch.phase !== "identity") {
          gptResponse.next_questions = postGptBatch.questions;
          gptResponse.next_question = null;
        } else {
          gptResponse.next_questions = null;
          gptResponse.next_question = null;
          gptResponse.collect_identity = true;
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
    // value_tier and prior_experience are stored inside extracted_entities JSONB
    // (not as top-level session columns — those don't exist in the schema)
    const updatedEntities = {
      ...(session.extracted_entities as Record<string, unknown> ?? {}),
      ...gptResponse.extracted_entities,
      ...(gptResponse.value_tier ? { value_tier: gptResponse.value_tier } : {}),
      ...(gptResponse.prior_experience ? { prior_experience: gptResponse.prior_experience } : {}),
    };
    // Remove situation_summary if GPT accidentally placed it inside extracted_entities
    delete (updatedEntities as Record<string, unknown>).situation_summary;

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

    // complexity_indicators and flags are stored inside the scoring JSONB column
    // (not as top-level columns — those don't exist in the schema and cause PGRST204)
    // Round 2 tracking: _round_2_started marks when Round 2 begins; _round_2_q_count
    // counts answered Round 2 questions so we can cap at 3 without relying on GPT to count.
    const scoringPayload: Record<string, unknown> = {
      ...gptResponse.cpi,
      _confirmed: updatedConfirmed,
      ...(gptResponse.complexity_indicators ? { _complexity_indicators: gptResponse.complexity_indicators } : {}),
      ...(gptResponse.flags?.length ? { _flags: gptResponse.flags } : {}),
      ...(startingRound2 ? { _round_2_started: true, _round_2_q_count: 0 } : {}),
      ...(round2Started ? { _round_2_started: true, _round_2_q_count: round2QCount + 1 } : {}),
    };

    const sessionUpdate: Record<string, unknown> = {
      conversation,
      scoring: scoringPayload,
      extracted_entities: updatedEntities,
      practice_area: gptResponse.practice_area,
      practice_sub_type: gptResponse.practice_sub_type ?? existingSubType ?? null,
      band: gptResponse.cpi.band,
      ...contactUpdate,
      ...(gptResponse.situation_summary ? { situation_summary: gptResponse.situation_summary } : {}),
    };

    if (gptResponse.finalize) {
      sessionUpdate.status = "complete";
    }

    // ── Persist to Supabase ───────────────────────────────────────────
    const { error: updateError } = await supabase
      .from("intake_sessions")
      .update(sessionUpdate)
      .eq("id", session.id);

    if (updateError) {
      console.error("[screen] Session update failed:", updateError.code, updateError.message, { session_id: session.id, keys: Object.keys(sessionUpdate) });
    }

    // ── GHL delivery on finalize ──────────────────────────────────────
    // Skipped when demo=true so test sessions never reach the production CRM.
    if (gptResponse.finalize && firm.ghl_webhook_url && !demo) {
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
    // A/B: booking call to action. C/D: warm follow-up, no timeline. E: external resources.
    const bandToCta: Record<string, string> = {
      A: "A lawyer will contact you within 30 minutes. Book a same-day consultation to secure your spot.",
      B: "We'll review your case and reach out within the hour. Pick a time to speak with a lawyer.",
      C: "Your intake is complete. A member of our team will personally review your situation and be in touch as soon as possible.",
      D: "We've received everything. A member of our team will take a careful look and follow up with you.",
      E: "Based on what you've shared, this matter may fall outside our practice areas. We encourage you to seek appropriate legal help.",
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
      cpi_partial: computeCpiPartial(gptResponse.cpi, gptResponse.finalize),
      response_text: gptResponse.response_text,
      finalize: gptResponse.finalize,
      collect_identity: gptResponse.collect_identity,
      situation_summary: gptResponse.situation_summary,
      extracted_entities: updatedEntities,
      questions_answered: gptResponse.questions_answered,
      complexity_indicators: gptResponse.complexity_indicators ?? null,
      value_tier: gptResponse.value_tier ?? null,
      prior_experience: gptResponse.prior_experience ?? null,
      flags: gptResponse.flags ?? [],
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
