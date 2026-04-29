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
import { openrouter, googleai, getIntakeModel, MODELS } from "@/lib/openrouter";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { buildSystemPrompt, type FirmConfig, type Question } from "@/lib/screen-prompt";
import { getMatterRouting, type MatterRouting } from "@/lib/matter-routing";
import { getSlotSchema } from "@/lib/slot-schema";
import { selectNextQuestions, inferImpliedAnswers } from "@/lib/question-selector";
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
import { detectFlags, mergeFlags, getGateQuestions, hasCriticalFlag, getFlagPreamble } from "@/lib/flag-registry";
import { classify, type ClassifierResult } from "@/lib/classifier";
import { selectSlots, scoreFromSlotAnswers, shouldTriggerRound3 } from "@/lib/slot-selector";
import { SLOTS_BY_SUBTYPE } from "@/lib/slot-registry";
import { computeSabsUrgency, computeDismissalBardal } from "@/lib/interaction-scoring";
import { estimateCaseValue } from "@/lib/case-value";
import { extractEvents } from "@/lib/event-extractor";
import { extractIntents } from "@/lib/intent-extractor";
import { selectEvent } from "@/lib/event-selector";
import { generateQuestion, generatePreamble } from "@/lib/event-question-generator";
import { mapEventToSubType } from "@/lib/event-subtype-map";
import {
  getRewriteMode,
  candidatesFromQuestionSet,
  callRewriteModel,
  applyResolvedQuestions,
  applySuppressedQuestions,
  buildRewriteMap,
  type RewriteTurn,
  type RewriteCallResult,
} from "@/lib/llm-rewrite";

// Intake screening → Google AI Studio (draws from $400 Google credits)
const openai = googleai;
// Memo generation uses openrouter directly (Claude Sonnet via OpenRouter)
// Model is resolved per-request via getIntakeModel()  -  see @/lib/openrouter

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
  /**
   * Question IDs the client has already answered in free text but where no clean
   * option value maps. Example: "I didn't go to the hospital" answers pi_q17
   * ("Did you get medical treatment?") at the topic level. These IDs are
   * suppressed from next_questions without binding a specific value.
   * Safety net: regex inference in question-selector catches obvious misses.
   */
  implied_question_ids?: string[];
}

// autoConfirmFromContext and AUTO_RULES_BY_PA are imported from @/lib/auto-confirm

