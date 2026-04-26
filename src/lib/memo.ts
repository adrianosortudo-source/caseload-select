/**
 * memo.ts  -  Case Intake Memo generator.
 *
 * Generates a structured plain-text memo from Round 3 answers + session data.
 * Memo is read by the lawyer before the consultation.
 * Stored in intake_sessions.memo_text.
 *
 * LSO compliance constraints (enforced via system prompt):
 *  - No outcome predictions.
 *  - No "strong case" language.
 *  - All client claims use "reports" / "states" framing.
 *  - Limitations flag is factual only  -  not advisory.
 *  - No em dashes. No AI-pattern vocabulary.
 *
 * Total memo target: 350-500 words.
 */

import { openrouter, MODELS } from "@/lib/openrouter";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { formatCaseValueForMemo, type CaseValueBucket } from "@/lib/case-value";
import type { SabsUrgencyResult, BardalResult } from "@/lib/interaction-scoring";

const openai = openrouter;

// ── Intake Quality Report ─────────────────────────────────────────────────────

export interface IntakeQualityReport {
  /** 0–100 completeness score: answered high-priority slots / total eligible. */
  completenessScore: number;
  /** "complete" | "adequate" | "partial" | "sparse" */
  qualityTier: "complete" | "adequate" | "partial" | "sparse";
  /** Count of answered round-1 and round-2 slots (priority 3–5). */
  answeredCount: number;
  /** Total eligible slots for this session (all priority 3–5 slots for the sub-type). */
  eligibleCount: number;
  /** Slot IDs that were expected but not answered, for the lawyer to probe. */
  gaps: string[];
  /** One-line summary for the memo. */
  summary: string;
}

/**
 * Compute an intake quality report from confirmed answers and the CPI confidence tier.
 *
 * High-priority slots (priority 4–5) are weighted double in the completeness score.
 *
 * @param confirmed   Record of question/slot IDs that were answered.
 * @param subType     Practice area sub-type (e.g. "pi_mva", "emp_dismissal").
 *                    Used to look up the eligible slot list. Falls back gracefully.
 * @param cpiConfidence  "high" | "medium" | "low" | "unknown"
 */
export function computeIntakeQuality(
  confirmed: Record<string, unknown>,
  subType: string | null,
  cpiConfidence: string,
): IntakeQualityReport {
  // Resolve eligible slots for this sub-type from the slot schema
  // Import here to avoid circular dependency at module level
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSlotSchema } = require("@/lib/slot-schema") as { getSlotSchema: (pa: string) => Record<string, { priority: number }> };
  const schema = subType ? getSlotSchema(subType) : {};
  const allSlotIds = Object.keys(schema);

  // Only evaluate slots with priority 3+ (primary and refinement batches)
  const eligible = allSlotIds.filter(id => (schema[id]?.priority ?? 0) >= 3);
  const answeredEligible = eligible.filter(id => id in confirmed);
  const gaps = eligible.filter(id => !(id in confirmed));

  // Weighted completeness: priority 5 = 2 pts, priority 4 = 2 pts, priority 3 = 1 pt
  let weightedTotal = 0;
  let weightedAnswered = 0;
  for (const id of eligible) {
    const p = schema[id]?.priority ?? 3;
    const w = p >= 4 ? 2 : 1;
    weightedTotal += w;
    if (id in confirmed) weightedAnswered += w;
  }

  const completenessScore = weightedTotal > 0
    ? Math.round((weightedAnswered / weightedTotal) * 100)
    : confirmed && Object.keys(confirmed).length > 0 ? 50 : 0; // fallback when no schema

  // Blend with CPI confidence  -  low confidence penalizes the score
  const confidencePenalty: Record<string, number> = { high: 0, medium: 5, low: 15, unknown: 20 };
  const blended = Math.max(0, completenessScore - (confidencePenalty[cpiConfidence] ?? 10));

  const qualityTier: IntakeQualityReport["qualityTier"] =
    blended >= 80 ? "complete" :
    blended >= 55 ? "adequate" :
    blended >= 30 ? "partial" :
    "sparse";

  const summary = `${blended}/100 (${qualityTier})  -  ${answeredEligible.length}/${eligible.length} eligible slots answered${gaps.length > 0 ? `; ${gaps.length} gap${gaps.length > 1 ? "s" : ""} for lawyer to probe` : ""}.`;

  return {
    completenessScore: blended,
    qualityTier,
    answeredCount: answeredEligible.length,
    eligibleCount: eligible.length,
    gaps: gaps.slice(0, 10), // cap at 10 for memo brevity
    summary,
  };
}

// ── Limitations clock ─────────────────────────────────────────────────────────

