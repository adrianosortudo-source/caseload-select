/**
 * Dual-write helper: convert a /api/screen finalize-time state into a
 * screened_leads row.
 *
 * The production V2 widget (/widget/[firmId]) calls /api/screen for the
 * multi-turn LLM dialog and persistence. /api/screen historically writes
 * only to legacy intake_sessions, so web-channel intake never lands in
 * screened_leads — which means the lawyer's triage portal at
 * /portal/[firmId]/triage is blank for web traffic (Codex audit HIGH #1).
 *
 * Rather than rewrite the widget to use the sandbox engine path, this
 * helper enables a server-side DUAL-WRITE at /api/screen's finalize=true
 * branch. The web widget continues to call /api/screen unchanged; the
 * route now writes BOTH paths.
 *
 * Mapping notes:
 *
 *   - lead_id format: screened_leads.lead_id is text. We use the
 *     intake_sessions.id (uuid) prefixed with "L-S1-" so legacy uuid leads
 *     and Screen 2.0 sandbox-engine leads remain easily distinguishable in
 *     the triage portal and DSR endpoint.
 *
 *   - matter_type: /api/screen produces a string practice_area like
 *     "Personal Injury" plus an optional practice_sub_type. screened_leads
 *     expects a categorical matter_type that downstream Pipeline rendering
 *     understands ('dispute_civ', 'transaction_imm', etc.). We pass the
 *     screen's practice_sub_type when present (it matches the sandbox enum
 *     shape closely enough), and fall back to the screen's practice_area
 *     lower-cased.
 *
 *   - Four-axis scores: /api/screen's CPI breaks into eight components
 *     (geo/practice/legitimacy/referral/urgency/complexity/multi_practice/fee).
 *     The sandbox's four-axis (value/complexity/urgency/readiness) maps as:
 *       value      ← (fee_score + multi_practice_score)                clamped 0-10
 *       complexity ← complexity_score                                  clamped 0-10
 *       urgency    ← urgency_score                                     clamped 0-10
 *       readiness  ← (legitimacy_score + referral_score) / 2           clamped 0-10
 *     This is a best-effort heuristic. The sandbox engine's four-axis is
 *     authoritative for new traffic; legacy widget rows show the same
 *     scale via this mapping until the widget is fully cut over.
 *
 *   - brief_html: a simplified server-rendered brief built from
 *     situation_summary + confirmed slot answers + contact. Not as rich as
 *     the sandbox's report.ts output, but renders cleanly in the existing
 *     triage portal brief view (which dumps brief_html verbatim into a
 *     scoped `.brief` container).
 *
 *   - brief_json: a minimal LawyerReport-shaped JSON that preserves the
 *     scoring snapshot and confirmed answers for re-derivation. Forward-
 *     compatible: when the sandbox engine takes over for web, this column
 *     gets the full LawyerReport shape; the triage portal already reads
 *     defensively.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ScreenCpiSnapshot {
  total?: number | null;
  band?: string | null;
  fit_score?: number | null;
  value_score?: number | null;
  geo_score?: number | null;
  practice_score?: number | null;
  legitimacy_score?: number | null;
  referral_score?: number | null;
  urgency_score?: number | null;
  complexity_score?: number | null;
  multi_practice_score?: number | null;
  fee_score?: number | null;
  band_locked?: boolean;
}

export interface ScreenFinalizeContext {
  sessionId: string;
  firmId: string;
  cpi: ScreenCpiSnapshot;
  practiceArea: string | null;
  practiceSubType: string | null;
  situationSummary: string | null;
  confirmedAnswers: Record<string, unknown>;
  contact: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  caseValueRationale: string | null;
  caseValueLabel: string | null;
  intakeLanguage: string | null;
}

export interface ScreenedLeadDualWriteResult {
  ok: boolean;
  lead_id?: string;
  status?: string;
  error?: string;
}

// ─── Mapping helpers (pure) ─────────────────────────────────────────────────

const clamp10 = (n: number | null | undefined): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(10, Math.round(v)));
};

export function deriveLeadIdFromSession(sessionId: string): string {
  return `L-S1-${sessionId}`;
}

export function deriveMatterType(practiceArea: string | null, practiceSubType: string | null): string {
  // Sub-type, when present, is the most specific category and matches the
  // sandbox's vocabulary closely enough for the triage portal's label code.
  if (practiceSubType && practiceSubType.length > 0) return practiceSubType.toLowerCase();
  if (practiceArea && practiceArea.length > 0) return practiceArea.toLowerCase().replace(/\s+/g, "_");
  return "unknown";
}

export function deriveFourAxis(cpi: ScreenCpiSnapshot): {
  value: number;
  complexity: number;
  urgency: number;
  readiness: number;
} {
  const fee = cpi.fee_score ?? 0;
  const multi = cpi.multi_practice_score ?? 0;
  const legitimacy = cpi.legitimacy_score ?? 0;
  const referral = cpi.referral_score ?? 0;
  return {
    value: clamp10(fee + multi),
    complexity: clamp10(cpi.complexity_score ?? 0),
    urgency: clamp10(cpi.urgency_score ?? 0),
    readiness: clamp10((legitimacy + referral) / 2),
  };
}

export function computeDecisionDeadline(urgency: number, now: Date = new Date()): Date {
  // Mirror /api/intake-v2: 48h default, 24h at urgency >= 6, 12h at urgency >= 8.
  const hours = urgency >= 8 ? 12 : urgency >= 6 ? 24 : 48;
  return new Date(now.getTime() + hours * 3600 * 1000);
}

export function computeWhaleNurture(value: number, readiness: number): boolean {
  // Bible v5 trigger: value_score >= 7 AND readiness_score <= 4.
  return value >= 7 && readiness <= 4;
}

// ─── Brief rendering (pure) ─────────────────────────────────────────────────

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatAnswerKey = (key: string): string =>
  key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bQ\d+\b/i, (m) => m.toUpperCase());

const formatAnswerValue = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

export function renderBriefHtml(ctx: {
  situationSummary: string | null;
  confirmedAnswers: Record<string, unknown>;
  practiceArea: string | null;
  practiceSubType: string | null;
  caseValueLabel: string | null;
  caseValueRationale: string | null;
  cpi: ScreenCpiSnapshot;
}): string {
  const parts: string[] = [];
  parts.push('<div class="brief">');

  if (ctx.situationSummary) {
    parts.push(`<section class="brief-section brief-section-summary">`);
    parts.push(`<h3 class="brief-heading">Situation summary</h3>`);
    parts.push(`<p class="brief-body">${escapeHtml(ctx.situationSummary)}</p>`);
    parts.push(`</section>`);
  }

  const paLabel = ctx.practiceSubType ?? ctx.practiceArea;
  if (paLabel) {
    parts.push(`<section class="brief-section brief-section-meta">`);
    parts.push(`<h3 class="brief-heading">Matter type</h3>`);
    parts.push(`<p class="brief-body">${escapeHtml(paLabel)}</p>`);
    parts.push(`</section>`);
  }

  const answerEntries = Object.entries(ctx.confirmedAnswers).filter(([, v]) => v != null && v !== "");
  if (answerEntries.length > 0) {
    parts.push(`<section class="brief-section brief-section-facts">`);
    parts.push(`<h3 class="brief-heading">Confirmed facts</h3>`);
    parts.push(`<dl class="brief-fact-list">`);
    for (const [k, v] of answerEntries.slice(0, 30)) {
      parts.push(`<dt class="brief-fact-key">${escapeHtml(formatAnswerKey(k))}</dt>`);
      parts.push(`<dd class="brief-fact-val">${escapeHtml(formatAnswerValue(v))}</dd>`);
    }
    parts.push(`</dl>`);
    parts.push(`</section>`);
  }

  if (ctx.caseValueLabel || ctx.caseValueRationale) {
    parts.push(`<section class="brief-section brief-section-value">`);
    parts.push(`<h3 class="brief-heading">Case value indication</h3>`);
    if (ctx.caseValueLabel) {
      parts.push(`<p class="brief-body brief-emph">${escapeHtml(ctx.caseValueLabel)}</p>`);
    }
    if (ctx.caseValueRationale) {
      parts.push(`<p class="brief-body brief-rationale">${escapeHtml(ctx.caseValueRationale)}</p>`);
    }
    parts.push(`</section>`);
  }

  parts.push(`<section class="brief-section brief-section-source">`);
  parts.push(
    `<p class="brief-source-note">Captured from the web intake widget. The lawyer reviews this brief and decides whether to take or pass.</p>`,
  );
  parts.push(`</section>`);

  parts.push(`</div>`);
  return parts.join("\n");
}

// ─── Insert ─────────────────────────────────────────────────────────────────

export interface DualWriteSupabaseClient {
  from: SupabaseClient["from"];
}

export async function writeScreenedLeadFromScreen(
  supabase: DualWriteSupabaseClient,
  ctx: ScreenFinalizeContext,
): Promise<ScreenedLeadDualWriteResult> {
  const leadId = deriveLeadIdFromSession(ctx.sessionId);
  const matterType = deriveMatterType(ctx.practiceArea, ctx.practiceSubType);
  const axes = deriveFourAxis(ctx.cpi);
  const now = new Date();
  const decisionDeadline = computeDecisionDeadline(axes.urgency, now);
  const whaleNurture = computeWhaleNurture(axes.value, axes.readiness);

  const briefJson = {
    lead_id: leadId,
    source: "legacy_widget_v2",
    submitted_at: now.toISOString(),
    four_axis: axes,
    band: ctx.cpi.band ?? null,
    practice_area: ctx.practiceArea,
    practice_sub_type: ctx.practiceSubType,
    situation_summary: ctx.situationSummary,
    case_value_label: ctx.caseValueLabel,
    case_value_rationale: ctx.caseValueRationale,
    cpi_snapshot: ctx.cpi,
    confirmed_answers: ctx.confirmedAnswers,
  };

  const briefHtml = renderBriefHtml({
    situationSummary: ctx.situationSummary,
    confirmedAnswers: ctx.confirmedAnswers,
    practiceArea: ctx.practiceArea,
    practiceSubType: ctx.practiceSubType,
    caseValueLabel: ctx.caseValueLabel,
    caseValueRationale: ctx.caseValueRationale,
    cpi: ctx.cpi,
  });

  const slotAnswers = {
    source: "legacy_widget_v2",
    confirmed_answers: ctx.confirmedAnswers,
    cpi_snapshot: ctx.cpi,
  };

  // Initial status: OOS auto-declines via the screened_leads invariant; here
  // we always set 'triaging' because the legacy widget's OOS classification
  // already short-circuited before finalize=true could reach this dual-write
  // path. If a future code change changes that assumption, mirror the
  // /api/intake-v2 computeInitialStatus() logic.
  const initialStatus = "triaging" as const;

  const insertPayload = {
    lead_id: leadId,
    firm_id: ctx.firmId,
    screen_version: 1,
    status: initialStatus,
    status_changed_by: "system:legacy-screen",
    brief_json: briefJson,
    brief_html: briefHtml,
    slot_answers: slotAnswers,
    band: ctx.cpi.band ?? null,
    matter_type: matterType,
    practice_area: ctx.practiceArea ?? "unknown",
    value_score: axes.value,
    complexity_score: axes.complexity,
    urgency_score: axes.urgency,
    readiness_score: axes.readiness,
    readiness_answered: true,
    whale_nurture: whaleNurture,
    band_c_subtrack: null,
    decision_deadline: decisionDeadline.toISOString(),
    contact_name: ctx.contact.name ?? null,
    contact_email: ctx.contact.email ?? null,
    contact_phone: ctx.contact.phone ?? null,
    submitted_at: now.toISOString(),
    intake_language: ctx.intakeLanguage ?? "en",
    raw_transcript: null,
  };

  const { data, error } = await supabase
    .from("screened_leads")
    .upsert(insertPayload, { onConflict: "lead_id" })
    .select("id, lead_id, status")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }
  return {
    ok: true,
    lead_id: (data as { lead_id?: string } | null)?.lead_id ?? leadId,
    status: (data as { status?: string } | null)?.status ?? initialStatus,
  };
}