// ─────────────────────────────────────────────
// GHL webhook delivery
// ─────────────────────────────────────────────
async function sendToGHL(session: Record<string, unknown>, ghlWebhookUrl: string, routing: MatterRouting | null = null): Promise<void> {
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
      ...(routing?.ghl_pipeline_id ? { id: routing.ghl_pipeline_id } : {}),
      stage: routing?.ghl_stage ?? bandToStage[band] ?? "new_lead",
      sla_minutes: bandToSLA[band] ?? 0,
    },
    ...(routing?.assigned_staff_id || routing?.assigned_staff_email
      ? {
          assigned_staff: {
            ...(routing.assigned_staff_id ? { id: routing.assigned_staff_id } : {}),
            ...(routing.assigned_staff_email ? { email: routing.assigned_staff_email } : {}),
          },
        }
      : {}),
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

    // Resolve model tier once per request (checks OpenRouter spend, cached 5min)
    const intakeModel = await getIntakeModel();

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
    // Hoisted: used by flag detection (before buildSystemPrompt) and systemPrompt builder
    const sessionPracticeArea = session.practice_area as string | null;

    // ── Intent extraction (synchronous on turn 1) ──────────────────────────────
    // Mines the kickoff text for canonical facts (stage_of_engagement,
    // incident_timing, etc.) before the system prompt is built. The result is
    // injected into the prompt so the AI uses it to pick foundational vs
    // structural first questions, not just to dedupe later. Adds ~1-2s of
    // latency on turn 1; zero cost on subsequent turns.
    const isFirstTurnEarly = !sessionPracticeArea;
    const previousIntentsEarly = ((session.scoring as Record<string, unknown>)?._intents as Record<string, string> | null) ?? {};
    const extractedNow = isFirstTurnEarly && message
      ? await extractIntents(message, null)
      : { intents: {}, situation_summary: null };
    const mergedIntentsEarly: Record<string, string> = { ...previousIntentsEarly, ...extractedNow.intents };

    const firmBranding = (firm.branding as Record<string, string | undefined>) ?? {};

    // Merge the seed defaults from default-question-modules.ts with the firm's
    // own question_sets. Firm-specific banks override defaults (firms can
    // customise during onboarding); defaults fill in any gaps so new banks
    // added to the seed file become immediately available to every firm
    // without requiring a per-firm DB migration. This is what makes
    // corp_shareholder_dispute / corp_acquisition / etc. work for firms that
    // were created BEFORE those banks were authored.
    const { DEFAULT_QUESTION_MODULES } = await import("@/lib/default-question-modules");
    const firmQuestionSets = (firm.question_sets ?? {}) as Record<string, unknown>;
    const mergedQuestionSets = { ...DEFAULT_QUESTION_MODULES, ...firmQuestionSets } as Record<string, import("@/lib/screen-prompt").QuestionSet>;

    const firmConfig: FirmConfig = {
      name: firm.name,
      description: firm.description ?? "",
      location: firm.location ?? "",
      practice_areas: firm.practice_areas,
      question_sets: mergedQuestionSets,
      geographic_config: firm.geographic_config,
      custom_instructions: firm.custom_instructions ?? undefined,
      assistant_name: firmBranding.assistant_name ?? undefined,
      phone_number: firmBranding.phone_number ?? undefined,
      booking_url: firmBranding.booking_url ?? undefined,
    };

    // ── Escape hatch  -  intercept human-contact keywords before GPT ───
    // Matches: CALL, HUMAN, 0, STOP, and natural-language equivalents.
    // Returns a phone/booking CTA without spending a GPT token.
    if (channel === "widget" && message_type === "text" && ESCAPE_HATCH_RE.test(message)) {
      const phonePart = firmBranding.phone_number ? `Call ${firmBranding.phone_number}.` : "";
      const bookPart = firmBranding.booking_url ? ` Or book a time online.` : "";
      const escapeText = [phonePart, bookPart].filter(Boolean).join("") ||
        "Please contact the firm directly to speak with someone.";

      const escapeCpi = (session.scoring as CpiBreakdown) ?? { total: 0, band: null, band_locked: false, fit_score: 0, geo_score: 0, practice_score: 0, legitimacy_score: 0, referral_score: 0, value_score: 0, urgency_score: 0, complexity_score: 0, multi_practice_score: 0, fee_score: 0, cpi_fit: 0, cpi_urgency: 0, cpi_friction: 0 } as unknown as CpiBreakdown;
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
    // These are authoritative  -  stored separately from GPT-extracted entities so
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

    // ── Compliance flag detection (deterministic, regex) ─────────────
    // Runs on every turn. Flags are merged with any already stored in the session
    // so accumulation works across turns (S1 flags detected on turn 1 persist to turn 5).
    // PA filtering: turn 1 (no PA yet) → universal flags only.
    //               turn 2+ (PA known) → universal + PA-specific flags.
    const allUserText = conversation
      .filter(m => m.role === "user")
      .map(m => m.content)
      .join("\n");
    const sessionComplianceFlags =
      ((session.scoring as Record<string, unknown>)?._compliance_flags as string[]) ?? [];
    const regexDetectedFlags = detectFlags(allUserText, sessionPracticeArea ?? "");
    // Mutable  -  will be updated after PA classification when PA was previously unknown
    let activeComplianceFlags = mergeFlags(sessionComplianceFlags, regexDetectedFlags);

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
        case_value: (existingScoringForContact._case_value as { label: string; tier: string; rationale: string } | undefined) ?? null,
      });
    }

    // ── Fast path: skip GPT for structured widget answers ────────────
    // Three-phase question strategy:
    //
    // Phase 2  -  Core Qualification (first 6 questions, indices 0–5)
    //   Ordered by CPI impact: urgency → merit → value → complexity.
    //   Served to every lead regardless of initial band.
    //
    // Phase 3  -  Signal Refinement (questions 7–8, indices 6–7)
    //   Served only when Phase 2 is complete AND band is B or C (40–79).
    //   Band A leads go straight to identity  -  no refinement needed.
    //   Band D/E leads go straight to identity  -  more questions won't help.
    //
    // Phase 4  -  Identity
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

        // Dynamic question selection  -  S10.3
        // Priority-based: replaces hard-coded slice(0,6)/slice(6) Phase 2/3 split.
        // band_locked (S10.4): if band is already locked, skip straight to identity.
        // Use sub-type key for slot schema lookup so priority weights match question IDs.
        const currentBand = (session.band as string) ?? existingCpi.band ?? "C";
        const bandLocked = !!(existingCpi as unknown as Record<string, unknown>).band_locked;
        const batch = bandLocked
          ? { questions: [], phase: "identity" as const }
          : selectNextQuestions(questionSet.questions, sessionQSetKey, updatedConfirmed, currentBand, situationText);

        // ── Round 1 completion: re-score then route ─────────────────────────
        // When Round 1 primary questions are done and Round 2 hasn't started yet:
        // 1. Re-score CPI using every confirmed entity (GPT has the full scoring engine).
        //    Fit components (geo, practice, legitimacy, referral) are locked from Turn 1.
        // 2. Use the re-scored band  -  not the initial classification  -  to decide routing:
        //    Band A/B → generate Round 2 deep-dive questions (lean GPT call).
        //    Band C/D/E → collect_identity immediately with the updated CPI.
        // Both GPT calls fall through gracefully: if either fails, the session continues
        // with the existing CPI / initial band so the user never sees an error.
        //
        // Refinement phase (priority-3 firm-set questions, B/C bands) is SKIPPED for
        // the widget so users always see a full 5-question Round 2 deep-dive instead
        // of a stub 2-question refinement batch. Refinement dimensions are covered by
        // the GPT deep-dive prompt, which outperforms the static refinement set.
        const shouldRunRound2 =
          (batch.phase === "identity" || batch.phase === "refinement") && !widgetRound2Started;
        if (shouldRunRound2) {
          const r1EntityLines = Object.entries(updatedConfirmed)
            .filter(([k]) => !k.startsWith("_"))
            .map(([k, v]) => `  ${k}: ${v}`)
            .join("\n") || "  (none recorded)";

          // Defaults  -  used if re-score GPT call fails
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
              `\nROUND 1 RE-SCORING PASS  -  override all channel instructions\n` +
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
              model: intakeModel,
              temperature: 0,
              max_tokens: 2048,
              response_format: { type: "json_object" },
              reasoning_effort: "none", // Gemini 2.5 thinking off  -  intake is classification, not reasoning
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
            // r1Cpi / r1Band stay at initial values  -  graceful degradation
          }

          // ── Route based on re-scored band ──────────────────────────────────
          // A/B/C all earn a 5-question GPT deep-dive (matches the marketed
          // "two rounds of questions" promise). D/E are decline cases and go
          // straight to identity so the user isn't asked to invest more effort.
          if (["A", "B", "C"].includes(r1Band)) {
            // Band A/B/C: generate Round 2 deep-dive questions
            const r2EntitySummary = Object.entries(updatedConfirmed)
              .filter(([k]) => !k.startsWith("_"))
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ") || "none collected yet";

            // Feed GPT the CPI breakdown so it can see where the case is weakest
            // and target those dimensions. A low urgency_score points to timeline
            // questions; a low complexity_score points to strategic/legal depth;
            // a low fee_score points to value/recovery questions.
            const r2CpiSignal =
              `urgency=${r1Cpi.urgency_score}/20, complexity=${r1Cpi.complexity_score}/25, ` +
              `multi_practice=${r1Cpi.multi_practice_score}/5, fee=${r1Cpi.fee_score}/10 ` +
              `(total value_score=${r1Cpi.value_score}/70, band=${r1Band})`;

            // Feed GPT the unasked firm-set dimensions as inspiration — these are the
            // questions the firm's own playbook would have asked. GPT picks whichever
            // are still value-determinative for this specific case and generates fresh
            // phrasings, plus net-new dimensions beyond the playbook.
            const unaskedFirmDimensions = selectNextQuestions(
              questionSet.questions,
              sessionQSetKey,
              updatedConfirmed,
              r1Band,
              situationText
            ).questions.map(q => `  - ${q.text}`).join("\n") || "  (firm set exhausted)";

            const r2SystemPrompt =
              `You are a senior legal intake specialist designing the final round of screening questions before the matter reaches a lawyer. Your goal: produce the 5 highest-information-value questions for this specific case.\n\n` +
              `PRACTICE AREA: ${paId}\n` +
              `RE-SCORED BAND AFTER ROUND 1: ${r1Band}\n` +
              `CPI SCORING GAPS: ${r2CpiSignal}\n\n` +
              `ENTITIES ALREADY CONFIRMED:\n${r2EntitySummary}\n\n` +
              `FIRM PLAYBOOK DIMENSIONS STILL OPEN (inspiration only — rewrite and expand):\n${unaskedFirmDimensions}\n\n` +
              `Practice area guidance (examples of high-value dimensions — use as signal, not script):\n` +
              `- emp: discrimination or harassment overlap, executive equity or bonus, human rights filing intent, whether release was signed, notice period sought, mitigation efforts, prior employer communications\n` +
              `- pi: income replacement amount, catastrophic injury threshold, medical-legal report ordered, pre-existing conditions, treatment plan in place, at-fault liability clarity, insurer communications to date\n` +
              `- fam: matrimonial home equity estimate, pension or RRSP division, cross-jurisdiction element, child support arrears, parenting schedule status, domestic violence history, prior separation agreement\n` +
              `- crim: exact breath reading if DUI, prior criminal record, victim statement filed, release conditions, disclosure received, co-accused status, bail terms\n` +
              `- real: title search result, financing condition waived, home inspection findings, closing date pressure, counterparty counsel known, deposit at risk, status certificate reviewed\n` +
              `- imm: current status in Canada, refusal history, provincial nomination received, employer sponsorship stage, dependants included, language test scores, prior application timelines\n\n` +
              `TASK: Select the 5 questions with the highest information value for this case. Prioritize dimensions that (a) map to the weakest CPI component above, (b) would most change the case's tier/strategy if answered, and (c) are not covered by entities already confirmed.\n\n` +
              `OUTPUT (JSON, exact shape):\n` +
              `{ "questions": [ { "id": "r2_[descriptive_id]", "text": "...", "options": [ { "label": "...", "value": "..." } ], "allow_free_text": false } ] }\n\n` +
              `RULES: Exactly 5 questions. 2-4 options each. Values in snake_case. Plain conversational English in the text field, like a real intake specialist would ask. Every question must be fully distinct from Round 1 entities and from each other.`;

            try {
              const r2Completion = await openai.chat.completions.create({
                model: intakeModel,
                temperature: 0,
                max_tokens: 2048,
                response_format: { type: "json_object" },
                reasoning_effort: "none", // Gemini 2.5 thinking off
                messages: [
                  { role: "system", content: r2SystemPrompt },
                  { role: "user", content: "Generate the 5 Round 2 questions now." },
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
              // Fall through  -  return collect_identity with r1Cpi below
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
        // Fires when Round 2 answers have just been submitted (widgetRound2Started=true).
        // After R2, any firm-set refinement questions that remain unasked are ignored —
        // R2's GPT deep-dive replaces the static refinement set, so serving priority-3
        // firm questions now would be a duplicate third round (which the widget would
        // label "Round 3 - 2 additional questions"). Treat refinement-after-R2 as identity.
        //
        // Calls GPT with a lean prompt to recompute value_score components using the full
        // entity set (R1 + R2). Fit components (geo, practice, legitimacy, referral) are
        // locked from the initial classification and never change.
        // On failure, falls through and uses the existing CPI.
        if (widgetRound2Started && (batch.phase === "identity" || batch.phase === "refinement")) {
          const entityLines = Object.entries(updatedConfirmed)
            .filter(([k]) => !k.startsWith("_"))
            .map(([k, v]) => `  ${k}: ${v}`)
            .join("\n") || "  (none recorded)";

          // Use the full scoring engine (no question sets)  -  ~8K tokens, covers all PA rules
          let reScoringPrompt = buildSystemPrompt(firmConfig, "widget", { includeQuestionSets: false });
          reScoringPrompt +=
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            `\nFINAL RE-SCORING PASS  -  override all channel instructions\n` +
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
              model: intakeModel,
              temperature: 0,
              max_tokens: 2048,
              response_format: { type: "json_object" },
              reasoning_effort: "none", // Gemini 2.5 thinking off
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

              // Lock fit components  -  they never change from R2 answers
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
            // Fall through  -  user still gets identity step with baseline CPI
          }
        }

        // After R2 has started, the firm-set refinement phase is exhausted from the
        // widget's perspective — R2's GPT deep-dive replaces it. Collapse any remaining
        // firm-set batch into identity so the user never sees a "Round 3" of duplicates.
        const postRound2Identity = widgetRound2Started;
        const nextQuestions = (batch.phase !== "identity" && !postRound2Identity) ? batch.questions : null;
        const collectIdentity = batch.phase === "identity" || postRound2Identity;

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
      // else: first call  -  no questions, classification-only prompt
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

    // Inject canonical intent state (stage_of_engagement, incident_timing, etc.)
    // populated by the kickoff intent extractor. The AI uses stage_of_engagement
    // to decide whether to lead with foundational or transactional questions.
    if (Object.keys(mergedIntentsEarly).length > 0) {
      const intentLines = Object.entries(mergedIntentsEarly)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join("\n");
      systemPrompt +=
        `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
        `\nSESSION STATE: INTENT MAP (canonical facts mined from kickoff)\n` +
        intentLines +
        `\n\nThese facts were extracted from the prospect's situation text. Use them to:\n` +
        `(1) NEVER re-ask a question whose answer is already in this map.\n` +
        `(2) Decide whether to lead with foundational or transactional questions per the FOUNDATIONAL FIRST-QUESTION rule.\n` +
        `(3) Apply scoring deltas immediately based on these values where applicable.`;
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

    // ── Slot Extraction Block  -  S10.2 ────────────────────────────────────────────
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
            `If nothing can be extracted with confidence, return filled_slots: {} and slot_confidence: {}.\n\n` +
            `ADDITIONALLY, return "implied_question_ids": [...] at top level.\n` +
            `List any slot IDs from above where the client has CLEARLY answered the TOPIC in free text, even if no exact option value maps. Example: "I didn't go to the hospital" clearly answers a medical-treatment question at the topic level (the client is saying "no") even when the option values are about timing. Including an ID here will suppress the question without binding a value. Use this sparingly: only when re-asking would be a redundancy trap. Return [] if none apply.`;
        }
      }
    }

    // ── Round 2 state  -  read from session scoring JSONB ─────────────────────────
    const sessionScoringRaw = (session.scoring as Record<string, unknown>) ?? {};
    const round2Started = !!sessionScoringRaw._round_2_started;
    const round2QCount = (sessionScoringRaw._round_2_q_count as number) ?? 0;
    let startingRound2 = false; // set to true when this turn triggers Round 2

    // ── Slot registry state  -  read from session scoring JSONB ────────────────────
    // _slot_round: current round (1/2/3). Null = slot system not yet active.
    // _slot_answered: accumulated map of slot ID → answer value(s) across all turns.
    const slotRound = (sessionScoringRaw._slot_round as 1 | 2 | 3 | null) ?? null;
    const slotAnswered = (sessionScoringRaw._slot_answered as Record<string, string | string[]>) ?? {};
    let updatedSlotAnswered: Record<string, string | string[]> = { ...slotAnswered };
    let slotRoundUpdated: 1 | 2 | 3 = slotRound ?? 1;

    // ── Determine whether a slot bank is active for the current sub-type ─────────
    // hasSlotBankActive gates the slot injection path below and suppresses the
    // question-set injection so GPT does not receive two competing question lists.
    const sessionSubTypeSlotInject = (session.practice_sub_type as string | null) ?? null;
    const hasSlotBankActive = sessionSubTypeSlotInject
      ? (SLOTS_BY_SUBTYPE.get(sessionSubTypeSlotInject)?.length ?? 0) > 0
      : false;

    // ── For conversational channels: tell GPT exactly which question to ask next ──
    // This prevents GPT from picking questions arbitrarily and eliminates repeats.
    if (channel !== "widget" && sessionPracticeArea && !hasSlotBankActive) {
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
          // Round 1 complete, Band A or B  -  start adaptive Round 2 deep-dive
          startingRound2 = true;
          const entitySummary = Object.entries(allCollected)
            .filter(([k]) => !k.startsWith("_"))
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          systemPrompt +=
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            `\nROUND 2: ADAPTIVE DEEP-DIVE (5 questions total)\n` +
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
        } else if (round2Started && round2QCount < 4) {
          // Round 2 in progress  -  ask one more adaptive question (cap at 5 total = indices 0,1,2,3,4)
          const entitySummary = Object.entries(allCollected)
            .filter(([k]) => !k.startsWith("_"))
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          systemPrompt +=
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            `\nROUND 2 CONTINUING (question ${round2QCount + 1} of 5)\n` +
            `Collected so far: ${entitySummary}\n\n` +
            `Ask ONE more targeted follow-up question on a dimension not yet covered. Use a "r2_" prefixed ID.\n` +
            `Set finalize=false, collect_identity=false.`;
        } else {
          // All done  -  Round 1 only (Band C/D/E) or Round 2 complete
          systemPrompt +=
            `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
            `\nAll intake questions have been answered. Set collect_identity=true in your response.`;
        }
      }
    }

    // ── Slot registry question injection  -  Phase 3B ───────────────────────────────
    // Mutually exclusive with the question-set injection above (hasSlotBankActive gates both).
    // Slot system activates on turn 2: sub_type is written to session on turn 1 from the GPT
    // response, so sessionSubTypeSlotInject is populated from turn 2 onward.
    // Round 1 (6 slots): unconditional qualifying questions, injected verbatim.
    // Round 2 (5 slots): dependency-filtered, GPT selects the best one from the list.
    // Round 3 (all slots): triggered by shouldTriggerRound3()  -  damages / severity depth.
    if (channel !== "widget" && sessionPracticeArea && hasSlotBankActive && sessionSubTypeSlotInject) {
      const currentRound = slotRoundUpdated;
      const sessionIntents = ((session.scoring as Record<string, unknown>)?._intents as Record<string, string>) ?? {};
      const slotsToAsk = selectSlots(sessionSubTypeSlotInject, slotAnswered, currentRound, updatedConfirmed, sessionIntents);

      if (slotsToAsk.length > 0) {
        const slotLines = slotsToAsk.map(slot => {
          const optionText = slot.options
            ? slot.options.map(o => `${o.value}: "${o.label}"`).join(" | ")
            : "(free text)";
          const preambleLine = slot.preamble ? `\n    Note: ${slot.preamble}` : "";
          return `  [${slot.id}] ${slot.question}${preambleLine}\n    Options: ${optionText}`;
        }).join("\n\n");

        systemPrompt +=
          `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
          `\nSLOT QUESTIONS  -  Round ${currentRound} (${sessionSubTypeSlotInject})\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Ask the FIRST slot question listed below that has not yet been answered. ` +
          `Ask it conversationally in response_text.\n` +
          `Also scan ALL prior client messages: if any earlier message already answers a slot, ` +
          `extract the value now without asking again.\n` +
          `Use the exact slot ID and exact option value when extracting.\n\n` +
          slotLines +
          `\n\nQUESTION LANGUAGE: When returning these questions in next_questions, rewrite each "text" field to be short and conversational. Plain English, like a real person asking. Keep IDs, option values, and complexity_delta unchanged. Only the text field changes. Examples: "What is the nature of the debt?" → "What kind of debt is this?"; "When did the debt become due and payable?" → "When was the money supposed to be paid back?"; "Were you an employee, not a contractor or freelancer?" → "Were you hired as an employee, not a contractor?"\n\n` +
          `Return at top level:\n` +
          `  "filled_slots": { "slot_id": "option_value" }\n` +
          `  "slot_confidence": { "slot_id": "high" | "medium" | "low" }\n` +
          `Only include HIGH or MEDIUM confidence extractions from prior messages. Never guess.\n` +
          `Set finalize=false, collect_identity=false.`;
      } else {
        // All slots for this round have been answered  -  advance
        systemPrompt +=
          `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
          `\nAll Round ${currentRound} qualification questions for ${sessionSubTypeSlotInject} ` +
          `have been collected. Set collect_identity=true, finalize=false.`;
      }
    }

    // ── First-turn compact slot extraction  -  S10.5 ───────────────────────────────
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
        `Return at top level: "filled_slots": { "question_id": "option_value" } and "slot_confidence": { "question_id": "high"|"medium" }\n` +
        `Also return "implied_question_ids": [...] listing any IDs above where the client CLEARLY answered the topic in free text even if no option value maps (e.g. "didn't go to hospital" implies pi_q17). Return [] if none.`;
    }

    // ── LLM question rewrite / resolve / suppress  -  candidate pool ──────────────
    // When the feature flag is active and we have a sub-type (turn 2+ widget),
    // compute the remaining candidate pool. The rewrite is then fired as a
    // separate GPT call in parallel with the main screening call (see below),
    // using OpenAI structured outputs so the payload shape is schema-enforced.
    // Question IDs and option values are frozen so scoring stays deterministic.
    // On turn 1 the sub-type is not yet known, so the event extractor and
    // compact schema handle the first question; rewrite kicks in from turn 2.
    const rewriteMode = getRewriteMode();
    let rewriteCandidates: Question[] = [];
    let rewriteSubType: string | null = null;
    if (
      rewriteMode !== "off" &&
      channel === "widget" &&
      sessionPracticeArea
    ) {
      rewriteSubType = (session.practice_sub_type as string | null) ?? null;
      const rewriteQSetKey = resolveQuestionSetKey(sessionPracticeArea, rewriteSubType);
      const rewriteQuestionSet =
        firmConfig.question_sets[rewriteQSetKey] ??
        firmConfig.question_sets[sessionPracticeArea] ??
        Object.values(firmConfig.question_sets).find(
          qs => qs.practice_area_id === sessionPracticeArea,
        ) ??
        null;

      if (rewriteQuestionSet && rewriteQuestionSet.questions.length > 0) {
        // Use allCollected (existing entities + structured data this turn) so we
        // never ask GPT to classify questions the client has already answered.
        rewriteCandidates = candidatesFromQuestionSet(
          rewriteQuestionSet.questions,
          allCollected,
        );
      }
    }

    // ── Inject compliance gate questions ─────────────────────────────
    // Active flags drive mandatory questions that must be asked before standard
    // qualification. Gate questions are ordered S1 before S2; only unasked ones
    // are injected (checked against allCollected). Capped at 3 per turn to avoid
    // overwhelming the client on turn 1. S1 flags get a critical escalation note.
    if (activeComplianceFlags.length > 0) {
      // On turn 1, sessionPracticeArea is null. Infer PA from message text for textByPA resolution.
      const paHint = sessionPracticeArea ?? (
        /\b(deport(ed|ation)?|immigr|visa|refugee|citizenship|sponsor|inadmissib|removal order|work permit|permanent resident)\b/i.test(message) ? "immigration" :
        /\b(fired|terminat|laid off|wrongful dismissal|constructive dismissal|severance|employment)\b/i.test(message) ? "employment" :
        /\b(accident|car crash|collision|slip|fall|injury|injured)\b/i.test(message) ? "pi" :
        /\b(divorce|separation|custody|child support|spousal|family court)\b/i.test(message) ? "family" :
        /\b(charged|arrested|criminal|bail|offence|DUI|assault)\b/i.test(message) ? "criminal" :
        undefined
      );
      const gateQuestions = getGateQuestions(activeComplianceFlags, paHint ?? undefined);
      const unaskedGate = gateQuestions.filter(q => !(q.id in allCollected));
      if (unaskedGate.length > 0) {
        const gateLines = unaskedGate
          .slice(0, 3)
          .map((q, i) => `  ${i + 1}. [${q.id}] ${q.text}`)
          .join("\n");
        const criticalNote = hasCriticalFlag(activeComplianceFlags)
          ? `\n\nCRITICAL: One or more flags represent potential malpractice exposure or a time-sensitive deadline. These MUST be asked before any other qualification question.`
          : "";
        // S1 preamble  -  one authored sentence to open the gate question block.
        // Tells the client why we're asking. Never generated; sourced from S1_PREAMBLES.
        const gatePreamble = getFlagPreamble(activeComplianceFlags);
        systemPrompt +=
          `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` +
          `\nCOMPLIANCE FLAGS  -  MANDATORY GATE QUESTIONS\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          (gatePreamble
            ? `Open your response with this sentence (verbatim): "${gatePreamble}" Then ask the following question. IMPORTANT: do not use vague pronouns like "that" or "it"  -  replace them with the specific event the client named (e.g. "the deportation", "the termination", "the accident"). Ask:\n\n`
            : `These compliance signals were detected in the conversation. Ask the following questions before standard qualification questions. Replace any vague pronouns ("that", "it", "this") with the specific event the client described. Integrate naturally:\n\n`) +
          gateLines +
          criticalNote +
          `\n\nOnce these are answered, resume normal scoring and question flow. ` +
          `Store answers in extracted_entities using the question ID as the key.`;
      }
    }

    // ── Classifier: parallel call on turn 1 ──────────────────────────
    // Runs alongside the main GPT call  -  zero added latency.
    // Provides semantic flag detection for signals that regex cannot catch:
    //   "I've been fighting internally for months" → ltd_appeal_clock_running
    //   "my brother handles everything for mom"   → estates_undue_influence
    //   "I signed papers before calling a lawyer" → emp_severance_signed
    // Only fires on turn 1 when no practice area has been established yet.
    // Failures are caught and treated as null  -  never blocks the main response.
    const userTurnCount = conversation.filter(m => m.role === "user").length;
    const classifierPromise: Promise<ClassifierResult | null> =
      !sessionPracticeArea && userTurnCount <= 1
        ? classify(openai, {
            firmPracticeAreas: firmConfig.practice_areas,
            conversationText: allUserText,
            channel,
          }, MODELS.CLASSIFIER).catch(err => {
            console.error("[classifier] Non-fatal failure:", err);
            return null;
          })
        : Promise.resolve(null);

    // ── Rewrite model: dedicated parallel call ────────────────────────
    // The rewrite job (classify each candidate into resolved / suppressed /
    // to-ask, rewrite surface text to anchor on the client's words) is
    // isolated into its own GPT call. Running it inline in the main
    // screening prompt made gpt-4o-mini reliably return empty arrays; the
    // isolated call uses OpenAI structured outputs, so the response shape
    // is schema-enforced.
    // Returns null on any failure (network, parse, abort, timeout); the
    // intake never breaks because the rewrite call failed.
    const rewritePromise: Promise<RewriteCallResult | null> =
      rewriteMode !== "off" && rewriteCandidates.length > 0
        ? callRewriteModel({
            candidates: rewriteCandidates,
            subType: rewriteSubType,
            situation: situationText,
            history: conversation.slice(-6) as RewriteTurn[],
            client: openai,
            model: intakeModel,
          })
        : Promise.resolve(null);

    // ── Call GPT (main) ───────────────────────────────────────────────
    // Runs in parallel with the classifier and rewrite calls above.
    // Falls back to OpenRouter (gpt-4o-mini) on transient Google AI 5xx errors
    // so a momentary overload never surfaces as a user-visible 500.
    const mainMessages = [
      { role: "system" as const, content: systemPrompt },
      ...conversation.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    ];
    const mainCallPromise = openai.chat.completions.create({
      model: intakeModel,
      temperature: 0, // deterministic scoring
      max_tokens: 2048,
      response_format: { type: "json_object" },
      reasoning_effort: "none", // Gemini 2.5 thinking off  -  intake is classification + structured extraction
      messages: mainMessages,
    }).catch(async (err: unknown) => {
      const status = (err as { status?: number }).status;
      if (status === 503 || status === 502 || status === 529) {
        console.warn("[screen] Google AI returned", status, "- falling back to OpenRouter:", MODELS.FALLBACK);
        return openrouter.chat.completions.create({
          model: MODELS.FALLBACK,
          temperature: 0,
          max_tokens: 2048,
          response_format: { type: "json_object" },
          messages: mainMessages,
        });
      }
      throw err;
    });

    const [completion, classifierResult, rewriteCallResult] = await Promise.all([
      mainCallPromise,
      classifierPromise,
      rewritePromise,
    ]);

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

    // ── Merge GPT-extracted slots into confirmed answers  -  S10.2 ─────────────────
    // GPT returns filled_slots (question_id → option_value) from scanning free text.
    // Only high and medium confidence extractions are auto-confirmed.
    // Low confidence slots are discarded  -  better to ask than to guess.
    // Slot-registry IDs (containing "__") are handled separately below  -  they go into
    // updatedSlotAnswered, not updatedConfirmed, to keep the two systems isolated.
    if (gptResponse.filled_slots && Object.keys(gptResponse.filled_slots).length > 0) {
      const confidence = gptResponse.slot_confidence ?? {};
      for (const [slotId, slotValue] of Object.entries(gptResponse.filled_slots)) {
        if (slotId.includes("__")) continue; // slot-registry IDs handled below
        const conf = confidence[slotId] ?? "medium"; // default to medium if not specified
        if (conf === "high" || conf === "medium") {
          updatedConfirmed[slotId] = slotValue;
        }
      }
    }

    // ── Merge LLM-inferred implied question IDs  -  topic-level redundancy ─────────
    // The LLM flags questions whose TOPIC is answered in free text but where no
    // option value maps cleanly (e.g. "I didn't go to the hospital" answers a
    // medical-treatment question at the topic level).
    // Stored with a sentinel value so selectNextQuestions sees them as confirmed
    // and filters them out. Regex inference in question-selector is the safety net.
    if (Array.isArray(gptResponse.implied_question_ids) && gptResponse.implied_question_ids.length > 0) {
      for (const qId of gptResponse.implied_question_ids) {
        if (typeof qId === "string" && qId.length > 0 && !qId.includes("__") && !(qId in updatedConfirmed)) {
          updatedConfirmed[qId] = "__implied__";
        }
      }
    }

    // ── LLM rewrite: apply resolved + suppressed, stash rewrite map ───────────────
    // Feature-flagged via LLM_QUESTION_REWRITE. The payload comes from the
    // dedicated parallel call (rewriteCallResult) fired above. In "shadow" mode
    // the decisions are logged but never applied. In "on" mode, resolved_questions
    // write real option values to updatedConfirmed (gated by confidence >= 0.8 +
    // option value check), suppressed_questions write the __implied__ sentinel,
    // and the rewrite map is overlaid onto next_questions later.
    // When the rewrite call failed or returned null, this block is a no-op.
    const rewriteTextMap = new Map<string, string>();
    if (
      rewriteMode !== "off" &&
      rewriteCandidates.length > 0 &&
      rewriteCallResult !== null
    ) {
      const rewritePayload = rewriteCallResult.payload;
      const candidateIds = new Set(rewriteCandidates.map(q => q.id));

      if (rewriteMode === "on") {
        const resolveResult = applyResolvedQuestions(
          rewritePayload.resolved_questions,
          rewriteCandidates,
          updatedConfirmed,
        );
        const suppressResult = applySuppressedQuestions(
          rewritePayload.suppressed_questions,
          rewriteCandidates,
          updatedConfirmed,
        );
        const rewriteResult = buildRewriteMap(
          rewritePayload.questions_to_ask,
          candidateIds,
        );
        for (const [id, text] of rewriteResult.map) rewriteTextMap.set(id, text);

        console.info("[llm-rewrite] mode=on", {
          session_id: session.id,
          sub_type: (session.practice_sub_type as string | null) ?? null,
          candidates: rewriteCandidates.length,
          model: rewriteCallResult.model,
          resolved_applied: resolveResult.applied,
          suppressed_applied: suppressResult.applied,
          rewrites_applied: rewriteTextMap.size,
          resolved_log: resolveResult.log,
          suppressed_log: suppressResult.log,
          rewrite_log: rewriteResult.log,
        });
      } else {
        // shadow mode  -  compute everything into a scratch map and log, never mutate
        const scratchConfirmed = { ...updatedConfirmed };
        const resolveResult = applyResolvedQuestions(
          rewritePayload.resolved_questions,
          rewriteCandidates,
          scratchConfirmed,
        );
        const suppressResult = applySuppressedQuestions(
          rewritePayload.suppressed_questions,
          rewriteCandidates,
          scratchConfirmed,
        );
        const rewriteResult = buildRewriteMap(
          rewritePayload.questions_to_ask,
          candidateIds,
        );

        console.info("[llm-rewrite] mode=shadow (no-op)", {
          session_id: session.id,
          sub_type: (session.practice_sub_type as string | null) ?? null,
          candidates: rewriteCandidates.length,
          model: rewriteCallResult.model,
          resolved_would_apply: resolveResult.applied,
          suppressed_would_apply: suppressResult.applied,
          rewrites_would_apply: rewriteResult.map.size,
          resolved_log: resolveResult.log,
          suppressed_log: suppressResult.log,
          rewrite_log: rewriteResult.log,
        });
      }
    }

    // ── Slot registry answer accumulation  -  Phase 3B ──────────────────────────────
    // Collect slot-registry answers (IDs with "__") from filled_slots into
    // updatedSlotAnswered and advance the slot round as answers accumulate.
    // Round 1→2: when no round-1 slots remain for the sub-type.
    // Round 2→3: when any answered option carries triggersRound3: true.
    if (gptResponse.filled_slots && Object.keys(gptResponse.filled_slots).length > 0) {
      const slotConf = gptResponse.slot_confidence ?? {};
      const slotSubTypeForAccum =
        gptResponse.practice_sub_type ?? (session.practice_sub_type as string | null) ?? null;

      for (const [slotId, slotValue] of Object.entries(gptResponse.filled_slots)) {
        if (!slotId.includes("__")) continue; // only slot-registry IDs
        const conf = slotConf[slotId] ?? "medium";
        if (conf === "high" || conf === "medium") {
          updatedSlotAnswered[slotId] = slotValue;
        }
      }

      // Round advancement (only when slot answers actually arrived this turn)
      if (Object.keys(updatedSlotAnswered).length > Object.keys(slotAnswered).length && slotSubTypeForAccum) {
        if (slotRoundUpdated === 1) {
          const sessionIntents = ((session.scoring as Record<string, unknown>)?._intents as Record<string, string>) ?? {};
          const remainingR1 = selectSlots(slotSubTypeForAccum, updatedSlotAnswered, 1, updatedConfirmed, sessionIntents);
          if (remainingR1.length === 0) {
            slotRoundUpdated = 2;
            console.info("[slots] Round 1 complete  -  advancing to Round 2");
          }
        }
        if (slotRoundUpdated === 2 && shouldTriggerRound3(updatedSlotAnswered)) {
          slotRoundUpdated = 3;
          console.info("[slots] Round 3 triggered  -  high-value signals detected");
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

    // ── Refine compliance flags now that PA is confirmed ────────────
    // On turn 1, PA was unknown during flag detection so only universal flags fired.
    // Re-run with the freshly classified practice_area to pick up PA-specific flags
    // (e.g. slip_ice_snow for pi, fam_abduction for fam, mvac_insurer_not_notified).
    // The refined set is stored in scoringPayload below; it feeds future turns' injection.
    if (gptResponse.practice_area && !sessionPracticeArea) {
      const refinedFlags = detectFlags(allUserText, gptResponse.practice_area);
      activeComplianceFlags = mergeFlags(activeComplianceFlags, refinedFlags);
    }

    // ── Merge semantic flags from classifier ─────────────────────────
    // classifierResult is the parallel turn-1 classifier output (may be null if not
    // triggered, or if the call failed and was caught above).
    // Its flags cover semantic signals that regex patterns cannot reliably detect.
    // Merged after PA refinement so the final set is maximally complete before storage.
    if (classifierResult) {
      // Merge semantic flags (classifier.flags is already validated against registry)
      if (classifierResult.flags.length > 0) {
        activeComplianceFlags = mergeFlags(activeComplianceFlags, classifierResult.flags);
      }

      // Handle classifier out-of-scope signal.
      // Only override the main GPT response when the classifier is high-confidence
      // AND neither the main GPT nor the firm config has a matching PA.
      // Low/medium confidence out-of-scope is ignored  -  main GPT result prevails.
      if (
        classifierResult.out_of_scope &&
        classifierResult.confidence === "high" &&
        !sessionPracticeArea &&
        !gptResponse.finalize
      ) {
        const classifierPA = classifierResult.practice_area;
        const paInFirmConfig = classifierPA
          ? firmConfig.practice_areas.find(a => a.id === classifierPA)
          : null;
        const isConfirmedOutOfScope =
          !classifierPA || paInFirmConfig?.classification === "out_of_scope";

        if (isConfirmedOutOfScope) {
          gptResponse.finalize = true;
          gptResponse.collect_identity = false;
          gptResponse.next_question = null;
          gptResponse.next_questions = null;
          if (gptResponse.cpi) {
            gptResponse.cpi.band = "E";
            gptResponse.cpi.total = Math.min((gptResponse.cpi.total as number) ?? 15, 15);
          }
          if (!gptResponse.response_text) {
            gptResponse.response_text =
              "Based on what you've shared, this matter may fall outside our current practice areas. We encourage you to seek appropriate legal help.";
          }
          console.info(
            "[classifier] High-confidence out-of-scope override applied:",
            classifierResult.reasoning,
          );
        }
      }
    }

    // ── Classifier low-confidence disambiguation ──────────────────────
    // When the classifier cannot resolve a PA (confidence=low, PA=null, not out-of-scope),
    // we override the main GPT response with one short disambiguation question rather
    // than letting GPT guess and generate irrelevant qualification questions.
    // Turn 2 re-runs the classifier with the combined text, which should resolve the PA.
    if (
      classifierResult?.needs_clarification &&
      !sessionPracticeArea &&
      !gptResponse.practice_area &&
      !gptResponse.finalize
    ) {
      const clarifyQ = classifierResult.clarification_prompt ??
        "Could you share a bit more about your situation so I can point you to the right help?";
      gptResponse.response_text = clarifyQ;
      gptResponse.next_question = null;
      gptResponse.next_questions = null;
      console.info("[classifier] Low-confidence PA  -  requesting disambiguation on turn 1.");
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
        const regexResult = detectSubType(gptResponse.practice_area, situationText)?.subType ?? null;
        console.warn(
          `[sub-type] conflict: regex=${regexResult} gpt=${resolvedSubType} → using GPT`,
        );
        // Log conflict to Supabase for monitoring (fire-and-forget, don't block response).
        // Uses the service-role key path  -  inserts from the anon client will be rejected by
        // RLS but the error is swallowed intentionally: telemetry must never block the session.
        const situationHash = require("crypto")
          .createHash("sha256")
          .update(situationText.substring(0, 500))
          .digest("hex") as string;
        void supabase
          .from("sub_type_conflicts")
          .insert({
            session_id: session.id,
            firm_id: firm_id,
            practice_area: gptResponse.practice_area,
            regex_result: regexResult,
            gpt_result: gptResponse.practice_sub_type,
            situation_hash: situationHash,
            app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
          });
      }
    } else if (existingSubType) {
      // Keep the existing sub-type (locked after first classification)
      gptResponse.practice_sub_type = existingSubType;
    }

    // ── Umbrella → sub-type ID remap ───────────────────────────────────
    // The first-turn compact schema uses umbrella PA IDs (e.g. "pi_q17") because
    // sub-type is not yet known when the prompt is built. After sub-type resolution,
    // translate umbrella-scoped keys in updatedConfirmed to the actual bank IDs
    // served by the widget (e.g. "pi_q17" → "pi_mva_q17" when sub-type is "pi_mva").
    // Without this, LLM-extracted answers never match the served questions and the
    // widget re-asks them.
    const resolvedSubTypeForRemap = gptResponse.practice_sub_type ?? existingSubType ?? null;
    const umbrellaPA = gptResponse.practice_area ?? null;
    if (resolvedSubTypeForRemap && umbrellaPA && resolvedSubTypeForRemap.startsWith(`${umbrellaPA}_`)) {
      const umbrellaPrefix = `${umbrellaPA}_q`;
      const subTypePrefix = `${resolvedSubTypeForRemap}_q`;
      for (const key of Object.keys(updatedConfirmed)) {
        if (key.startsWith(umbrellaPrefix) && !key.startsWith(subTypePrefix)) {
          const suffix = key.slice(umbrellaPrefix.length); // e.g. "17"
          const remapped = `${subTypePrefix}${suffix}`;
          if (!(remapped in updatedConfirmed)) {
            updatedConfirmed[remapped] = updatedConfirmed[key];
          }
          delete updatedConfirmed[key];
        }
      }
    }

    // Resolve the question-set key from PA + sub-type
    const questionSetKey = gptResponse.practice_area
      ? resolveQuestionSetKey(gptResponse.practice_area, gptResponse.practice_sub_type)
      : null;

    // ── Event pipeline: turn-1 sub-type detection + targeted first question ──────
    // On turn 1 (no practice_area yet on the session), run the deterministic
    // extractor. Provides a precise sub-type bank key and a targeted first question
    // before any GPT question set runs. Zero API cost. Zero hallucination surface.
    // Fixes the Walmart bug: "slipped at walmart" → slip_fall → pi_slip_fall bank,
    // not the generic PI bank that defaults to MVA questions.
    const isFirstTurn = !session.practice_area;
    const detectedEvents = isFirstTurn ? extractEvents(message) : [];
    // Intent extraction already ran synchronously near the top of the request
    // (mergedIntentsEarly + extractedNow). Reuse those values here for the
    // scoring update without re-extracting.
    const intentExtractionPromise: Promise<{ intents: Record<string, string>; situation_summary: string | null }> =
      Promise.resolve(extractedNow);
    const selectedEvent = detectedEvents.length > 0 ? selectEvent(detectedEvents) : null;
    const eventDerivedSubTypeKey = selectedEvent ? mapEventToSubType(selectedEvent.type) : null;
    const sameTypeEvents = selectedEvent
      ? detectedEvents.filter(e => e.type === selectedEvent.type)
      : [];
    // Distinctness gate: a client mentioning "car accident" twice in one message
    // does NOT mean there were two accidents. Only treat same-type events as
    // distinct when we have an affirmative signal:
    //   (a) at least two events carry DIFFERENT resolved time triggers, OR
    //   (b) the message contains explicit enumeration / multiplicity language
    //       ("first", "second", "another", "separate", "two accidents",
    //        "both accidents", "earlier accident", "previous accident", etc.)
    // Without either, collapse to a single event and skip the disambiguation.
    const hasDistinctTimes = (() => {
      const times = sameTypeEvents
        .map(e => (e.time ? e.time.toLowerCase().trim() : null))
        .filter((t): t is string => t !== null);
      return new Set(times).size >= 2;
    })();
    const enumerationSignal = /\b(first|second|third|another|other|separate|two|three|four|multiple|both|earlier|previous|prior)\s+(accident|accidents|crash|crashes|collision|collisions|incident|incidents|fall|falls|termination|firing|situation|situations)\b|\b(accidents|crashes|collisions|incidents|falls|terminations|firings)\b/i.test(message);
    const treatAsMultiInstance = sameTypeEvents.length > 1 && (hasDistinctTimes || enumerationSignal);
    const eventFirstQuestion = selectedEvent
      ? generateQuestion(selectedEvent, treatAsMultiInstance ? sameTypeEvents : undefined)
      : null;
    const eventFirstPreamble = selectedEvent
      ? generatePreamble(selectedEvent, treatAsMultiInstance ? sameTypeEvents : undefined)
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

    // Warn only after floors are applied  -  a zero here is a genuine miss.
    if (gptResponse.cpi.practice_score > 0 && gptResponse.cpi.complexity_score === 0 && gptResponse.cpi.fee_score === 0) {
      console.warn("[cpi] Floors applied but value score still zero  -  check GPT scoring for PA:", gptResponse.practice_area);
    }

    // ── Slot CPI delta application  -  Phase 3B ────────────────────────────────────
    // Slot deltas are additive adjustments to the three normalized CPI axes
    // (cpi_fit, cpi_urgency, cpi_friction). Applied AFTER validateAndFixScoring() so
    // they layer on top of GPT's base scoring without interfering with raw component math.
    // Band modifiers are re-applied to the adjusted axes to ensure urgency promotion
    // and friction floor fire correctly on the final axis values.
    if (Object.keys(updatedSlotAnswered).length > 0) {
      const slotDelta = scoreFromSlotAnswers(updatedSlotAnswered);
      if (slotDelta.fit !== 0 || slotDelta.urgency !== 0 || slotDelta.friction !== 0) {
        gptResponse.cpi.cpi_fit      = Math.min(100, Math.max(0, gptResponse.cpi.cpi_fit + slotDelta.fit));
        gptResponse.cpi.cpi_urgency  = Math.min(100, Math.max(0, gptResponse.cpi.cpi_urgency + slotDelta.urgency));
        gptResponse.cpi.cpi_friction = Math.min(100, Math.max(0, gptResponse.cpi.cpi_friction + slotDelta.friction));

        // Re-apply band modifiers on the adjusted axes (mirrors validateAndFixScoring logic)
        if (!gptResponse.cpi.band_locked) {
          if (gptResponse.cpi.cpi_urgency >= 75 && gptResponse.cpi.total >= 55 && gptResponse.cpi.band !== "A") {
            gptResponse.cpi.band = "A";
          }
          if (gptResponse.cpi.cpi_friction >= 80 && (gptResponse.cpi.band === "A" || gptResponse.cpi.band === "B")) {
            gptResponse.cpi.band = "D";
          }
        }
      }
    }

    // ── Out-of-scope gate ─────────────────────────────────────────────
    // If the identified practice area is marked out_of_scope in the firm config,
    // finalize immediately with Band E  -  do not collect identity or ask questions.
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

        // Dynamic question selection  -  S10.3 + band_locked short-circuit  -  S10.4
        // Use questionSetKey (sub-type) as the schema lookup key so priority weights
        // are drawn from the correct sub-type slot schema.
        // On turn 1, event-derived sub-type takes precedence for slot schema lookup.
        const gpBand = gptResponse.cpi.band ?? "C";
        const gpBandLocked = gptResponse.cpi.band_locked ?? false;
        const slotLookupKey = (isFirstTurn && eventDerivedSubTypeKey)
          ? eventDerivedSubTypeKey
          : (questionSetKey ?? paId ?? "");
        const postGptBatch = gpBandLocked
          ? { questions: [], phase: "identity" as const }
          : selectNextQuestions(questionSet.questions, slotLookupKey, updatedConfirmed, gpBand, situationText);

        if (postGptBatch.phase !== "identity") {
          // Prepend the event-derived first question on turn 1 when available.
          // It is a free-text question targeting the specific information gap the
          // extractor identified (e.g. WHEN for slip_fall, written agreement for debt).
          const bankQuestions = postGptBatch.questions;
          const eventQ = (eventFirstQuestion && isFirstTurn)
            ? [{
                id: `event_q_${selectedEvent!.type}`,
                text: eventFirstQuestion,
                options: [] as Array<{ label: string; value: string }>,
                allow_free_text: true as const,
                ...(eventFirstPreamble ? { description: eventFirstPreamble } : {}),
              }]
            : [];
          // De-duplicate: when the bank already has a structured question covering the
          // same topic as the event question, suppress the event question (free-text)
          // and let the bank version (with clickable options) serve instead.
          // Rule: no free-text questions in Round 1 when a structured equivalent exists.
          const eventQTextNorm = eventFirstQuestion?.trim().toLowerCase() ?? "";
          const bankCoversEventTopic = eventFirstQuestion
            ? bankQuestions.some(bq => bq.text.trim().toLowerCase() === eventQTextNorm)
            : false;
          const filteredEventQ = bankCoversEventTopic ? [] : eventQ;
          gptResponse.next_questions = [...filteredEventQ, ...bankQuestions];
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

      // Final safety net: strip implied or already-confirmed questions from
      // next_questions regardless of which branch populated it. Covers two leaks:
      //   (a) questionSet lookup misses (firm PA id ↔ question_set key mismatch)  -
      //       GPT next_questions pass through without selectNextQuestions filtering.
      //   (b) else-if fallback promotes next_question without filtering.
      // selectNextQuestions applies the same filter on the primary path, so this
      // is a no-op there.
      if (Array.isArray(gptResponse.next_questions) && gptResponse.next_questions.length > 0) {
        const pool = gptResponse.next_questions as unknown as Question[];
        const impliedFromText = inferImpliedAnswers(situationText, pool);
        const filtered = pool.filter(
          q => !(q.id in updatedConfirmed) && !impliedFromText.has(q.id),
        );
        if (filtered.length === 0) {
          gptResponse.next_questions = null;
          gptResponse.collect_identity = true;
        } else if (filtered.length < pool.length) {
          gptResponse.next_questions = filtered as typeof gptResponse.next_questions;
        }
      }

      // LLM rewrite overlay: replace canonical text with the validated
      // rewrite for matching ids. No-op when rewriteTextMap is empty or
      // feature flag is off. Ids, options, and everything else are left alone.
      if (rewriteMode === "on" && rewriteTextMap.size > 0 && Array.isArray(gptResponse.next_questions)) {
        let overlaid = 0;
        for (const q of gptResponse.next_questions) {
          if (!q || typeof q.id !== "string") continue;
          const rewritten = rewriteTextMap.get(q.id);
          if (rewritten) {
            q.text = rewritten;
            overlaid++;
          }
        }
        if (overlaid > 0) {
          console.info("[llm-rewrite] overlaid text on next_questions", {
            session_id: session.id,
            overlaid,
            total: gptResponse.next_questions.length,
          });
        }
      }

      // Turn-1 rewrite: sequential, post-GPT, fires when the initial message is
      // rich enough (≥8 words) to anchor personalization. Uses situation text as
      // the sole anchor since there is no Q&A history on turn 1. Reuses the
      // questionSet already resolved above. Non-blocking: any failure is caught.
      if (
        isFirstTurn &&
        rewriteMode !== "off" &&
        situationText.trim().split(/\s+/).length >= 8 &&
        gptResponse.practice_area &&
        questionSet &&
        Array.isArray(gptResponse.next_questions) &&
        gptResponse.next_questions.length > 0
      ) {
        try {
          const t1Candidates = candidatesFromQuestionSet(questionSet.questions, allCollected);
          if (t1Candidates.length > 0) {
            const t1Result = await callRewriteModel({
              candidates: t1Candidates,
              subType: gptResponse.practice_sub_type ?? null,
              situation: situationText,
              history: [],
              client: openai,
              model: intakeModel,
              timeoutMs: 6000, // sequential — keep short so turn-1 latency stays reasonable
            });
            if (t1Result !== null) {
              const t1CandidateIds = new Set(t1Candidates.map(q => q.id));
              const { map: t1TextMap } = buildRewriteMap(t1Result.payload.questions_to_ask, t1CandidateIds);
              if (rewriteMode === "on" && t1TextMap.size > 0) {
                let overlaid = 0;
                for (const q of gptResponse.next_questions) {
                  if (!q || typeof q.id !== "string") continue;
                  const rewritten = t1TextMap.get(q.id);
                  if (rewritten) { q.text = rewritten; overlaid++; }
                }
                if (overlaid > 0) {
                  console.info("[llm-rewrite] turn-1 overlaid", {
                    session_id: session.id,
                    overlaid,
                    total: gptResponse.next_questions.length,
                    model: t1Result.model,
                  });
                }
              } else if (rewriteMode === "shadow") {
                console.info("[llm-rewrite] turn-1 shadow (no-op)", {
                  session_id: session.id,
                  candidates: t1Candidates.length,
                  rewrites_would_apply: t1TextMap.size,
                  model: t1Result.model,
                });
              }
            }
          }
        } catch (err) {
          console.warn("[llm-rewrite] turn-1 rewrite failed (non-fatal):", err);
        }
      }
    }

    // ── Append GPT response to conversation ──────────────────────────
    conversation.push({ role: "assistant", content: rawResponse });

    // ── Build updated session state ──────────────────────────────────
    // extracted_entities: structured key-value pairs only (question IDs + values)
    // situation_summary is stored separately at the session level, not merged here
    // value_tier and prior_experience are stored inside extracted_entities JSONB
    // (not as top-level session columns  -  those don't exist in the schema)
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
    // email, phone. These must be written to intake_sessions.contact explicitly  - 
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
    // (not as top-level columns  -  those don't exist in the schema and cause PGRST204)
    // Round 2 tracking: _round_2_started marks when Round 2 begins; _round_2_q_count
    // counts answered Round 2 questions so we can cap at 3 without relying on GPT to count.
    // Await the kickoff intent extraction (kicked off in parallel earlier).
    // Merge with any existing intents from prior turns. Subsequent turns can
    // also extract from new user messages, but for now we only run on turn 1.
    const extractedIntentsResult = await intentExtractionPromise;
    const previousIntents = ((session.scoring as Record<string, unknown>)?._intents as Record<string, string> | null) ?? {};
    const mergedIntents: Record<string, string> = { ...previousIntents, ...extractedIntentsResult.intents };

    const scoringPayload: Record<string, unknown> = {
      ...gptResponse.cpi,
      _confirmed: updatedConfirmed,
      // Canonical-key intent map  -  populated by intent-extractor.ts on turn 1.
      // R1/R2/R3 dedupe checks this BEFORE the question-id-based wildcard rules.
      // Stable across AI naming variations because keys are system-controlled.
      ...(Object.keys(mergedIntents).length ? { _intents: mergedIntents } : {}),
      ...(gptResponse.complexity_indicators ? { _complexity_indicators: gptResponse.complexity_indicators } : {}),
      ...(gptResponse.flags?.length ? { _flags: gptResponse.flags } : {}),
      // Persist compliance flags across turns  -  accumulative (S1 flags from turn 1 stay through turn 5)
      ...(activeComplianceFlags.length ? { _compliance_flags: activeComplianceFlags } : {}),
      // Classifier metadata  -  stored for observability / debugging (not used in scoring)
      ...(classifierResult ? {
        _classifier_confidence: classifierResult.confidence,
        _classifier_pa: classifierResult.practice_area,
        _classifier_flags_raw: classifierResult.gpt_flags_raw,
        ...(classifierResult.needs_clarification ? { _needs_pa_clarification: true } : {}),
      } : {}),
      // Event pipeline metadata  -  stored for observability / debugging (not used in scoring)
      // Written on turn 1 only. Inspect via Supabase: scoring->_event_* fields.
      ...(isFirstTurn && detectedEvents.length > 0 ? {
        _event_detected_types: detectedEvents.map(e => e.type),
        _event_selected: selectedEvent?.type ?? null,
        _event_sub_type_key: eventDerivedSubTypeKey ?? null,
        _event_first_question: eventFirstQuestion ?? null,
      } : {}),
      ...(startingRound2 ? { _round_2_started: true, _round_2_q_count: 0 } : {}),
      ...(round2Started ? { _round_2_started: true, _round_2_q_count: round2QCount + 1 } : {}),
      // Slot registry state  -  persisted across turns so round advancement survives session reloads
      ...(Object.keys(updatedSlotAnswered).length ? {
        _slot_answered: updatedSlotAnswered,
        _slot_round: slotRoundUpdated,
      } : {}),
    };

    // ── Resolve situation_summary with finalize-time fallback ──────────
    // GPT occasionally returns null for situation_summary even on finalize.
    // When that happens, synthesize a narrative from the first user message
    // so the operator card always shows a case story instead of a blank slot.
    let resolvedSummary: string | null =
      gptResponse.situation_summary ?? (session.situation_summary as string | null) ?? null;
    if (
      gptResponse.finalize &&
      (!resolvedSummary || resolvedSummary.trim().length < 20)
    ) {
      const firstNarrative = (
        conversation.find(m => m.role === "user")?.content ?? ""
      )
        .trim()
        .replace(/\s+/g, " ");
      if (firstNarrative.length >= 20) {
        resolvedSummary =
          firstNarrative.length > 600
            ? firstNarrative.slice(0, 597).trimEnd() + "..."
            : firstNarrative;
      }
    }

    const sessionUpdate: Record<string, unknown> = {
      conversation,
      scoring: scoringPayload,
      extracted_entities: updatedEntities,
      practice_area: gptResponse.practice_area,
      practice_sub_type: gptResponse.practice_sub_type ?? existingSubType ?? null,
      band: gptResponse.cpi.band,
      ...contactUpdate,
      ...(gptResponse.situation_summary
        ? { situation_summary: gptResponse.situation_summary }
        : gptResponse.finalize && resolvedSummary
          ? { situation_summary: resolvedSummary }
          : {}),
    };

    if (gptResponse.finalize) {
      sessionUpdate.status = "complete";

      // ── Interaction scoring + case value  -  computed once at finalize ──
      // Merge widget confirmed answers + slot-registry answered map for the
      // most complete answer set. updatedConfirmed uses question IDs which
      // are identical to slot IDs for widget sessions.
      const finalAnswers: Record<string, string> = {};
      for (const [k, v] of Object.entries(updatedSlotAnswered)) {
        if (typeof v === "string") finalAnswers[k] = v;
      }
      for (const [k, v] of Object.entries(updatedConfirmed)) {
        if (typeof v === "string") finalAnswers[k] = v;
      }

      const finalPa = (gptResponse.practice_area ?? sessionPracticeArea ?? "").toLowerCase();
      let interactionScoring: Record<string, unknown> | null = null;
      if (finalPa.startsWith("pi")) {
        const r = computeSabsUrgency(finalAnswers);
        interactionScoring = { type: "sabs_urgency", ...r };
      } else if (finalPa.startsWith("emp")) {
        const r = computeDismissalBardal(finalAnswers);
        interactionScoring = { type: "bardal", ...r };
      }

      const caseValue = finalPa
        ? estimateCaseValue(finalPa, gptResponse.cpi.total ?? 0, finalAnswers)
        : null;

      // Persist both inside the scoring JSONB column (no schema migration needed)
      if (interactionScoring) scoringPayload._interaction_scoring = interactionScoring;
      if (caseValue) scoringPayload._case_value = caseValue;
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
      const finalSubType = (sessionUpdate.practice_sub_type as string | null) ?? (session.practice_sub_type as string | null) ?? null;
      const routing = await getMatterRouting(firm_id, finalSubType).catch(() => null);
      try {
        await sendToGHL(finalSession, firm.ghl_webhook_url, routing);
        await supabase
          .from("intake_sessions")
          .update({ crm_synced: true })
          .eq("id", session.id);
      } catch (err) {
        console.error("GHL delivery failed:", err);
        // Non-fatal  -  session is saved, lead is not lost
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

    // ── First-question router (TURN 1 ONLY): deterministic question selection ──
    // Replaces the AI's first question on turn 1 when the (PA, sub_type, stage)
    // combination has an authored router entry. This was added because the AI
    // routinely defaulted to seed-bank questions that didn't match the prospect's
    // actual situation (e.g. "I want to buy a business" got the incorporation
    // seed question). The router owns this one decision; the AI still owns
    // everything else (response_text, scoring, follow-up questions, summary).
    let finalNextQuestions = gptResponse.next_questions;
    let finalNextQuestion  = gptResponse.next_question;
    if (isFirstTurnEarly && channel === "widget" && !gptResponse.finalize && !gptResponse.collect_identity) {
      const routedStage = (mergedIntentsEarly.stage_of_engagement ?? null) as string | null;
      const routedPA    = gptResponse.practice_area ?? sessionPracticeArea ?? null;
      const routedSub   = (gptResponse.practice_sub_type as string | null) ?? null;
      const { firstQuestionFor } = await import("@/lib/first-question-router");
      const routed = firstQuestionFor(routedPA, routedSub, routedStage);
      if (routed) {
        const routerQuestion = {
          id: routed.id,
          text: routed.text,
          options: routed.options,
          allow_free_text: routed.allow_free_text,
          ...(routed.description ? { description: routed.description } : {}),
        };
        // Overlay: keep the AI's other questions but force the first one to
        // be the router's pick. If the entry is "exclusive", drop AI's other
        // questions for this turn entirely so the prospect lands on a single
        // contextually-correct question.
        if (routed.exclusive) {
          finalNextQuestions = [routerQuestion];
        } else if (Array.isArray(gptResponse.next_questions) && gptResponse.next_questions.length > 0) {
          finalNextQuestions = [routerQuestion, ...gptResponse.next_questions.slice(1)];
        } else {
          finalNextQuestions = [routerQuestion];
        }
        finalNextQuestion = null;
      }
    }

    // ── Return response ───────────────────────────────────────────────
    return NextResponse.json({
      session_id: session.id,
      practice_area: gptResponse.practice_area,
      practice_area_confidence: gptResponse.practice_area_confidence,
      next_question: finalNextQuestion,
      next_questions: finalNextQuestions,
      cpi: gptResponse.cpi,
      cpi_partial: computeCpiPartial(gptResponse.cpi, gptResponse.finalize),
      response_text: gptResponse.response_text,
      finalize: gptResponse.finalize,
      collect_identity: gptResponse.collect_identity,
      situation_summary: resolvedSummary,
      extracted_entities: updatedEntities,
      questions_answered: gptResponse.questions_answered,
      complexity_indicators: gptResponse.complexity_indicators ?? null,
      value_tier: gptResponse.value_tier ?? null,
      prior_experience: gptResponse.prior_experience ?? null,
      flags: gptResponse.flags ?? [],
      cta,
      case_value: (scoringPayload._case_value as { label: string; tier: string; rationale: string } | undefined) ?? null,
    });
  } catch (err) {
    console.error("/api/screen error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