function limitationsFlag(incidentDateRaw: string | null): string {
  if (!incidentDateRaw) return "Incident date not provided  -  lawyer to confirm before consultation.";
  const parsed = new Date(incidentDateRaw);
  if (isNaN(parsed.getTime())) return "Incident date could not be parsed  -  lawyer to confirm.";

  const daysSince = Math.floor((Date.now() - parsed.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSince < 365) {
    return `${daysSince} days since incident  -  within standard 2-year Ontario limitation period.`;
  } else if (daysSince <= 545) {
    return `${daysSince} days since incident  -  approaching 18-month mark. Confirm whether any prior proceedings were commenced.`;
  } else if (daysSince <= 720) {
    return `${daysSince} days since incident  -  URGENT: approaching 2-year limitation period. Confirm tolling events before consultation proceeds.`;
  } else {
    return `${daysSince} days since incident  -  beyond standard 2-year limitation period. Lawyer to assess discoverability, tolling, or statutory exceptions before consultation.`;
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a legal intake analyst for a Canadian law firm. You produce Case Intake Memos from structured intake data collected from prospective clients.

STRICT RULES:
1. Write in plain, professional English. No legal conclusions.
2. Never state or imply whether the client has a strong, weak, good, or bad case.
3. Never predict outcomes, damages, or likelihood of success.
4. Use "client reports," "client states," or "client described" when relaying client claims.
5. Flag gaps and missing information for the lawyer to probe  -  never fill gaps with assumptions.
6. Reference limitations periods factually only  -  not as advice.
7. The memo is read by a busy lawyer who has 3 minutes before a call. Be concise and precise.
8. No em dashes. Use commas, colons, semicolons, or restructure sentences.
9. Never use: "delve," "tapestry," "pivotal," "testament," "crucial," "meticulous," "ensure," "foster," "highlight," "showcase," "landscape" (figurative), "vibrant," "intricate," "garner."
10. Total memo length: 350 to 500 words. No section should exceed 80 words.
11. Return plain text only. Do not use markdown. Use the section headers provided in the template exactly.
12. The disclaimer line at the end is mandatory and must appear verbatim.`;

// ── Memo template builder ─────────────────────────────────────────────────────

interface MemoInput {
  sessionId: string;
  firmId: string;
  contact: { first_name?: string; last_name?: string; phone?: string; email?: string };
  practiceArea: string | null;
  subType: string | null;
  band: string;
  cpiScore: number;
  cpiConfidence: string;
  situationSummary: string | null;
  round3Answers: Record<string, unknown>;
  bookingTime?: string | null;
  /** Case value estimate from estimateCaseValue()  -  lawyer-facing only. */
  caseValue?: CaseValueBucket | null;
  /** Interaction scoring result  -  SABS urgency or Bardal analysis. */
  interactionScoring?: ({ type: "sabs_urgency" } & SabsUrgencyResult) | ({ type: "bardal" } & BardalResult) | null;
  /** Confirmed question/slot answers  -  used to compute intake quality report. */
  confirmedAnswers?: Record<string, unknown>;
}

function buildUserPrompt(input: MemoInput): string {
  const {
    contact, practiceArea, subType, band, cpiScore, cpiConfidence,
    situationSummary, round3Answers, bookingTime, caseValue, interactionScoring,
    confirmedAnswers,
  } = input;

  const qualityReport = computeIntakeQuality(
    { ...confirmedAnswers, ...round3Answers } as Record<string, unknown>,
    subType,
    cpiConfidence,
  );

  const clientName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Not provided";
  const incidentDate = extractIncidentDate(round3Answers);
  const limFlag = limitationsFlag(incidentDate);
  const generatedDate = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

  // ── Build optional scoring blocks ──────────────────────────────────────────
  const caseValueLine = caseValue
    ? formatCaseValueForMemo(caseValue)
    : "Not computed  -  practice area not resolved at finalize.";

  let urgencyBlock = "Not applicable for this practice area.";
  if (interactionScoring?.type === "sabs_urgency") {
    const s = interactionScoring;
    const deadlineLines = s.deadlines.map(d => {
      const status = d.overdue ? "OVERDUE" : d.daysRemaining !== null ? `${d.daysRemaining}d remaining` : "date unknown";
      return `  - ${d.label} [${status}]`;
    }).join("\n");
    urgencyBlock = [
      `SABS Urgency Score: ${s.urgencyScore}/100 (${s.urgencyTier.toUpperCase()})`,
      deadlineLines || "  - No specific deadlines computed.",
      s.flags.length ? `Flags:\n${s.flags.map(f => `  * ${f}`).join("\n")}` : "No urgency flags.",
    ].join("\n");
  } else if (interactionScoring?.type === "bardal") {
    const b = interactionScoring;
    urgencyBlock = [
      `Bardal Score: ${b.bardalScore}/100`,
      `Estimated reasonable notice: ${b.estimatedNoticeMonths.low}–${b.estimatedNoticeMonths.high} months`,
      b.flags.length ? `Flags:\n${b.flags.map(f => `  * ${f}`).join("\n")}` : "No Bardal flags.",
    ].join("\n");
  }

  return `Produce a Case Intake Memo from the following data. Follow the section structure exactly.

---
CLIENT: ${clientName}
PHONE: ${contact.phone ?? "Not provided"}
EMAIL: ${contact.email ?? "Not provided"}
CONSULTATION BOOKED: ${bookingTime ?? "Pending"}
PRACTICE AREA: ${practiceArea ?? "Unknown"} ${subType ? `(${subType})` : ""}
BAND: ${band} | CPI: ${cpiScore}/100 | CONFIDENCE: ${cpiConfidence}
GENERATED: ${generatedDate}

SITUATION SUMMARY (from Rounds 1 and 2):
${situationSummary ?? "Not captured."}

ROUND 3 ANSWERS (raw):
${JSON.stringify(round3Answers, null, 2)}

LIMITATIONS FLAG (computed  -  factual only, do not restate as advice):
${limFlag}

CASE VALUE ESTIMATE (lawyer reference only  -  do not quote to client):
${caseValueLine}

URGENCY / SCORING ANALYSIS:
${urgencyBlock}
---

OUTPUT using this exact section structure:

CASE INTAKE MEMO
${generatedDate} | ${practiceArea ?? "Unknown"} | Band ${band} | CPI ${cpiScore}/100

Client: ${clientName}
Phone: ${contact.phone ?? "Not provided"} | Email: ${contact.email ?? "Not provided"}
Consultation booked: ${bookingTime ?? "Pending"}

MATTER SUMMARY
[Write 2-3 sentences covering sub-type, key facts, and incident context. Use "client reports" framing. Descriptive only.]

JURISDICTION AND TIMELINE
Incident date: [extract from Round 3 answers, or "Not confirmed"]
Days elapsed: [compute or "Unknown"]
Limitations flag: ${limFlag}
Prior proceedings: [extract from Round 3 answers]

PARTIES AND CONFLICT FLAGS
Client: ${clientName}
Adverse parties: [extract from Round 3 answers, or "Not identified at intake"]
Opposing counsel: [extract from Round 3 answers, or "Not known at intake"]
Prior counsel: [extract from Round 3 answers, or "None reported"]
Conflict check: Pending  -  run against conflict register before consultation.

EVIDENCE MANIFEST
Held by client:
[Bullet list of evidence the client reports having. Use checkmarks: - [x] for held, - [ ] for not held / unknown.]

To request or subpoena:
[Bullet list of evidence not held that is standard for this sub-type.]

FACT PATTERN AND REPORTED CIRCUMSTANCES
[2-4 sentences. Collision/incident description, fault indicators, injuries, employment impact. "Client reports" throughout. Flag any inconsistencies with the Round 1/2 summary.]

CLIENT EXPECTATIONS AND FEE POSTURE
Desired outcome: [extract from Round 3 answers]
Timeline pressure: [extract urgency signals]
Fee arrangement awareness: [extract from Round 3 answers, or "Not discussed at intake"]

GAPS FOR LAWYER TO PROBE
[Bulleted list of missing information, unresolved inconsistencies, or areas needing verbal clarification.]

URGENCY FLAGS AND DEADLINES
${urgencyBlock}

CASE VALUE ESTIMATE
${caseValueLine}
[Do not repeat or expand this estimate. Restate it verbatim as provided above.]

INTAKE QUALITY
${qualityReport.summary}
CPI confidence: ${cpiConfidence}
Round 3 questions answered: ${Object.keys(round3Answers).length} fields${qualityReport.gaps.length > 0 ? `\nGaps to probe: ${qualityReport.gaps.join(", ")}` : ""}

Prepared by CaseLoad Screen. This memo contains client-reported information only and does not constitute legal advice or a case assessment. Confidential  -  Law Society of Ontario Rule 3.3 applies.`;
}

// ── Incident date extractor ───────────────────────────────────────────────────

function extractIncidentDate(answers: Record<string, unknown>): string | null {
  // Try common Round 3 question IDs that capture dates
  const candidates = ["pi_mva_q1", "gen_q1", "incident_date", "date_of_incident"];
  for (const key of candidates) {
    const val = answers[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates a Case Intake Memo and persists it to intake_sessions.
 * Returns the memo text.
 */
export async function generateMemo(input: MemoInput): Promise<string> {
  const userPrompt = buildUserPrompt(input);

  const completion = await openai.chat.completions.create({
    model: MODELS.MEMO,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 900,
  });

  const memoText = completion.choices[0]?.message?.content?.trim() ?? "";

  // Persist memo text and quality report snapshot
  const qualitySnapshot = computeIntakeQuality(
    { ...(input.confirmedAnswers ?? {}), ...input.round3Answers },
    input.subType,
    input.cpiConfidence,
  );

  // Store quality inside the scoring JSONB (no schema migration needed  -  same
  // pattern as _case_value / _interaction_scoring)
  const { data: sessionRow } = await supabase
    .from("intake_sessions")
    .select("scoring")
    .eq("id", input.sessionId)
    .single();

  const existingScoring = (sessionRow?.scoring as Record<string, unknown>) ?? {};
  const updatedScoring = { ...existingScoring, _quality: qualitySnapshot };

  await supabase
    .from("intake_sessions")
    .update({
      memo_text: memoText,
      memo_generated_at: new Date().toISOString(),
      scoring: updatedScoring,
    })
    .eq("id", input.sessionId);

  return memoText;
}
