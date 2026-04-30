/**
 * POST /api/portal/leads/[leadId]/dossier
 *
 * Phase 2: Generate (or re-generate) a GPT intelligence brief for a lead.
 * The brief contains:
 *   - engagement_label: 5-8 word summary of this lead's engagement quality
 *   - watchpoints[]:    risks, ambiguities, or concerns, each with severity + source_idx
 *   - demands[]:        what the client said they want, each with source_idx
 *   - next_step:        one specific actionable recommendation for the lawyer
 *
 * source_idx points into the full conversation array (0-based, all turns).
 * This enables Phase 3 click-to-highlight in the transcript.
 *
 * Auth: request body must include firmId. We verify lead.law_firm_id === firmId
 * as the ownership check (the portal session cookie is scoped to /portal path
 * and not sent to /api routes — firmId + leadId together form a sufficient
 * shared secret since both are UUIDs with 128-bit entropy and are only shown
 * to authenticated portal users).
 *
 * Result is persisted to intake_sessions.scoring._dossier so subsequent
 * page loads can display it without regenerating.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { googleai, MODELS } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

interface ConversationTurn { role: string; content: string }

// ─── Dossier prompt builder ───────────────────────────────────────────────────

function buildDossierPrompt(params: {
  caseType: string | null;
  band: string | null;
  score: number | null;
  urgency: string | null;
  aiReasoning: string | null;
  conversation: ConversationTurn[];
}): { system: string; user: string } {
  const { caseType, band, score, urgency, aiReasoning, conversation } = params;

  const system = `You are an intake intelligence analyst for a Canadian law firm intake system. \
Given a client's intake conversation and their case details, produce a structured intelligence brief \
for the firm's lawyer. Your output must be concise, direct, and grounded in the transcript.

Return ONLY valid JSON matching this exact shape, no markdown fences, no commentary:
{
  "engagement_label": "string — 5 to 8 words describing this lead's overall engagement quality and attitude",
  "watchpoints": [
    { "text": "string — a specific concern, risk, or ambiguity surfaced in the intake", "severity": "high|medium|low", "source_idx": N }
  ],
  "demands": [
    { "text": "string — what this client specifically wants or expects", "source_idx": N }
  ],
  "next_step": "string — one specific, actionable recommendation for the lawyer at first contact"
}

Rules:
- watchpoints: 2 to 4 items. severity=high if it affects case viability, medium if it affects strategy, low for informational context.
- demands: 2 to 3 items. Quote or closely paraphrase the client's own words from the transcript.
- source_idx: zero-based index into the full conversation array (both user and assistant turns). \
Point to the turn that most directly supports this observation.
- next_step: be specific — "Ask about the exact date of the accident before the call ends" beats \
"Follow up promptly."
- Do not invent information not in the transcript.
- Write in plain English for a Canadian lawyer.`;

  const convLines = conversation.map((t, i) =>
    `[${i}] ${t.role === "user" ? "CLIENT" : "SYSTEM"}: ${t.content}`
  ).join("\n\n");

  const user = `CASE DETAILS:
Practice area: ${caseType ?? "unknown"}
CPI band: ${band ?? "unscored"}${score != null ? ` (${score}/100)` : ""}
Urgency: ${urgency ?? "not specified"}
AI scoring note: ${aiReasoning ?? "Not available"}

INTAKE CONVERSATION (index 0 to ${conversation.length - 1}):
${convLines}`;

  return { system, user };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;

  let firmId: string;
  try {
    const body = await request.json() as { firmId?: string };
    if (!body.firmId) return NextResponse.json({ error: "firmId required" }, { status: 400 });
    firmId = body.firmId;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Fetch lead — verify ownership
  const { data: lead } = await supabase
    .from("leads")
    .select("id, name, case_type, band, priority_band, priority_index, cpi_score, urgency, intake_session_id, law_firm_id")
    .eq("id", leadId)
    .single();

  if (!lead || lead.law_firm_id !== firmId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!lead.intake_session_id) {
    return NextResponse.json({ error: "No intake session for this lead" }, { status: 422 });
  }

  // Fetch intake session
  const { data: session } = await supabase
    .from("intake_sessions")
    .select("id, conversation, scoring")
    .eq("id", lead.intake_session_id)
    .single();

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const conversation = (session.conversation as ConversationTurn[] | null) ?? [];
  if (conversation.length === 0) {
    return NextResponse.json({ error: "No conversation data available" }, { status: 422 });
  }

  const scoring = (session.scoring as Record<string, unknown> | null) ?? {};
  const aiReasoning = typeof scoring._reasoning === "string" ? scoring._reasoning : null;
  const band = (lead.priority_band ?? lead.band) as string | null;
  const score = (lead.priority_index ?? lead.cpi_score) as number | null;

  // Build and send the dossier prompt
  const { system, user } = buildDossierPrompt({
    caseType: lead.case_type as string | null,
    band,
    score,
    urgency: lead.urgency as string | null,
    aiReasoning,
    conversation,
  });

  let rawContent: string;
  try {
    const completion = await googleai.chat.completions.create({
      model: MODELS.STANDARD,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user   },
      ],
      temperature: 0.3,
      max_tokens: 800,
    });
    rawContent = completion.choices[0]?.message?.content ?? "";
  } catch (e) {
    console.error("[dossier] AI call failed:", e);
    return NextResponse.json({ error: "AI call failed" }, { status: 502 });
  }

  // Parse the JSON response
  let dossierRaw: Record<string, unknown>;
  try {
    // Strip markdown fences if the model added them despite instructions
    const cleaned = rawContent.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    dossierRaw = JSON.parse(cleaned) as Record<string, unknown>;
  } catch (e) {
    console.error("[dossier] JSON parse failed:", rawContent, e);
    return NextResponse.json({ error: "AI returned unparseable response" }, { status: 502 });
  }

  // Build the persisted dossier object
  const dossier = {
    engagement_label: (dossierRaw.engagement_label as string) ?? "Unknown engagement",
    watchpoints:      (dossierRaw.watchpoints as Array<Record<string, unknown>>) ?? [],
    demands:          (dossierRaw.demands as Array<Record<string, unknown>>) ?? [],
    next_step:        (dossierRaw.next_step as string) ?? "",
    generated_at:     new Date().toISOString(),
  };

  // Persist to scoring._dossier so it survives page reloads
  await supabase
    .from("intake_sessions")
    .update({ scoring: { ...scoring, _dossier: dossier } })
    .eq("id", session.id);

  return NextResponse.json({ dossier });
}
