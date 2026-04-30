/**
 * POST /api/demo/leads/[leadId]/dossier
 *
 * Demo-mode version of the dossier endpoint. No auth required. Verifies
 * the lead belongs to the demo firm via getDemoFirmId(). Otherwise identical
 * in behaviour to /api/portal/leads/[leadId]/dossier.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { getDemoFirmId } from "@/lib/demo-firm";
import { googleai, MODELS } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

interface ConversationTurn { role: string; content: string }

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
- next_step: be specific. Do not invent information not in the transcript.
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const firmId = await getDemoFirmId();
  if (!firmId) return NextResponse.json({ error: "Demo firm not configured" }, { status: 500 });

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

  const { data: session } = await supabase
    .from("intake_sessions")
    .select("id, conversation, scoring")
    .eq("id", lead.intake_session_id)
    .single();

  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const conversation = (session.conversation as ConversationTurn[] | null) ?? [];
  if (conversation.length === 0) {
    return NextResponse.json({ error: "No conversation data available" }, { status: 422 });
  }

  const scoring = (session.scoring as Record<string, unknown> | null) ?? {};
  const aiReasoning = typeof scoring._reasoning === "string" ? scoring._reasoning : null;
  const band = (lead.priority_band ?? lead.band) as string | null;
  const score = (lead.priority_index ?? lead.cpi_score) as number | null;

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
    console.error("[demo-dossier] AI call failed:", e);
    return NextResponse.json({ error: "AI call failed" }, { status: 502 });
  }

  let dossierRaw: Record<string, unknown>;
  try {
    const cleaned = rawContent.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    dossierRaw = JSON.parse(cleaned) as Record<string, unknown>;
  } catch (e) {
    console.error("[demo-dossier] JSON parse failed:", rawContent, e);
    return NextResponse.json({ error: "AI returned unparseable response" }, { status: 502 });
  }

  const dossier = {
    engagement_label: (dossierRaw.engagement_label as string) ?? "Unknown engagement",
    watchpoints:      (dossierRaw.watchpoints as Array<Record<string, unknown>>) ?? [],
    demands:          (dossierRaw.demands as Array<Record<string, unknown>>) ?? [],
    next_step:        (dossierRaw.next_step as string) ?? "",
    generated_at:     new Date().toISOString(),
  };

  await supabase
    .from("intake_sessions")
    .update({ scoring: { ...scoring, _dossier: dossier } })
    .eq("id", session.id);

  return NextResponse.json({ dossier });
}
